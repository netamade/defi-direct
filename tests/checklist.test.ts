import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLoadedData, validateChallengeDefinition } from "../src/data/loader";
import { serializeState, allowanceKey } from "../src/engine/state";
import { PlaySession } from "../src/ui/session";
import { ProgressStore, type StorageLike } from "../src/store/progressStore";
import { SimulationStore } from "../src/store/simulationStore";
import type { ChallengeDefinition } from "../src/data/types";

const json = (name: string) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
const data = buildLoadedData({
  challengeFiles: Object.fromEntries(readdirSync(new URL("../data/challenges", import.meta.url))
    .filter(name => name !== "index.json").map(name => [name, json(`challenges/${name}`)])),
  indexRaw: json("challenges/index.json"), badgesRaw: json("badges.json"),
});
const U = "0x" + "1".repeat(40), C = "0x" + "2".repeat(40), F = "0x" + "3".repeat(40);
const D = "0x" + "4".repeat(40), T = "0x" + "5".repeat(40), W = "0x" + "a".repeat(40);
const Z = "0x" + "0".repeat(40);
function storage(): StorageLike {
  const map = new Map<string, string>();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: k => { map.delete(k); } };
}
function session(id = "11", store = storage(), def = data.byId.get(id)!): PlaySession {
  return new PlaySession(data, def, new ProgressStore(store, () => ({ challengeXp: new Map(data.challenges.map(c => [c.id, c.xp])), badgeIds: new Set(data.badges.map(b => b.id)) })), new SimulationStore(store));
}
const done = (s: PlaySession) => s.checklist().map(item => item.done);
const withdrawFromFriend = (s: PlaySession, amountRaw: string) => s.executeWrite("transferFrom", C, { from: F, to: U, amountRaw });
const readAllowance = (s: PlaySession) => s.doRead("allowance", C, { owner: F, spender: U });

describe("手順チェックリスト：課題11の回帰", () => {
  it("各revertは直後に該当手順だけを完了し、最終確認には承認と両者のReadが必要", () => {
    const s = session();
    expect(done(s)).toEqual([false, false, false, false, false]);
    readAllowance(s);
    expect(done(s)).toEqual([true, false, false, false, false]);
    expect(withdrawFromFriend(s, "101000000").result.kind).toBe("revert");
    expect(done(s)).toEqual([true, true, false, false, false]);
    expect(withdrawFromFriend(s, "80000000").result.kind).toBe("revert");
    expect(done(s)).toEqual([true, true, true, false, false]);
    expect(withdrawFromFriend(s, "20000000").result.kind).toBe("success");
    expect(done(s)).toEqual([true, true, true, true, false]);
    readAllowance(s);
    expect(done(s)).toEqual([true, true, true, true, false]);
    // 合否の既存仕様はそのまま。クリアしても未実施のReadにはチェックを付けない。
    expect(s.evaluation.passed).toBe(true);
    s.doRead("balanceOf", C, { account: U });
    expect(done(s)).toEqual([true, true, true, true, false]);
    s.doRead("balanceOf", C, { account: F });
    expect(done(s)).toEqual([true, true, true, true, true]);
  });

  it("20 USDCの成功だけでは、101と80のrevert手順や未実施Readを完了しない", () => {
    const s = session();
    withdrawFromFriend(s, "20000000");
    expect(done(s)).toEqual([false, false, false, true, false]);
    expect(s.evaluation.passed).toBe(false);
  });

  it("数量・宛先・revert理由が異なる試行は該当手順を完了しない", () => {
    const s = session();
    withdrawFromFriend(s, "102000000"); // 同じrevert理由、異なる量
    s.executeWrite("transferFrom", C, { from: F, to: F, amountRaw: "20000000" });
    expect(done(s)).toEqual([false, false, false, false, false]);
    s.reset();
    s.state.allowances[allowanceKey(F, U, C)] = 0n;
    withdrawFromFriend(s, "80000000"); // 同じ量、異なるrevert理由
    expect(done(s)[2]).toBe(false);
  });

  it("最終確認の2つの残高Readは順不同でよく、重複Readでは代用できない", () => {
    const s = session(); withdrawFromFriend(s, "20000000");
    readAllowance(s);
    s.doRead("balanceOf", C, { account: F });
    s.doRead("balanceOf", C, { account: F });
    expect(done(s)[4]).toBe(false);
    s.doRead("balanceOf", C, { account: U });
    expect(done(s)[4]).toBe(true);
  });

  it("保存復元ではチェックを復元し、リセットでは過去試行の証跡を使わない", () => {
    const store = storage(), s = session("11", store);
    readAllowance(s); withdrawFromFriend(s, "101000000");
    const restored = session("11", store);
    expect(done(restored)).toEqual([true, true, false, false, false]);
    const old = structuredClone(restored.state.txLog[0]!);
    restored.reset();
    restored.state.txLog.push(old); // 他attemptの証跡は判定しない
    expect(done(restored)).toEqual([false, false, false, false, false]);
  });

  it("文章や課題IDを変えても対応は変わらず、禁止操作ゲートとも独立", () => {
    const original = data.byId.get("11")!;
    const def: ChallengeDefinition = { ...original, id: "99", steps: original.steps.map((_, i) => `Step ${i + 1}`),
      forbiddenActions: [{ id: "test-gate", description: "テスト", mode: "warn", match: { functionName: "transferFrom" } }] };
    const s = session("99", storage(), def);
    withdrawFromFriend(s, "80000000");
    expect(s.evaluation.gate.blocked).toBe(true);
    expect(done(s)).toEqual([false, false, true, false, false]);
  });
});

