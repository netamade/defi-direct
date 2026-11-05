import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Engine, engineConfigFromChallenge, type EngineConfig } from "../src/engine/executor";
import { snapshotState, type ContractInfo, type InitialStateInput } from "../src/engine/state";
import { MAX_UINT256 } from "../src/engine/units";
import { ZERO_ADDRESS } from "../src/engine/validation";

// 実際に配置されている課題JSONを読み込んでエンジンを組み立てる
function loadChallenge(id: string) {
  const url = new URL(`../data/challenges/${id}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf-8")) as {
    id: string;
    contracts: ContractInfo[];
    initialState: InitialStateInput;
    gas?: Record<string, { gasUsed: number; gasPriceGwei: number }>;
    swapRate?: number;
  };
}

function engineFor(id: string): Engine {
  return new Engine(engineConfigFromChallenge(loadChallenge(id)));
}

const USER = "0x1111111111111111111111111111111111111111";
const USDC = "0x2222222222222222222222222222222222222222";
const SPENDER01 = "0x3333333333333333333333333333333333333333";
const DEX = "0x4444444444444444444444444444444444444444";
const TKN = "0x5555555555555555555555555555555555555555";
const OTHER = "0x6666666666666666666666666666666666666666";

describe("Read（課題01：Contract Explorer）", () => {
  it("decimals / balanceOf / allowance が読め、成功したReadのみcallLogに残る", () => {
    const engine = engineFor("01");
    const before = snapshotState(engine.state);

    const decimals = engine.read("decimals", USDC);
    expect(decimals.ok).toBe(true);
    if (decimals.ok) {
      expect(decimals.valueRaw).toBe(6n);
      expect(decimals.record.id).toBe("SIM-CALL-0001");
      expect(decimals.record.returnValueDisplay).toBe("6");
    }
    const balance = engine.read("balanceOf", USDC, { account: USER });
    expect(balance.ok && balance.valueRaw).toBe(1_000_000_000n);
    if (balance.ok) expect(balance.valueDisplay).toBe("1000");

    const allowance = engine.read("allowance", USDC, { owner: USER, spender: SPENDER01 });
    expect(allowance.ok && allowance.valueRaw).toBe(500_000_000n);
    if (allowance.ok) expect(allowance.valueDisplay).toBe("500");

    expect(engine.state.callLog).toHaveLength(3);
    expect(engine.state.txLog).toHaveLength(0);
    // Readでは状態（残高・ブロック・nonce）は変わらない
    const after = snapshotState(engine.state);
    expect(after.blockNumber).toBe(before.blockNumber);
    expect(after.balances).toEqual(before.balances);
    expect(after.accounts[USER]?.nonce).toBe(0);
    // sequence は txLog と共通の通し番号
    expect(engine.state.callLog.map((c) => c.sequence)).toEqual([1, 2, 3]);
  });

  it("未保有のbalanceOfと未承認のallowanceは0を返し、エラーにしない", () => {
    const engine = engineFor("01");
    const balance = engine.read("balanceOf", USDC, { account: OTHER });
    expect(balance.ok && balance.valueRaw).toBe(0n);
    const allowance = engine.read("allowance", USDC, { owner: USER, spender: OTHER });
    expect(allowance.ok && allowance.valueRaw).toBe(0n);
  });

  it("存在しないコントラクトへのReadはエラーで、callLogに記録しない", () => {
    const engine = engineFor("01");
    const result = engine.read("decimals", OTHER);
    expect(result.ok).toBe(false);
    expect(engine.state.callLog).toHaveLength(0);
  });
});

describe("approve（課題02：Approval Master）", () => {
  it("approveは上書きであり、加算ではない", () => {
    const engine = engineFor("02");
    const first = engine.write("approve", USDC, { spender: DEX, amountRaw: "50000000" });
    expect(first.kind).toBe("success");
    expect(engine.getAllowance(USDC, USER, DEX)).toBe(50_000_000n);

    engine.write("approve", USDC, { spender: DEX, amountRaw: "30000000" });
    expect(engine.getAllowance(USDC, USER, DEX)).toBe(30_000_000n); // 80,000,000 にはならない
  });

  it("approve(spender, 0) で承認を解除できる（revertしない）", () => {
    const engine = engineFor("02");
    engine.write("approve", USDC, { spender: DEX, amountRaw: "50000000" });
    const revoke = engine.write("approve", USDC, { spender: DEX, amountRaw: "0" });
    expect(revoke.kind).toBe("success");
    expect(engine.getAllowance(USDC, USER, DEX)).toBe(0n);
  });

  it("spenderがゼロアドレスのapproveはrevertし、allowanceは変わらずガス・nonce・ブロックは進む", () => {
    const engine = engineFor("02");
    const ethBefore = engine.state.accounts[USER]?.ethBalanceWei ?? 0n;
    const result = engine.write("approve", USDC, { spender: ZERO_ADDRESS, amountRaw: "100" });
    expect(result.kind).toBe("revert");
    if (result.kind !== "preflight-failure") {
      expect(result.record.status).toBe(0);
      expect(result.record.revertReason).toBe("ZERO_ADDRESS_SPENDER");
      expect(result.record.stateDiff).toEqual([]);
      expect(result.record.gasFeeWei).toBe("900000000000000"); // 45,000 × 20 Gwei
    }
    expect(engine.getAllowance(USDC, USER, ZERO_ADDRESS)).toBe(0n);
    expect(engine.state.blockNumber).toBe(1);
    expect(engine.state.accounts[USER]?.nonce).toBe(1);
    expect(engine.state.accounts[USER]?.ethBalanceWei).toBe(ethBefore - 900_000_000_000_000n);
  });

  it("ガス代は疑似ETH残高から控除される（成功時）", () => {
    const engine = engineFor("02");
    engine.write("approve", USDC, { spender: DEX, amountRaw: "50000000" });
    expect(engine.state.accounts[USER]?.ethBalanceWei).toBe(10n ** 18n - 900_000_000_000_000n);
  });
});

describe("transfer", () => {
  function transferEngine(): Engine {
    const def = loadChallenge("03");
    return new Engine(engineConfigFromChallenge(def));
  }

  it("0数量のtransferは残高変化なしで成功する", () => {
    const engine = transferEngine();
    const result = engine.write("transfer", USDC, { to: OTHER, amountRaw: "0" });
    expect(result.kind).toBe("success");
    expect(engine.getBalance(USDC, USER)).toBe(100_000_000n);
    expect(engine.getBalance(USDC, OTHER)).toBe(0n);
    expect(engine.state.blockNumber).toBe(1);
  });

  it("通常のtransferで残高が移動する", () => {
    const engine = transferEngine();
    const result = engine.write("transfer", USDC, { to: OTHER, amountRaw: "30000000" });
    expect(result.kind).toBe("success");
    expect(engine.getBalance(USDC, USER)).toBe(70_000_000n);
    expect(engine.getBalance(USDC, OTHER)).toBe(30_000_000n);
  });

  it("残高不足のtransferはrevertし、残高は変わらないがブロック・nonceは進む", () => {
    const engine = transferEngine();
    const result = engine.write("transfer", USDC, { to: OTHER, amountRaw: "100000001" });
    expect(result.kind).toBe("revert");
    if (result.kind !== "preflight-failure") {
      expect(result.record.revertReason).toBe("INSUFFICIENT_BALANCE");
    }
    expect(engine.getBalance(USDC, USER)).toBe(100_000_000n);
    expect(engine.state.blockNumber).toBe(1);
    expect(engine.state.accounts[USER]?.nonce).toBe(1);
  });

  it("ゼロアドレス宛のtransferはrevertする", () => {
    const engine = transferEngine();
    const result = engine.write("transfer", USDC, { to: ZERO_ADDRESS, amountRaw: "1" });
    expect(result.kind).toBe("revert");
    if (result.kind !== "preflight-failure") {
      expect(result.record.revertReason).toBe("ZERO_ADDRESS_RECIPIENT");
    }
  });
});

describe("swap（課題03：Swap Challenge）", () => {
  it("approve 10 USDC → swap 10 USDC で USDC 90 / TKN 10 になり、allowanceは消費される", () => {
    const engine = engineFor("03");
    engine.write("approve", USDC, { spender: DEX, amountRaw: "10000000" });
    const swap = engine.write("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
    expect(swap.kind).toBe("success");
    expect(engine.getBalance(USDC, USER)).toBe(90_000_000n);
    expect(engine.getBalance(TKN, USER)).toBe(10_000_000_000_000_000_000n);
    expect(engine.getAllowance(USDC, USER, DEX)).toBe(0n);
    // approve(45,000) + swap(120,000) ガスが疑似ETHから引かれている
    expect(engine.state.accounts[USER]?.ethBalanceWei).toBe(
      10n ** 18n - 900_000_000_000_000n - 2_400_000_000_000_000n,
    );
  });

  it("allowance不足のswapはrevertする（INSUFFICIENT_ALLOWANCE）", () => {
    const engine = engineFor("03");
    const swap = engine.write("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
    expect(swap.kind).toBe("revert");
    if (swap.kind !== "preflight-failure") {
      expect(swap.record.revertReason).toBe("INSUFFICIENT_ALLOWANCE");
    }
    expect(engine.getBalance(USDC, USER)).toBe(100_000_000n);
    expect(engine.getBalance(TKN, USER)).toBe(0n);
  });

  it("無制限allowanceはswapで減算しない", () => {
    const engine = engineFor("03");
    engine.write("approve", USDC, { spender: DEX, amountRaw: MAX_UINT256.toString() });
    const swap = engine.write("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
    expect(swap.kind).toBe("success");
    expect(engine.getAllowance(USDC, USER, DEX)).toBe(MAX_UINT256);
    expect(engine.getBalance(TKN, USER)).toBe(10_000_000_000_000_000_000n);
  });
});

describe("ガス不足（送信前・未包含の失敗）", () => {
  it("ガス代が疑似ETH残高を超える場合はtxLog・nonce・ブロックが動かない", () => {
    const def = loadChallenge("02");
    const config: EngineConfig = engineConfigFromChallenge({
      ...def,
      initialState: { ...def.initialState, ethBalanceWei: "1000" }, // ガス代 9e14 wei に対して不足
    });
    const engine = new Engine(config);
    const result = engine.write("approve", USDC, { spender: DEX, amountRaw: "50000000" });
    expect(result.kind).toBe("preflight-failure");
    if (result.kind === "preflight-failure") {
      expect(result.code).toBe("INSUFFICIENT_GAS");
    }
    expect(engine.state.txLog).toHaveLength(0);
    expect(engine.state.blockNumber).toBe(0);
    expect(engine.state.accounts[USER]?.nonce).toBe(0);
    expect(engine.getAllowance(USDC, USER, DEX)).toBe(0n);
  });
});

describe("リセット", () => {
  it("リセットで状態とログが初期化され、attemptIdが+1される", () => {
    const engine = engineFor("02");
    engine.write("approve", USDC, { spender: DEX, amountRaw: "50000000" });
    engine.read("allowance", USDC, { owner: USER, spender: DEX });
    engine.reset();
    expect(engine.state.attemptId).toBe(2);
    expect(engine.state.txLog).toHaveLength(0);
    expect(engine.state.callLog).toHaveLength(0);
    expect(engine.state.blockNumber).toBe(0);
    expect(engine.getAllowance(USDC, USER, DEX)).toBe(0n);
  });
});
