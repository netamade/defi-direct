import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLoadedData, type LoadedData } from "../src/data/loader";
import type { ChallengeDefinition } from "../src/data/types";
import { ProgressStore, type StorageLike } from "../src/store/progressStore";
import { SimulationStore } from "../src/store/simulationStore";
import { PlaySession } from "../src/ui/session";
import { MAX_UINT256 } from "../src/engine/units";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf-8"));
}

const data: LoadedData = buildLoadedData({
  challengeFiles: {
    "01.json": readJson("../data/challenges/01.json"),
    "02.json": readJson("../data/challenges/02.json"),
    "03.json": readJson("../data/challenges/03.json"),
    "04.json": readJson("../data/challenges/04.json"),
    "05.json": readJson("../data/challenges/05.json"),
    "06.json": readJson("../data/challenges/06.json"),
    "07.json": readJson("../data/challenges/07.json"),
    "08.json": readJson("../data/challenges/08.json"),
    "09.json": readJson("../data/challenges/09.json"),
  },
  indexRaw: readJson("./fixtures/wave1-index.json"),
  badgesRaw: readJson("../data/badges.json"),
});

function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

type SharedStorage = ReturnType<typeof fakeStorage>;

function newSession(storage: SharedStorage, id: string): PlaySession {
  const def = data.byId.get(id) as ChallengeDefinition;
  const progressStore = new ProgressStore(storage, () => ({ challengeXp: new Map(data.challenges.map(c => [c.id, c.xp])), badgeIds: new Set(data.badges.map(b => b.id)) }));
  const simStore = new SimulationStore(storage);
  return new PlaySession(data, def, progressStore, simStore);
}

const USER = "0x1111111111111111111111111111111111111111";
const USDC = "0x2222222222222222222222222222222222222222";
const FRIEND = "0x3333333333333333333333333333333333333333";
const DEX = "0x4444444444444444444444444444444444444444";
const TKN = "0x5555555555555555555555555555555555555555";
const WBTC = "0x6666666666666666666666666666666666666666";
const LENDING = "0x7777777777777777777777777777777777777777";
const GAME = "0x8888888888888888888888888888888888888888";
const USDT = "0x9999999999999999999999999999999999999999";
const ZERO = "0x0000000000000000000000000000000000000000";
const MAX = MAX_UINT256.toString();

// --- 正解フロー ---

function solve04(session: PlaySession): void {
  // （発展）ゼロアドレス宛ての revert を先に体験する
  const reverted = session.executeWrite("transfer", USDC, { to: ZERO, amountRaw: "10000000" });
  expect(reverted.result.kind).toBe("revert");
  session.doRead("balanceOf", USDC, { account: USER });
  session.executeWrite("transfer", USDC, { to: FRIEND, amountRaw: "250000000" });
  session.doRead("balanceOf", USDC, { account: USER });
  session.doRead("balanceOf", USDC, { account: FRIEND });
  session.answerQuiz("q04-raw", "250000000");
}

function solve05(session: PlaySession): void {
  for (const token of [USDC, WBTC, TKN]) {
    session.doRead("decimals", token);
    session.doRead("balanceOf", token, { account: USER });
    session.doRead("name", token);
    session.doRead("symbol", token);
    session.doRead("totalSupply", token);
  }
  session.answerQuiz("q05-usdc", "1234.56789");
  session.answerQuiz("q05-wbtc", "0.25");
  session.answerQuiz("q05-tkn", "123.45");
  session.answerQuiz("q05-name", "opt-wbtc-name");
}

const AUDIT_PAIRS: { token: string; spender: string }[] = [
  { token: USDC, spender: DEX },
  { token: USDC, spender: LENDING },
  { token: USDC, spender: GAME },
  { token: TKN, spender: DEX },
  { token: TKN, spender: GAME },
];

function solve06(session: PlaySession): void {
  for (const { token, spender } of AUDIT_PAIRS) {
    session.doRead("allowance", token, { owner: USER, spender });
  }
  session.answerQuiz("q06-unlimited", "opt-lending");
  session.answerQuiz("q06-count", "5");
  for (const { token, spender } of AUDIT_PAIRS) {
    session.executeWrite("approve", token, { spender, amountRaw: "0" });
  }
  for (const { token, spender } of AUDIT_PAIRS) {
    session.doRead("allowance", token, { owner: USER, spender });
  }
}

