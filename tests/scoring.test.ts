import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLoadedData } from "../src/data/loader";
import type { ChallengeDefinition, PassCondition } from "../src/data/types";
import { Engine, engineConfigFromChallenge } from "../src/engine/executor";
import { MAX_UINT256 } from "../src/engine/units";
import { evaluateChallenge, normalizeNumericAnswer } from "../src/scoring/evaluator";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf-8"));
}

const data = buildLoadedData({
  challengeFiles: {
    "01.json": readJson("../data/challenges/01.json"),
    "02.json": readJson("../data/challenges/02.json"),
    "03.json": readJson("../data/challenges/03.json"),
  },
  indexRaw: readJson("../data/challenges/index.json"),
  badgesRaw: readJson("../data/badges.json"),
});

const def01 = data.byId.get("01") as ChallengeDefinition;
const def02 = data.byId.get("02") as ChallengeDefinition;
const def03 = data.byId.get("03") as ChallengeDefinition;

const USER = "0x1111111111111111111111111111111111111111";
const USDC = "0x2222222222222222222222222222222222222222";
const SPENDER01 = "0x3333333333333333333333333333333333333333";
const DEX = "0x4444444444444444444444444444444444444444";
const ZERO = "0x0000000000000000000000000000000000000000";
const MAX = MAX_UINT256.toString();

function engineFor(def: ChallengeDefinition): Engine {
  return new Engine(engineConfigFromChallenge(def));
}

function solve02(engine: Engine): void {
  engine.read("allowance", USDC, { owner: USER, spender: DEX });
  engine.write("approve", USDC, { spender: DEX, amountRaw: "50000000" });
  engine.read("allowance", USDC, { owner: USER, spender: DEX });
  engine.write("approve", USDC, { spender: DEX, amountRaw: "0" });
  engine.read("allowance", USDC, { owner: USER, spender: DEX });
}

describe("課題01 Contract Explorer", () => {
  it("正解パターン：3つのRead＋クイズ2問正解で合格", () => {
    const engine = engineFor(def01);
    engine.read("decimals", USDC);
    engine.read("balanceOf", USDC, { account: USER });
    engine.read("allowance", USDC, { owner: USER, spender: SPENDER01 });
    const result = evaluateChallenge(def01, engine.state, {
      "q01-decimals": "opt-1000-usdc",
      "q01-allowance": "opt-500-usdc",
    });
    expect(result.passed).toBe(true);
    expect(result.unmet).toEqual([]);
  });

  it("不合格パターン：Readが1つ欠けると不合格", () => {
    const engine = engineFor(def01);
    engine.read("decimals", USDC);
    engine.read("balanceOf", USDC, { account: USER });
    const result = evaluateChallenge(def01, engine.state, {
      "q01-decimals": "opt-1000-usdc",
      "q01-allowance": "opt-500-usdc",
    });
    expect(result.passed).toBe(false);
  });

  it("不合格パターン：クイズ不正解では不合格", () => {
    const engine = engineFor(def01);
    engine.read("decimals", USDC);
    engine.read("balanceOf", USDC, { account: USER });
    engine.read("allowance", USDC, { owner: USER, spender: SPENDER01 });
    const result = evaluateChallenge(def01, engine.state, {
      "q01-decimals": "opt-1000000-usdc",
      "q01-allowance": "opt-500-usdc",
    });
    expect(result.passed).toBe(false);
  });
});

