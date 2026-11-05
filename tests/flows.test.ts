import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLoadedData, type LoadedData } from "../src/data/loader";
import type { ChallengeDefinition } from "../src/data/types";
import { ProgressStore, type StorageLike } from "../src/store/progressStore";
import { SimulationStore } from "../src/store/simulationStore";
import { PlaySession } from "../src/ui/session";
import { levelForXp } from "../src/scoring/levels";
import { MAX_UINT256 } from "../src/engine/units";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf-8"));
}

const data: LoadedData = buildLoadedData({
  challengeFiles: {
    "01.json": readJson("../data/challenges/01.json"),
    "02.json": readJson("../data/challenges/02.json"),
    "03.json": readJson("../data/challenges/03.json"),
  },
  indexRaw: readJson("../data/challenges/index.json"),
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
  const progressStore = new ProgressStore(storage, () => data.totalXp);
  const simStore = new SimulationStore(storage);
  return new PlaySession(data, def, progressStore, simStore);
}

const USER = "0x1111111111111111111111111111111111111111";
const USDC = "0x2222222222222222222222222222222222222222";
const SPENDER01 = "0x3333333333333333333333333333333333333333";
const DEX = "0x4444444444444444444444444444444444444444";
const MAX = MAX_UINT256.toString();

function solve01(session: PlaySession): void {
  session.doRead("decimals", USDC);
  session.doRead("balanceOf", USDC, { account: USER });
  session.doRead("allowance", USDC, { owner: USER, spender: SPENDER01 });
  session.answerQuiz("q01-decimals", "opt-1000-usdc");
  session.answerQuiz("q01-allowance", "opt-500-usdc");
}

function solve02(session: PlaySession): void {
  session.doRead("allowance", USDC, { owner: USER, spender: DEX });
  const w1 = session.requestWrite("approve", USDC, { spender: DEX, amountRaw: "50000000" });
  expect(w1.kind).toBe("confirm");
  session.executeWrite("approve", USDC, { spender: DEX, amountRaw: "50000000" });
  session.doRead("allowance", USDC, { owner: USER, spender: DEX });
  session.executeWrite("approve", USDC, { spender: DEX, amountRaw: "0" });
  session.doRead("allowance", USDC, { owner: USER, spender: DEX });
}

function solve03(session: PlaySession): void {
  session.executeWrite("approve", USDC, { spender: DEX, amountRaw: "10000000" });
  session.executeWrite("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
}

describe("E2Eフロー（PlaySession 経由＝画面操作と同じ経路）", () => {
  it("課題01：Read→クイズ→クリアで XP100 とバッジが付く", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "01");
    session.doRead("decimals", USDC);
    session.doRead("balanceOf", USDC, { account: USER });
    const before = session.doRead("allowance", USDC, { owner: USER, spender: SPENDER01 });
    expect(before.clear).toBeNull(); // クイズがまだなのでクリアしない
    session.answerQuiz("q01-decimals", "opt-1000-usdc");
    const outcome = session.answerQuiz("q01-allowance", "opt-500-usdc");
    expect(outcome.evaluation.passed).toBe(true);
    expect(outcome.clear?.firstClear).toBe(true);
    expect(outcome.clear?.awardedXp).toBe(100);
    expect(outcome.clear?.newBadgeIds).toContain("first-read");
    expect(session.progress.totalXp).toBe(100);
    expect(session.status()).toBe("QUEST CLEAR");
    // 手順チェックリストがすべて完了になる
    expect(session.checklist().every((item) => item.done)).toBe(true);
  });

  it("課題02：allowance確認→approve(50)→確認(50)→approve(0)→確認(0)→クリア", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "02");
    solve02(session);
    expect(session.evaluation.passed).toBe(true);
    expect(session.progress.totalXp).toBe(150);
    expect(session.progress.badges).toContain("approval-master");
    expect(session.checklist().every((item) => item.done)).toBe(true);
  });

  it("課題03：approve(10)→swap(10・1回)→クリア。3課題通しで XP450・Lv.4 になる", () => {
    const storage = fakeStorage();
    solve01(newSession(storage, "01"));
    solve02(newSession(storage, "02"));
    const session03 = newSession(storage, "03");
    solve03(session03);
    expect(session03.evaluation.passed).toBe(true);
    expect(session03.progress.totalXp).toBe(450);
    expect(levelForXp(session03.progress.totalXp).current.level).toBe(4);
    expect(session03.progress.clearedChallengeIds).toEqual(["01", "02", "03"]);
  });

  it("分割swapフロー：5 USDCずつ2回では、残高が合ってもクリアできない", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "03");
    session.executeWrite("approve", USDC, { spender: DEX, amountRaw: "10000000" });
    session.executeWrite("swapExactUSDCForTKN", DEX, { amountInRaw: "5000000" });
    const outcome = session.executeWrite("swapExactUSDCForTKN", DEX, { amountInRaw: "5000000" });
    expect(session.engine.getBalance(USDC, USER)).toBe(90_000_000n);
    expect(outcome.evaluation.passed).toBe(false);
    expect(outcome.clear).toBeNull();
  });

  it("再クリアではXPは二重付与されない", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "01");
    solve01(session);
    expect(session.progress.totalXp).toBe(100);
    session.reset();
    const outcome = (() => {
      solve01(session);
      return session.evaluation;
    })();
    expect(outcome.passed).toBe(true);
    expect(session.progress.totalXp).toBe(100);
  });

  it("課題リセットで進捗・XP・バッジは消えず、履歴とクイズ回答は初期化される", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "01");
    solve01(session);
    expect(session.progress.totalXp).toBe(100);
    const outcome = session.reset();
    expect(session.progress.totalXp).toBe(100);
    expect(session.progress.clearedChallengeIds).toContain("01");
    expect(session.progress.badges).toContain("first-read");
    expect(session.quizAnswers()).toEqual({});
    expect(session.state.callLog).toEqual([]);
    expect(session.state.attemptId).toBe(2);
    expect(outcome.evaluation.passed).toBe(false);
  });

  it("シミュレーション状態は保存され、別セッション（再読み込み相当）で復元される", () => {
    const storage = fakeStorage();
    const first = newSession(storage, "02");
    first.doRead("allowance", USDC, { owner: USER, spender: DEX });
    first.executeWrite("approve", USDC, { spender: DEX, amountRaw: "50000000" });

    const second = newSession(storage, "02");
    expect(second.state.callLog).toHaveLength(1);
    expect(second.state.txLog).toHaveLength(1);
    expect(second.engine.getAllowance(USDC, USER, DEX)).toBe(50_000_000n);
    // 続きから完了できる
    second.doRead("allowance", USDC, { owner: USER, spender: DEX });
    second.executeWrite("approve", USDC, { spender: DEX, amountRaw: "0" });
    second.doRead("allowance", USDC, { owner: USER, spender: DEX });
    expect(second.evaluation.passed).toBe(true);
  });

  it("revert体験フロー：allowance不足でswapがrevertし、理由クイズ正解で revert-reader バッジ", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "03");
    const { result } = session.executeWrite("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
    expect(result.kind).toBe("revert");
    const wrong = session.answerRevertQuiz("swapExactUSDCForTKN", "INSUFFICIENT_BALANCE");
    expect(wrong.correct).toBe(false);
    const answer = session.answerRevertQuiz("swapExactUSDCForTKN", "INSUFFICIENT_ALLOWANCE");
    expect(answer.correct).toBe(true);
    expect(answer.awardedBadge).toBe("revert-reader");
    expect(session.progress.badges).toContain("revert-reader");
    // 発展チェックリスト項目が完了扱いになる
    const optional = session.checklist().find((item) => item.optional);
    expect(optional?.done).toBe(true);
  });

  it("禁止操作フロー：無制限approveは warn が返り、送信するとゲートでクリアできない。リセット後は再挑戦できる", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "02");
    const request = session.requestWrite("approve", USDC, { spender: DEX, amountRaw: MAX });
    expect(request.kind).toBe("warn");
    session.executeWrite("approve", USDC, { spender: DEX, amountRaw: MAX });
    solve02(session);
    expect(session.evaluation.gate.blocked).toBe(true);
    expect(session.evaluation.passed).toBe(false);
    session.reset();
    solve02(session);
    expect(session.evaluation.passed).toBe(true);
  });

  it("禁止操作フロー：mode=block の課題では送信リクエスト自体が blocked になる", () => {
    const storage = fakeStorage();
    const def = data.byId.get("02") as ChallengeDefinition;
    const blockedDef: ChallengeDefinition = {
      ...def,
      forbiddenActions: def.forbiddenActions.map((a) => ({ ...a, mode: "block" as const })),
    };
    const progressStore = new ProgressStore(storage, () => data.totalXp);
    const session = new PlaySession(data, blockedDef, progressStore, new SimulationStore(storage));
    const request = session.requestWrite("approve", USDC, { spender: DEX, amountRaw: MAX });
    expect(request.kind).toBe("blocked");
  });

  it("RETRYフロー：区切ってからクリアすると retry-master バッジが付く", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "01");
    session.doRead("decimals", USDC);
    session.markRetry();
    expect(session.status()).toBe("RETRY");
    solve01(session);
    expect(session.evaluation.passed).toBe(true);
    expect(session.progress.badges).toContain("retry-master");
    expect(session.status()).toBe("QUEST CLEAR");
  });

  it("送信前確認プレビュー：approve の allowance 変化とガスが予測できる", () => {
    const storage = fakeStorage();
    const session = newSession(storage, "02");
    const request = session.requestWrite("approve", USDC, { spender: DEX, amountRaw: "50000000" });
    expect(request.kind).toBe("confirm");
    if (request.kind === "confirm") {
      expect(request.preview.gasUsed).toBe(45_000);
      expect(request.preview.gasFeeEth).toBe("0.0009");
      expect(request.preview.diffs[0]?.after).toContain("50");
    }
    // プレビューでは状態は変わらない
    expect(session.state.txLog).toHaveLength(0);
  });
});