function solve07(session: PlaySession): void {
  session.doRead("allowance", USDT, { owner: USER, spender: DEX });
  session.executeWrite("approve", USDT, { spender: DEX, amountRaw: "0" });
  session.doRead("allowance", USDT, { owner: USER, spender: DEX });
  session.executeWrite("approve", USDT, { spender: DEX, amountRaw: "200000000" });
  session.doRead("allowance", USDT, { owner: USER, spender: DEX });
  session.answerQuiz("q07-why", "opt-spec");
}

function solve08(session: PlaySession): void {
  session.doRead("balanceOf", USDC, { account: USER });
  session.doRead("balanceOf", TKN, { account: USER });
  session.answerQuiz("q08-estimate", "19");
  session.executeWrite("approve", USDC, { spender: DEX, amountRaw: "20000000" });
  session.executeWrite("swapExactUSDCForTKN", DEX, { amountInRaw: "20000000" });
  session.doRead("balanceOf", USDC, { account: USER });
  session.doRead("balanceOf", TKN, { account: USER });
}

function solve09(session: PlaySession): void {
  session.doRead("balanceOf", USDC, { account: USER });
  const failBalance = session.executeWrite("transfer", USDC, { to: FRIEND, amountRaw: "200000000" });
  expect(failBalance.result.kind).toBe("revert");
  session.answerQuiz("q09-balance", "opt-bal-ib");
  const failAllowance = session.executeWrite("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
  expect(failAllowance.result.kind).toBe("revert");
  session.answerQuiz("q09-allowance", "opt-all-ia");
  const failZero = session.executeWrite("transfer", USDC, { to: ZERO, amountRaw: "10000000" });
  expect(failZero.result.kind).toBe("revert");
  session.answerQuiz("q09-zero", "opt-zero-za");
  session.executeWrite("approve", USDC, { spender: DEX, amountRaw: "10000000" });
  session.executeWrite("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
  session.executeWrite("transfer", USDC, { to: FRIEND, amountRaw: "10000000" });
}

describe("Wave 1（課題04〜09）データ", () => {
  it("9課題すべてがバリデーションを通過し、XP合計は1400", () => {
    expect(data.invalid).toEqual([]);
    expect(data.problems).toEqual([]);
    expect(data.challenges.map((c) => c.id)).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09"]);
    expect(data.totalXp).toBe(1400);
  });
});

describe("課題04 Transfer Basics", () => {
  it("正解パターン：残高確認→transfer 250→両者の残高確認→クイズでクリア", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "04");
    solve04(session);
    expect(session.evaluation.passed).toBe(true);
    expect(session.progress.totalXp).toBe(100);
    expect(session.progress.badges).toContain("first-transfer");
    expect(session.engine.getBalance(USDC, USER)).toBe(750_000_000n);
    expect(session.engine.getBalance(USDC, FRIEND)).toBe(250_000_000n);
    expect(session.checklist().every((item) => item.done)).toBe(true);
  });

  it("数量違い：100 USDC の transfer ではクリアできない", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "04");
    session.doRead("balanceOf", USDC, { account: USER });
    session.executeWrite("transfer", USDC, { to: FRIEND, amountRaw: "100000000" });
    session.doRead("balanceOf", USDC, { account: USER });
    session.doRead("balanceOf", USDC, { account: FRIEND });
    session.answerQuiz("q04-raw", "250000000");
    expect(session.engine.getBalance(USDC, USER)).toBe(900_000_000n);
    expect(session.evaluation.passed).toBe(false);
  });

  it("リセット後の再挑戦：間違えた試行のあとリセットすればクリアできる", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "04");
    session.executeWrite("transfer", USDC, { to: FRIEND, amountRaw: "100000000" });
    expect(session.evaluation.passed).toBe(false);
    session.reset();
    solve04(session);
    expect(session.evaluation.passed).toBe(true);
    expect(session.progress.totalXp).toBe(100);
  });
});