describe("他課題でも操作自身の証跡を判定", () => {
  it("全12課題の手順条件は有効で、未操作ではチェックされない", () => {
    expect(data.invalid).toEqual([]); expect(data.problems).toEqual([]);
    for (const def of data.challenges) {
      expect(def.stepChecks).toHaveLength(def.steps.length);
      expect(done(session(def.id))).toEqual(def.steps.map(() => false));
    }
  });

  it("課題02：同じ返却値0でも解除後のReadを先にチェックしない", () => {
    const s = session("02");
    s.doRead("allowance", C, { owner: U, spender: D });
    expect(done(s)).toEqual([true, false, false, false, false]);
    s.executeWrite("approve", C, { spender: D, amountRaw: "1000000" });
    expect(done(s)).toEqual([true, false, false, false, false]);
    s.executeWrite("approve", C, { spender: D, amountRaw: "50000000" });
    expect(done(s)).toEqual([true, true, false, false, false]);
    s.doRead("allowance", C, { owner: U, spender: D });
    expect(done(s)).toEqual([true, true, true, false, false]);
    s.executeWrite("approve", C, { spender: D, amountRaw: "0" });
    expect(done(s)).toEqual([true, true, true, true, false]);
    s.doRead("allowance", C, { owner: U, spender: D });
    expect(done(s)).toEqual([true, true, true, true, true]);
  });

  it("課題05：1トークンの反復Queryでは3トークン確認を完了しない", () => {
    const s = session("05");
    for (let i = 0; i < 3; i++) s.doRead("decimals", C);
    expect(done(s)[0]).toBe(false);
    for (const token of s.def.contracts) s.doRead("decimals", token.address);
    expect(done(s)[0]).toBe(true);
  });

  it("課題09：revertとそれぞれの理由クイズを独立してチェック", () => {
    const s = session("09");
    s.executeWrite("transfer", C, { to: F, amountRaw: "200000000" });
    expect(done(s)).toEqual([false, true, false, false, false, false, false, false, false, false]);
    s.answerQuiz("q09-balance", "opt-bal-ib");
    expect(done(s)[2]).toBe(true); expect(done(s)[4]).toBe(false); expect(done(s)[6]).toBe(false);
    s.executeWrite("transfer", C, { to: Z, amountRaw: "1" });
    expect(done(s)[5]).toBe(true);
  });

  it("課題10：deposit後とwithdraw後のbalanceOfを初回Readで代用しない", () => {
    const s = session("10");
    s.doRead("balanceOf", W, { account: U });
    expect(done(s)).toEqual([true, false, false, false, false]);
    s.executeWrite("deposit", W, { valueRaw: "100000000000000000" });
    expect(done(s)).toEqual([true, true, false, false, false]);
    s.doRead("balanceOf", W, { account: U });
    expect(done(s)).toEqual([true, true, true, false, false]);
    s.executeWrite("withdraw", W, { amountRaw: "40000000000000000" });
    expect(done(s)).toEqual([true, true, true, true, false]);
    s.doRead("balanceOf", W, { account: U });
    expect(done(s)).toEqual([true, true, true, true, true]);
  });

  it("課題12：最低量20のrevertと最低量19の成功を別々にチェック", () => {
    const s = session("12");
    s.doRead("getAmountsOut", D, { amountInRaw: "20000000" });
    expect(done(s)).toEqual([true, false, false, false, false]);
    s.executeWrite("approve", C, { spender: D, amountRaw: "20000000" });
    expect(done(s)).toEqual([true, true, false, false, false]);
    s.executeWrite("swapExactUSDCForTKN", D, { amountInRaw: "20000000", amountOutMinRaw: "20000000000000000000" });
    expect(done(s)).toEqual([true, true, true, false, false]);
    s.executeWrite("swapExactUSDCForTKN", D, { amountInRaw: "20000000", amountOutMinRaw: "19000000000000000000" });
    expect(done(s)).toEqual([true, true, true, true, false]);
    s.doRead("balanceOf", T, { account: U });
    expect(done(s)).toEqual([true, true, true, true, true]);
  });
});