describe("課題02 Approval Master", () => {
  it("正解パターン：確認→承認→確認→解除→確認の部分列で合格", () => {
    const engine = engineFor(def02);
    solve02(engine);
    expect(evaluateChallenge(def02, engine.state, {}).passed).toBe(true);
  });

  it("部分列判定：途中に他のReadが混ざっても合格", () => {
    const engine = engineFor(def02);
    engine.read("allowance", USDC, { owner: USER, spender: DEX });
    engine.read("balanceOf", USDC, { account: USER }); // 余分なRead
    engine.write("approve", USDC, { spender: DEX, amountRaw: "50000000" });
    engine.read("decimals", USDC); // 余分なRead
    engine.read("allowance", USDC, { owner: USER, spender: DEX });
    engine.write("approve", USDC, { spender: DEX, amountRaw: "0" });
    engine.read("allowance", USDC, { owner: USER, spender: DEX });
    expect(evaluateChallenge(def02, engine.state, {}).passed).toBe(true);
  });

  it("不合格パターン：数量違い（40 USDCの承認）", () => {
    const engine = engineFor(def02);
    engine.read("allowance", USDC, { owner: USER, spender: DEX });
    engine.write("approve", USDC, { spender: DEX, amountRaw: "40000000" });
    engine.read("allowance", USDC, { owner: USER, spender: DEX });
    engine.write("approve", USDC, { spender: DEX, amountRaw: "0" });
    engine.read("allowance", USDC, { owner: USER, spender: DEX });
    expect(evaluateChallenge(def02, engine.state, {}).passed).toBe(false);
  });

  it("不合格パターン：順序違い（最初のallowance確認なし）", () => {
    const engine = engineFor(def02);
    engine.write("approve", USDC, { spender: DEX, amountRaw: "50000000" });
    engine.read("allowance", USDC, { owner: USER, spender: DEX });
    engine.write("approve", USDC, { spender: DEX, amountRaw: "0" });
    engine.read("allowance", USDC, { owner: USER, spender: DEX });
    expect(evaluateChallenge(def02, engine.state, {}).passed).toBe(false);
  });

  it("不合格パターン：最終状態だけ0でも、過程（シーケンス）がなければ不合格", () => {
    const engine = engineFor(def02);
    engine.write("approve", USDC, { spender: DEX, amountRaw: "50000000" });
    engine.write("approve", USDC, { spender: DEX, amountRaw: "0" });
    expect(engine.getAllowance(USDC, USER, DEX)).toBe(0n);
    expect(evaluateChallenge(def02, engine.state, {}).passed).toBe(false);
  });

  it("過剰承認パターン：無制限approveはゲートで不合格。解除して最終0でも同じ試行では合格しない", () => {
    const engine = engineFor(def02);
    engine.write("approve", USDC, { spender: DEX, amountRaw: MAX });
    solve02(engine); // 正しい流れをやり直しても……
    const result = evaluateChallenge(def02, engine.state, {});
    expect(result.gate.blocked).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("過剰承認パターン：リセット後の再挑戦では合格できる", () => {
    const engine = engineFor(def02);
    engine.write("approve", USDC, { spender: DEX, amountRaw: MAX });
    engine.reset();
    solve02(engine);
    const result = evaluateChallenge(def02, engine.state, {});
    expect(result.gate.blocked).toBe(false);
    expect(result.passed).toBe(true);
  });

  it("revertパターン：revertしたapproveはシーケンスに数えられない", () => {
    const engine = engineFor(def02);
    engine.read("allowance", USDC, { owner: USER, spender: DEX });
    const reverted = engine.write("approve", USDC, { spender: ZERO, amountRaw: "50000000" });
    expect(reverted.kind).toBe("revert");
    // revertの後に正しい流れを通しても、最初のapproveがrevertでは過程が不足する
    engine.read("allowance", USDC, { owner: USER, spender: DEX });
    engine.write("approve", USDC, { spender: DEX, amountRaw: "0" });
    engine.read("allowance", USDC, { owner: USER, spender: DEX });
    expect(evaluateChallenge(def02, engine.state, {}).passed).toBe(false);
    // 正しいapproveを挟めば合格する（revertが混ざっても部分列は成立する）
    const engine2 = engineFor(def02);
    engine2.write("approve", USDC, { spender: ZERO, amountRaw: "1" }); // 先にrevertを経験
    solve02(engine2);
    expect(evaluateChallenge(def02, engine2.state, {}).passed).toBe(true);
  });
});

describe("課題03 Swap Challenge", () => {
  it("正解パターン：approve 10 → swap 10（1回）で合格", () => {
    const engine = engineFor(def03);
    engine.write("approve", USDC, { spender: DEX, amountRaw: "10000000" });
    engine.write("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
    expect(evaluateChallenge(def03, engine.state, {}).passed).toBe(true);
  });

  it("分割swapパターン：5＋5の2回では最終残高が同じでも不合格（exactCount 1）", () => {
    const engine = engineFor(def03);
    engine.write("approve", USDC, { spender: DEX, amountRaw: "10000000" });
    engine.write("swapExactUSDCForTKN", DEX, { amountInRaw: "5000000" });
    engine.write("swapExactUSDCForTKN", DEX, { amountInRaw: "5000000" });
    expect(engine.getBalance(USDC, USER)).toBe(90_000_000n); // 残高条件だけなら満たす
    expect(evaluateChallenge(def03, engine.state, {}).passed).toBe(false);
  });

  it("不合格パターン：数量違いのswap（5 USDC）", () => {
    const engine = engineFor(def03);
    engine.write("approve", USDC, { spender: DEX, amountRaw: "10000000" });
    engine.write("swapExactUSDCForTKN", DEX, { amountInRaw: "5000000" });
    expect(evaluateChallenge(def03, engine.state, {}).passed).toBe(false);
  });

  it("revertパターン：allowance不足のswapは actionFailed として数えられる", () => {
    const def: ChallengeDefinition = {
      ...def03,
      passCondition: {
        type: "actionFailed",
        functionName: "swapExactUSDCForTKN",
        revertCode: "INSUFFICIENT_ALLOWANCE",
      } satisfies PassCondition,
    };
    const engine = engineFor(def03);
    expect(evaluateChallenge(def, engine.state, {}).passed).toBe(false);
    const result = engine.write("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
    expect(result.kind).toBe("revert");
    expect(evaluateChallenge(def, engine.state, {}).passed).toBe(true);
  });

  it("過剰承認パターン：課題03でも無制限approveはゲートで不合格", () => {
    const engine = engineFor(def03);
    engine.write("approve", USDC, { spender: DEX, amountRaw: MAX });
    engine.write("swapExactUSDCForTKN", DEX, { amountInRaw: "10000000" });
    const result = evaluateChallenge(def03, engine.state, {});
    expect(result.gate.blocked).toBe(true);
    expect(result.passed).toBe(false);
  });
});

describe("リセット後の再挑戦パターン", () => {
  it("過去の試行の履歴は判定に使われない", () => {
    const engine = engineFor(def02);
    solve02(engine);
    expect(evaluateChallenge(def02, engine.state, {}).passed).toBe(true);
    engine.reset();
    const result = evaluateChallenge(def02, engine.state, {});
    expect(result.passed).toBe(false);
    // 新しい試行で途中まで進めても、前の試行の履歴では補完されない
    engine.read("allowance", USDC, { owner: USER, spender: DEX });
    engine.write("approve", USDC, { spender: DEX, amountRaw: "50000000" });
    expect(evaluateChallenge(def02, engine.state, {}).passed).toBe(false);
  });
});

describe("fail-closedパターン", () => {
  function defWith(condition: unknown): ChallengeDefinition {
    return { ...def01, passCondition: condition as PassCondition };
  }

  it("未知の type は不合格＋警告", () => {
    const engine = engineFor(def01);
    const result = evaluateChallenge(defWith({ type: "unknownThing" }), engine.state, {});
    expect(result.passed).toBe(false);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("未知の op は不合格＋警告", () => {
    const engine = engineFor(def01);
    const result = evaluateChallenge(
      defWith({ op: "xor", conditions: [{ type: "readSucceeded", functionName: "decimals" }] }),
      engine.state,
      {},
    );
    expect(result.passed).toBe(false);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("未知のキーが混ざった条件は不合格＋警告", () => {
    const engine = engineFor(def01);
    engine.read("decimals", USDC);
    const result = evaluateChallenge(
      defWith({ type: "readSucceeded", functionName: "decimals", bogus: true }),
      engine.state,
      {},
    );
    expect(result.passed).toBe(false);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("balanceEquals の expectedDisplay と expectedRaw が換算不一致なら不合格＋警告", () => {
    const engine = engineFor(def01);
    const result = evaluateChallenge(
      defWith({
        type: "balanceEquals",
        token: USDC,
        account: "user",
        expectedDisplay: "999", // raw 1000000000 は表示値 1000 のはず
        expectedRaw: "1000000000",
      }),
      engine.state,
      {},
    );
    expect(result.passed).toBe(false);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });
});

describe("readResultEquals", () => {
  it("最新の該当Readの返却値で判定する", () => {
    const def: ChallengeDefinition = {
      ...def01,
      passCondition: {
        type: "readResultEquals",
        functionName: "allowance",
        contract: USDC,
        args: { owner: "user", spender: SPENDER01 },
        expectedDisplay: "500",
        expectedRaw: "500000000",
      } satisfies PassCondition,
    };
    const engine = engineFor(def01);
    expect(evaluateChallenge(def, engine.state, {}).passed).toBe(false);
    engine.read("allowance", USDC, { owner: USER, spender: SPENDER01 });
    expect(evaluateChallenge(def, engine.state, {}).passed).toBe(true);
  });
});

describe("クイズ数値回答の正規化（設計書 4.5）", () => {
  it("正規化の例が仕様どおりになる", () => {
    expect(normalizeNumericAnswer("1,000")).toBe("1000");
    expect(normalizeNumericAnswer("1000.00")).toBe("1000");
    expect(normalizeNumericAnswer("1000 USDC", "USDC")).toBe("1000");
    expect(normalizeNumericAnswer("1000usdc", "USDC")).toBe("1000");
    expect(normalizeNumericAnswer("0.500")).toBe("0.5");
    expect(normalizeNumericAnswer("１０００")).toBe("1000");
    expect(normalizeNumericAnswer("1000.01")).toBe("1000.01");
    expect(normalizeNumericAnswer("999")).toBe("999");
  });

  it("numeric クイズは正規化して比較する", () => {
    const def: ChallengeDefinition = {
      ...def01,
      questions: [
        { questionId: "q-num", kind: "numeric", prompt: "いくつ？", correctValue: "1000", unit: "USDC" },
      ],
      passCondition: { type: "quizCorrect", questionId: "q-num" } satisfies PassCondition,
    };
    const engine = engineFor(def01);
    expect(evaluateChallenge(def, engine.state, { "q-num": "1,000" }).passed).toBe(true);
    expect(evaluateChallenge(def, engine.state, { "q-num": "1000.00" }).passed).toBe(true);
    expect(evaluateChallenge(def, engine.state, { "q-num": "1000 USDC" }).passed).toBe(true);
    expect(evaluateChallenge(def, engine.state, { "q-num": "1000.01" }).passed).toBe(false);
    expect(evaluateChallenge(def, engine.state, { "q-num": "999" }).passed).toBe(false);
  });
});