describe("課題05 3つのトークンを読み比べる", () => {
  it("正解パターン：3トークン×5 Read＋クイズ4問でクリア", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "05");
    solve05(session);
    expect(session.evaluation.passed).toBe(true);
    expect(session.progress.totalXp).toBe(150);
    expect(session.progress.badges).toContain("multi-reader");
    expect(session.checklist().every((item) => item.done)).toBe(true);
  });

  it("Read不足：1トークン分を読まないとクリアできない", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "05");
    for (const token of [USDC, WBTC]) {
      session.doRead("decimals", token);
      session.doRead("balanceOf", token, { account: USER });
      session.doRead("name", token);
      session.doRead("symbol", token);
      session.doRead("totalSupply", token);
    }
    session.answerQuiz("q05-usdc", "1234.56789");
    session.answerQuiz("q05-wbtc", "0.25");
    session.answerQuiz("q05-tkn", "123.45");
    session.answerQuiz("q05-name", "opt-wbtc-name");
    expect(session.evaluation.passed).toBe(false);
  });

  it("換算クイズ不正解：WBTCの表示値を間違えるとクリアできない", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "05");
    for (const token of [USDC, WBTC, TKN]) {
      session.doRead("decimals", token);
      session.doRead("balanceOf", token, { account: USER });
      session.doRead("name", token);
      session.doRead("symbol", token);
      session.doRead("totalSupply", token);
    }
    session.answerQuiz("q05-usdc", "1234.56789");
    session.answerQuiz("q05-wbtc", "2.5"); // 正解は 0.25
    session.answerQuiz("q05-tkn", "123.45");
    session.answerQuiz("q05-name", "opt-wbtc-name");
    expect(session.evaluation.passed).toBe(false);
  });
});

describe("課題06 承認の棚卸しと全解除", () => {
  it("正解パターン：棚卸し→クイズ→5件すべて解除→確認でクリア", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "06");
    solve06(session);
    expect(session.evaluation.passed).toBe(true);
    expect(session.progress.totalXp).toBe(150);
    expect(session.progress.badges).toContain("allowance-auditor");
    for (const { token, spender } of AUDIT_PAIRS) {
      expect(session.engine.getAllowance(token, USER, spender)).toBe(0n);
    }
    expect(session.checklist().every((item) => item.done)).toBe(true);
  });

  it("一部解除のみ：無制限の1件だけ解除してもクリアできない", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "06");
    for (const { token, spender } of AUDIT_PAIRS) {
      session.doRead("allowance", token, { owner: USER, spender });
    }
    session.answerQuiz("q06-unlimited", "opt-lending");
    session.answerQuiz("q06-count", "5");
    session.executeWrite("approve", USDC, { spender: LENDING, amountRaw: "0" });
    expect(session.engine.getAllowance(USDC, USER, LENDING)).toBe(0n);
    expect(session.evaluation.passed).toBe(false);
  });

  it("過剰承認パターン：途中で無制限approveをするとゲートでクリアできない。リセット後は再挑戦できる", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "06");
    const request = session.requestWrite("approve", USDC, { spender: DEX, amountRaw: MAX });
    expect(request.kind).toBe("warn");
    session.executeWrite("approve", USDC, { spender: DEX, amountRaw: MAX });
    solve06(session);
    expect(session.evaluation.gate.blocked).toBe(true);
    expect(session.evaluation.passed).toBe(false);
    session.reset();
    solve06(session);
    expect(session.evaluation.passed).toBe(true);
  });
});

describe("課題07 USDT型トークンの承認変更", () => {
  it("正解パターン：確認（100）→approve 0→確認（0）→approve 200→確認（200）でクリア", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "07");
    solve07(session);
    expect(session.evaluation.passed).toBe(true);
    expect(session.progress.totalXp).toBe(150);
    expect(session.progress.badges).toContain("careful-approver");
    expect(session.engine.getAllowance(USDT, USER, DEX)).toBe(200_000_000n);
    expect(session.checklist().every((item) => item.done)).toBe(true);
  });

  it("順序違い：0を挟まず直接200にしても、最終値が合っていてもクリアできない", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "07");
    session.doRead("allowance", USDT, { owner: USER, spender: DEX });
    session.executeWrite("approve", USDT, { spender: DEX, amountRaw: "200000000" });
    session.doRead("allowance", USDT, { owner: USER, spender: DEX });
    session.answerQuiz("q07-why", "opt-spec");
    expect(session.engine.getAllowance(USDT, USER, DEX)).toBe(200_000_000n);
    expect(session.evaluation.passed).toBe(false);
  });
});

