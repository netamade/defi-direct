import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLoadedData } from "../src/data/loader";
import { createInitialState, serializeState, type SerializedSimulationState } from "../src/engine/state";
import { defaultProgressState, ProgressStore, PROGRESS_STORAGE_KEY, validateProgress } from "../src/store/progressStore";
import { SimulationStore, simStorageKey } from "../src/store/simulationStore";
import { PlaySession } from "../src/ui/session";

const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const data = buildLoadedData({
  challengeFiles: Object.fromEntries(readdirSync(new URL("../data/challenges", import.meta.url))
    .filter(f => f !== "index.json").map(f => [f, json(`../data/challenges/${f}`)])),
  indexRaw: json("../data/challenges/index.json"),
  badgesRaw: json("../data/badges.json"),
});
const catalog = {
  challengeXp: new Map(data.challenges.map(c => [c.id, c.xp])),
  badgeIds: new Set(data.badges.map(b => b.id)),
};
const def = data.byId.get("02")!;
function storage() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
}
function session(store: ReturnType<typeof storage>) {
  return new PlaySession(data, def, new ProgressStore(store, () => catalog), new SimulationStore(store));
}
function savedWithHistory(): SerializedSimulationState {
  const current = session(storage());
  const token = def.contracts[0]!.address;
  current.doRead("decimals", token);
  current.executeWrite("approve", token, { spender: def.initialState.spenderAddresses.dex!, amountRaw: "1" });
  expect(current.state.txLog).toHaveLength(1);
  expect(current.state.callLog).toHaveLength(1);
  return serializeState(current.state);
}

describe("simulation persistence fails closed", () => {
  const mutations: [string, (s: SerializedSimulationState) => void][] = [
    ["missing accounts", s => { delete (s as Partial<SerializedSimulationState>).accounts; }],
    ["array accounts", s => { s.accounts = [] as never; }],
    ["empty accounts", s => { s.accounts = {}; }],
    ["null account", s => { s.accounts[Object.keys(s.accounts)[0]!] = null as never; }],
    ["invalid account label", s => { Object.values(s.accounts)[0]!.label = 42 as never; }],
    ["missing current user", s => { for (const a of Object.values(s.accounts)) a.isCurrentUser = false; }],
    ["invalid nonce", s => { Object.values(s.accounts)[0]!.nonce = -1; }],
    ["non-numeric ETH", s => { Object.values(s.accounts)[0]!.ethBalanceWei = "NaN"; }],
    ["missing tokens", s => { delete (s as Partial<SerializedSimulationState>).tokens; }],
    ["array tokens", s => { s.tokens = [] as never; }],
    ["null token", s => { s.tokens[def.contracts[0]!.address] = null as never; }],
    ["missing challenge token", s => { s.tokens = {}; }],
    ["extra token", s => { const t = Object.values(s.tokens)[0]!; s.tokens.extra = { ...t, address: "extra" }; }],
    ["wrong token address", s => { Object.values(s.tokens)[0]!.address = "other"; }],
    ["mismatched decimals", s => { Object.values(s.tokens)[0]!.decimals += 1; }],
    ["negative decimals", s => { Object.values(s.tokens)[0]!.decimals = -1; }],
    ["fractional decimals", s => { Object.values(s.tokens)[0]!.decimals = 1.5; }],
    ["unsafe decimals", s => { Object.values(s.tokens)[0]!.decimals = Number.MAX_SAFE_INTEGER + 1; }],
    ["non-numeric balance", s => { Object.values(s.tokens)[0]!.balances[def.initialState.userAddress] = "oops"; }],
    ["empty balance string", s => { Object.values(s.tokens)[0]!.balances[def.initialState.userAddress] = ""; }],
    ["non-string supply", s => { Object.values(s.tokens)[0]!.totalSupplyRaw = 1 as never; }],
    ["missing balances", s => { delete (Object.values(s.tokens)[0] as { balances?: unknown }).balances; }],
    ["array allowances", s => { s.allowances = [] as never; }],
    ["invalid allowance", s => { s.allowances.bad = "1e9"; }],
    ["invalid flags", s => { s.flags = { bad: "true" } as never; }],
    ["invalid permit nonce", s => { s.permitNonces = { bad: 0.5 }; }],
    ["invalid attempt", s => { s.attemptId = "1" as never; }],
    ["missing tx field", s => { delete (s.txLog[0] as { functionName?: string }).functionName; }],
    ["invalid tx args", s => { s.txLog[0]!.args = { bad: 1 } as never; }],
    ["invalid tx diff", s => { s.txLog[0]!.stateDiff = [null] as never; }],
    ["invalid tx diff value", s => { s.txLog[0]!.stateDiff[0]!.afterRaw = "oops"; }],
    ["invalid call", s => { s.callLog[0]!.returnValueDisplay = {} as never; }],
    ["null call", s => { s.callLog = [null] as never; }],
    ["excess txLog", s => { s.txLog = Array(10_001).fill(s.txLog[0]); }],
    ["excess callLog", s => { s.callLog = Array(10_001).fill(s.callLog[0]); }],
  ];
  it.each(mutations)("%s falls back to a new playable session", (_, mutate) => {
    const saved = savedWithHistory();
    mutate(saved);
    const store = storage();
    store.setItem(simStorageKey(def.id), JSON.stringify(saved));
    expect(new SimulationStore(store).load(def.id, def.contracts)).toBeNull();
    const restored = session(store);
    expect(restored.state).toEqual(createInitialState(def.id, def.contracts, def.initialState));
    expect(() => restored.doRead("decimals", def.contracts[0]!.address)).not.toThrow();
  });
  it.each([1, 2] as const)("valid v%s retains balances and both log types", version => {
    const saved = savedWithHistory();
    saved.schemaVersion = version;
    if (version === 1) { delete saved.flags; delete saved.permitNonces; }
    const store = storage();
    store.setItem(simStorageKey(def.id), JSON.stringify(saved));
    const restored = new SimulationStore(store).load(def.id, def.contracts)!;
    expect(restored).not.toBeNull();
    expect(serializeState(restored)).toEqual({ ...saved, schemaVersion: 2, flags: saved.flags ?? {}, permitNonces: saved.permitNonces ?? {} });
    expect(session(store).state).toEqual(restored);
  });
  it.each(data.challenges)("valid initial state for $id round-trips", challenge => {
    const store = storage();
    const initial = createInitialState(challenge.id, challenge.contracts, challenge.initialState);
    const sim = new SimulationStore(store);
    expect(sim.save(initial)).toBe(true);
    expect(sim.load(challenge.id, challenge.contracts)).toEqual(initial);
  });
});

