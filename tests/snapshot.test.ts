import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Engine, engineConfigFromChallenge } from "../src/engine/executor";
import {
  STATE_SCHEMA_VERSION,
  deserializeState,
  serializeState,
  snapshotState,
  type ContractInfo,
  type InitialStateInput,
} from "../src/engine/state";

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

const USER = "0x1111111111111111111111111111111111111111";
const USDC = "0x2222222222222222222222222222222222222222";
const DEX = "0x4444444444444444444444444444444444444444";

// スキーマ凍結テスト：フィールドの追加・削除・改名があればここで検出する（設計書 5.3 フェーズ1）
describe("スキーマ凍結", () => {
  it("SimulationState の schemaVersion は 2 で、トップレベルキーが凍結どおり", () => {
    const engine = new Engine(engineConfigFromChallenge(loadChallenge("01")));
    expect(engine.state.schemaVersion).toBe(STATE_SCHEMA_VERSION);
    expect(Object.keys(engine.state).sort()).toEqual(
      [
        "schemaVersion",
        "challengeId",
        "attemptId",
        "blockNumber",
        "accounts",
        "tokens",
        "allowances",
        "txLog",
        "callLog",
      ].sort(),
    );
  });

  it("TxRecord のキーが凍結どおり（成功時）", () => {
    const engine = new Engine(engineConfigFromChallenge(loadChallenge("02")));
    const result = engine.write("approve", USDC, { spender: DEX, amountRaw: "50000000" });
    if (result.kind === "preflight-failure") throw new Error("unexpected preflight failure");
    expect(Object.keys(result.record).sort()).toEqual(
      [
        "id",
        "pseudoHash",
        "blockNumber",
        "nonce",
        "attemptId",
        "sequence",
        "type",
        "functionName",
        "contract",
        "args",
        "from",
        "status",
        "outcome",
        "gasUsed",
        "gasPriceGwei",
        "gasFeeWei",
        "stateDiff",
        "timestamp",
      ].sort(),
    );
    expect(result.record.id).toMatch(/^SIM-TX-\d{4}$/);
    expect(result.record.pseudoHash).toBe(result.record.id);
  });

  it("TxRecord のキーが凍結どおり（revert時は revertReason が付く）", () => {
    const engine = new Engine(engineConfigFromChallenge(loadChallenge("02")));
    const result = engine.write("approve", USDC, {
      spender: "0x0000000000000000000000000000000000000000",
      amountRaw: "1",
    });
    if (result.kind === "preflight-failure") throw new Error("unexpected preflight failure");
    expect(Object.keys(result.record).sort()).toEqual(
      [
        "id",
        "pseudoHash",
        "blockNumber",
        "nonce",
        "attemptId",
        "sequence",
        "type",
        "functionName",
        "contract",
        "args",
        "from",
        "status",
        "outcome",
        "revertReason",
        "gasUsed",
        "gasPriceGwei",
        "gasFeeWei",
        "stateDiff",
        "timestamp",
      ].sort(),
    );
  });

  it("CallRecord のキーが凍結どおり", () => {
    const engine = new Engine(engineConfigFromChallenge(loadChallenge("01")));
    const result = engine.read("balanceOf", USDC, { account: USER });
    if (!result.ok) throw new Error("unexpected read failure");
    expect(Object.keys(result.record).sort()).toEqual(
      [
        "id",
        "attemptId",
        "sequence",
        "type",
        "functionName",
        "contract",
        "args",
        "from",
        "returnValueRaw",
        "returnValueDisplay",
        "timestamp",
      ].sort(),
    );
    expect(result.record.id).toMatch(/^SIM-CALL-\d{4}$/);
  });

  it("StateSnapshot のキーが凍結どおりで、値はすべてJSON化可能な文字列・数値", () => {
    const engine = new Engine(engineConfigFromChallenge(loadChallenge("03")));
    engine.write("approve", USDC, { spender: DEX, amountRaw: "10000000" });
    const snapshot = snapshotState(engine.state);
    expect(Object.keys(snapshot).sort()).toEqual(["blockNumber", "accounts", "balances", "allowances"].sort());
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.accounts[USER]).toEqual({
      ethBalanceWei: (10n ** 18n - 900_000_000_000_000n).toString(),
      nonce: 1,
    });
  });

  it("シリアライズ→JSON往復→デシリアライズでスナップショットが一致する", () => {
    const engine = new Engine(engineConfigFromChallenge(loadChallenge("03")));
    engine.write("approve", USDC, { spender: DEX, amountRaw: "10000000" });
    engine.write("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
    engine.read("balanceOf", USDC, { account: USER });

    const json = JSON.stringify(serializeState(engine.state));
    const restored = deserializeState(JSON.parse(json));
    expect(snapshotState(restored)).toEqual(snapshotState(engine.state));
    expect(restored.txLog).toEqual(engine.state.txLog);
    expect(restored.callLog).toEqual(engine.state.callLog);
  });
});
