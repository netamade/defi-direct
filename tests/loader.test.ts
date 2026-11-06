import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildLoadedData,
  validateChallengeDefinition,
  type LoadedData,
} from "../src/data/loader";
import { Engine, engineConfigFromChallenge } from "../src/engine/executor";
import { evaluateChallenge } from "../src/scoring/evaluator";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf-8"));
}

function allChallengeFiles(): Record<string, unknown> {
  return {
    "01.json": readJson("../data/challenges/01.json"),
    "02.json": readJson("../data/challenges/02.json"),
    "03.json": readJson("../data/challenges/03.json"),
    "04.json": readJson("../data/challenges/04.json"),
    "05.json": readJson("../data/challenges/05.json"),
    "06.json": readJson("../data/challenges/06.json"),
    "07.json": readJson("../data/challenges/07.json"),
    "08.json": readJson("../data/challenges/08.json"),
    "09.json": readJson("../data/challenges/09.json"),
  };
}

function loadAll(): LoadedData {
  return buildLoadedData({
    challengeFiles: allChallengeFiles(),
    indexRaw: readJson("../data/challenges/index.json"),
    badgesRaw: readJson("../data/badges.json"),
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("ローダー（実データ）", () => {
  it("9課題がバリデーションを通過し、XP合計は index から動的に 1400 になる", () => {
    const data = loadAll();
    expect(data.invalid).toEqual([]);
    expect(data.problems).toEqual([]);
    expect(data.challenges.map((c) => c.id)).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09"]);
    expect(data.totalXp).toBe(1400);
    expect(data.badges.map((b) => b.id)).toContain("revert-reader");
  });

  it("03のJSON複製（ダミー課題10）でもエンジンと採点がそのまま動く（課題追加にエンジン改修は不要）", () => {
    const dummy = clone(readJson("../data/challenges/03.json")) as Record<string, unknown>;
    dummy["id"] = "10";
    dummy["title"] = "Dummy Swap";
    const index = clone(readJson("../data/challenges/index.json")) as {
      challenges: Record<string, unknown>[];
    };
    index.challenges.push({ id: "10", order: 10, file: "10.json", title: "Dummy Swap", bookChapter: 15, xp: 200 });

    const data = buildLoadedData({
      challengeFiles: { ...allChallengeFiles(), "10.json": dummy },
      indexRaw: index,
      badgesRaw: readJson("../data/badges.json"),
    });
    expect(data.invalid).toEqual([]);
    expect(data.totalXp).toBe(1600); // クランプ上限は動的に増える

    const def = data.byId.get("10");
    expect(def).toBeDefined();
    if (!def) return;
    const engine = new Engine(engineConfigFromChallenge(def));
    const user = def.initialState.userAddress;
    const dex = def.initialState.spenderAddresses["dex"] as string;
    const usdc = def.contracts[0]?.address as string;
    engine.write("approve", usdc, { spender: dex, amountRaw: "10000000" });
    engine.write("swapExactUSDCForTKN", dex, { amountInRaw: "10000000" });
    expect(engine.getBalance(usdc, user)).toBe(90_000_000n);
    expect(evaluateChallenge(def, engine.state, {}).passed).toBe(true);
  });
});

describe("ローダー（壊れた課題は除外され、他に影響しない）", () => {
  const base = () => clone(readJson("../data/challenges/01.json")) as Record<string, unknown>;

  function expectInvalid(mutate: (def: Record<string, unknown>) => void): string[] {
    const def = base();
    mutate(def);
    const { ok, errors } = validateChallengeDefinition(def);
    expect(ok).toBe(false);
    return errors;
  }

  it("必須フィールド欠落", () => {
    expectInvalid((d) => delete d["title"]).length;
  });

  it("schemaVersion 不一致", () => {
    expect(expectInvalid((d) => (d["schemaVersion"] = 2)).join("")).toContain("schemaVersion");
  });

  it("アドレス形式不正", () => {
    expectInvalid((d) => {
      (d["contracts"] as Record<string, unknown>[])[0]!["address"] = "0x123";
    });
  });

  it("decimals 範囲外（19）", () => {
    expectInvalid((d) => {
      (d["contracts"] as Record<string, unknown>[])[0]!["decimals"] = 19;
    });
  });

  it("初期残高の負数", () => {
    expectInvalid((d) => {
      const balances = (d["initialState"] as Record<string, unknown>)["balances"] as Record<
        string,
        Record<string, string>
      >;
      const token = Object.keys(balances)[0] as string;
      const account = Object.keys(balances[token] as Record<string, string>)[0] as string;
      (balances[token] as Record<string, string>)[account] = "-5";
    });
  });

  it("passCondition の未知の type", () => {
    expectInvalid((d) => {
      d["passCondition"] = { type: "unknownThing" };
    });
  });

  it("passCondition の未知のキー", () => {
    expectInvalid((d) => {
      d["passCondition"] = { type: "readSucceeded", functionName: "decimals", bogus: 1 };
    });
  });

  it("swapRate があるのに swap 明示フィールドがない", () => {
    const def = clone(readJson("../data/challenges/03.json")) as Record<string, unknown>;
    delete def["swap"];
    const { ok, errors } = validateChallengeDefinition(def);
    expect(ok).toBe(false);
    expect(errors.join("")).toContain("swap");
  });

  it("壊れた課題があっても他の課題は読み込める", () => {
    const broken = base();
    broken["schemaVersion"] = 99;
    const data = buildLoadedData({
      challengeFiles: { ...allChallengeFiles(), "01.json": broken },
      indexRaw: readJson("../data/challenges/index.json"),
      badgesRaw: readJson("../data/badges.json"),
    });
    expect(data.invalid.map((i) => i.file)).toEqual(["01.json"]);
    expect(data.challenges.map((c) => c.id)).toEqual(["02", "03", "04", "05", "06", "07", "08", "09"]);
  });
});