describe("progress persistence integrity", () => {
  function tampered() {
    const raw = { ...defaultProgressState(), totalXp: 999_999,
      clearedChallengeIds: ["01", "01", "unknown", "__proto__"], badges: ["first-read", "unknown"],
      challengeStatus: JSON.parse('{"01":"QUEST CLEAR","unknown":"QUEST CLEAR","__proto__":"QUEST CLEAR","constructor":"QUEST CLEAR","prototype":"RETRY"}'),
      quizAnswers: JSON.parse('{"01":{"answer":"ok","__proto__":"evil","constructor":"evil","prototype":"evil"},"unknown":{},"__proto__":{"polluted":"yes"},"constructor":{},"prototype":{}}'),
    };
    return raw;
  }
  it("filters all ID paths, skips dangerous record keys, recalculates XP, and returns warnings", () => {
    const result = validateProgress(tampered(), catalog)!;
    expect(result.state.totalXp).toBe(catalog.challengeXp.get("01"));
    expect(result.state.clearedChallengeIds).toEqual(["01"]);
    expect(result.state.badges).toEqual(["first-read"]);
    expect(result.state.challengeStatus).toEqual({ "01": "QUEST CLEAR" });
    expect(result.state.quizAnswers).toEqual({ "01": { answer: "ok" } });
    for (const record of [result.state.challengeStatus, result.state.quizAnswers, result.state.quizAnswers["01"]!]) {
      expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
      for (const key of ["__proto__", "constructor", "prototype"]) expect(Object.prototype.hasOwnProperty.call(record, key)).toBe(false);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(result.warnings.some(w => w.includes("再計算"))).toBe(true);
    for (const field of ["clearedChallengeIds", "badges", "challengeStatus", "quizAnswers"])
      expect(result.warnings.some(w => w.includes(field))).toBe(true);
  });
  it("localStorage and importJson apply the same validation", () => {
    const store = storage();
    const text = JSON.stringify(tampered());
    store.setItem(PROGRESS_STORAGE_KEY, text);
    const progress = new ProgressStore(store, () => catalog);
    const loaded = progress.load();
    expect(loaded.recovered).toBe(false);
    expect(loaded.state).toEqual(validateProgress(tampered(), catalog)!.state);
    expect(progress.importJson(text)).toEqual(loaded.state);
    expect(loaded.warnings.length).toBeGreaterThan(0);
  });
  it("valid existing progress survives both loading and import without warnings", () => {
    const good = { ...defaultProgressState(), totalXp: catalog.challengeXp.get("01")! + catalog.challengeXp.get("02")!,
      clearedChallengeIds: ["01", "02"], badges: ["first-read"], challengeStatus: { "01": "QUEST CLEAR" as const },
      quizAnswers: { "01": { "q01-decimals": "opt-1000-usdc" } } };
    const store = storage();
    store.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(good));
    const progress = new ProgressStore(store, () => catalog);
    expect(progress.load()).toEqual({ state: good, recovered: false, warnings: [] });
    expect(progress.importJson(JSON.stringify(good))).toEqual(good);
  });
});