describe("課題08 レートが動くswap", () => {
  it("正解パターン：見積もり→approve 20→swap 20（1回）で19 TKNを受け取りクリア", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "08");
    solve08(session);
    expect(session.evaluation.passed).toBe(true);
    expect(session.progress.totalXp).toBe(200);
    expect(session.progress.badges).toContain("rate-reader");
    expect(session.engine.getBalance(USDC, USER)).toBe(80_000_000n);
    expect(session.engine.getBalance(TKN, USER)).toBe(19_000_000_000_000_000_000n);
    expect(session.checklist().every((item) => item.done)).toBe(true);
  });

  it("分割swap：10 USDCずつ2回では、残高が合ってもクリアできない", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "08");
    session.answerQuiz("q08-estimate", "19");
    session.executeWrite("approve", USDC, { spender: DEX, amountRaw: "20000000" });
    session.executeWrite("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
    session.executeWrite("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
    expect(session.engine.getBalance(USDC, USER)).toBe(80_000_000n);
    expect(session.engine.getBalance(TKN, USER)).toBe(19_000_000_000_000_000_000n);
    expect(session.evaluation.passed).toBe(false);
  });

  it("見積もりクイズ不正解：レートを無視した見積もりではクリアできない", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "08");
    session.doRead("balanceOf", USDC, { account: USER });
    session.answerQuiz("q08-estimate", "20"); // 正解は 19
    session.executeWrite("approve", USDC, { spender: DEX, amountRaw: "20000000" });
    session.executeWrite("swapExactUSDCForTKN", DEX, { amountInRaw: "20000000" });
    expect(session.evaluation.passed).toBe(false);
  });
});

describe("課題09 revert総復習：失敗を読み解く", () => {
  it("正解パターン：3種のrevert体験＋理由クイズ＋成功の送金と交換でクリア", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "09");
    solve09(session);
    expect(session.evaluation.passed).toBe(true);
    expect(session.progress.totalXp).toBe(200);
    expect(session.progress.badges).toContain("failure-analyst");
    expect(session.engine.getBalance(USDC, USER)).toBe(80_000_000n);
    expect(session.engine.getBalance(USDC, FRIEND)).toBe(10_000_000n);
    expect(session.engine.getBalance(TKN, USER)).toBe(10_000_000_000_000_000_000n);
    expect(session.checklist().every((item) => item.done)).toBe(true);
  });

  it("失敗なし：成功操作とクイズ正解だけではクリアできない（revert体験が必須）", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "09");
    session.doRead("balanceOf", USDC, { account: USER });
    session.answerQuiz("q09-balance", "opt-bal-ib");
    session.answerQuiz("q09-allowance", "opt-all-ia");
    session.answerQuiz("q09-zero", "opt-zero-za");
    session.executeWrite("approve", USDC, { spender: DEX, amountRaw: "10000000" });
    session.executeWrite("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
    session.executeWrite("transfer", USDC, { to: FRIEND, amountRaw: "10000000" });
    expect(session.engine.getBalance(USDC, USER)).toBe(80_000_000n);
    expect(session.evaluation.passed).toBe(false);
  });

  it("理由クイズ不正解：revertを経験しても理由を取り違えるとクリアできない", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "09");
    session.doRead("balanceOf", USDC, { account: USER });
    session.executeWrite("transfer", USDC, { to: FRIEND, amountRaw: "200000000" });
    session.answerQuiz("q09-balance", "opt-bal-ib");
    session.executeWrite("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
    session.answerQuiz("q09-allowance", "opt-all-ib"); // 正解は opt-all-ia
    session.executeWrite("transfer", USDC, { to: ZERO, amountRaw: "10000000" });
    session.answerQuiz("q09-zero", "opt-zero-za");
    session.executeWrite("approve", USDC, { spender: DEX, amountRaw: "10000000" });
    session.executeWrite("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
    session.executeWrite("transfer", USDC, { to: FRIEND, amountRaw: "10000000" });
    expect(session.evaluation.passed).toBe(false);
  });
});