describe("手順メタデータの読み込み検証", () => {
  it.each([
    (d: any) => { delete d.stepChecks; },
    (d: any) => { d.stepChecks.pop(); },
    (d: any) => { d.stepChecks[0].condition.sequence[0].typo = "bad"; },
    (d: any) => { d.stepChecks[0].condition.sequence[0].status = 2; },
    (d: any) => { d.stepChecks[1].condition.sequence[0].revertCode = 123; },
    (d: any) => { d.stepChecks[4].condition.conditions[0].sequence = []; },
    (d: any) => { d.stepChecks[0].optional = "yes"; },
  ])("欠落・件数ずれ・不正な条件を拒否する (%#)", mutate => {
    const def = structuredClone(data.byId.get("11")!);
    mutate(def);
    const result = validateChallengeDefinition(def);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("stepChecks");
  });
});

describe("送信前予測は全Writeでrevertを考慮", () => {
  it.each(["101000000", "80000000"])("transferFrom %s は負の予測ではなく残高不変とガスのみ消費を表示", amountRaw => {
    const s = session(), before = serializeState(s.state), progress = structuredClone(s.progress);
    const p = s.previewWrite("transferFrom", C, { from: F, to: U, amountRaw });
    expect(p.diffs).toEqual([]);
    expect(p.warning).toContain("revert予測");
    expect(p.warning).toContain("トークン残高・allowanceは変わらず");
    expect(p.warning).toContain("ガス代のみ消費");
    expect(p.warning).not.toContain("DEX");
    expect(serializeState(s.state)).toEqual(before);
    expect(s.progress).toEqual(progress);
  });

  it("成功するtransferFromは従来の3つの予測値を維持", () => {
    const s = session(), before = serializeState(s.state);
    const p = s.previewWrite("transferFrom", C, { from: F, to: U, amountRaw: "20000000" });
    expect(p.warning).toBeUndefined();
    expect(p.diffs.map(d => d.after)).toEqual([
      "40 USDC（raw 40000000、decimals 6）", "20 USDC（raw 20000000、decimals 6）", "80 USDC（raw 80000000、decimals 6）",
    ]);
    expect(serializeState(s.state)).toEqual(before);
  });

  it.each([
    ["approve", C, { spender: Z, amountRaw: "1" }],
    ["transfer", C, { to: U, amountRaw: "9999999999999" }],
    ["swapExactUSDCForTKN", D, { amountInRaw: "10000000" }],
  ] as const)("%sのrevertも成功予測を表示しない", (name, contract, args) => {
    const s = session("09"), before = serializeState(s.state);
    const p = s.previewWrite(name, contract, args);
    expect(p.diffs).toEqual([]); expect(p.warning).toContain("revert予測");
    expect(serializeState(s.state)).toEqual(before);
  });

  it("ガス不足は未送信であることを明示し、revertとも区別する", () => {
    const s = session(); s.state.accounts[U]!.ethBalanceWei = 0n;
    const before = serializeState(s.state);
    const p = s.previewWrite("transferFrom", C, { from: F, to: U, amountRaw: "20000000" });
    expect(p.diffs).toEqual([]); expect(p.warning).toContain("送信されず");
    expect(p.warning).not.toContain("revert予測");
    expect(serializeState(s.state)).toEqual(before);
  });
});
