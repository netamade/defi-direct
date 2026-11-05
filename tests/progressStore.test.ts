import { describe, expect, it } from "vitest";
import {
  PROGRESS_STORAGE_KEY,
  ProgressStore,
  defaultProgressState,
  type StorageLike,
} from "../src/store/progressStore";

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
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

// 試作3課題のXP合計（100+150+200=450）を動的上限として渡す
const TOTAL_XP = 450;
const newStore = (storage: StorageLike) => new ProgressStore(storage, () => TOTAL_XP);

describe("ProgressStore", () => {
  it("未保存なら既定値で復旧する", () => {
    const store = newStore(fakeStorage());
    const { state, recovered } = store.load();
    expect(recovered).toBe(true);
    expect(state).toEqual(defaultProgressState());
  });

  it("保存→読み込みの往復が一致する", () => {
    const storage = fakeStorage();
    const store = newStore(storage);
    const state = {
      ...defaultProgressState(),
      totalXp: 100,
      clearedChallengeIds: ["01"],
      challengeStatus: { "01": "QUEST CLEAR" as const },
      badges: ["first-read"],
      quizAnswers: { "01": { "q01-decimals": "opt-1000-usdc" } },
    };
    expect(store.save(state)).toBe(true);
    const loaded = newStore(storage).load();
    expect(loaded.recovered).toBe(false);
    expect(loaded.state.totalXp).toBe(100);
    expect(loaded.state.clearedChallengeIds).toEqual(["01"]);
    expect(loaded.state.quizAnswers["01"]?.["q01-decimals"]).toBe("opt-1000-usdc");
  });

  it("壊れたJSONは既定値で復旧し、例外を投げない", () => {
    const storage = fakeStorage({ [PROGRESS_STORAGE_KEY]: "{broken json" });
    const { state, recovered, warnings } = newStore(storage).load();
    expect(recovered).toBe(true);
    expect(state.totalXp).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("バージョン不一致は既定値へフォールバックする", () => {
    const storage = fakeStorage({
      [PROGRESS_STORAGE_KEY]: JSON.stringify({ ...defaultProgressState(), version: 99 }),
    });
    const { state, recovered } = newStore(storage).load();
    expect(recovered).toBe(true);
    expect(state.totalXp).toBe(0);
  });

  it("改変された過大なXPは全課題XP合計でクランプされる（動的上限）", () => {
    const storage = fakeStorage({
      [PROGRESS_STORAGE_KEY]: JSON.stringify({ ...defaultProgressState(), totalXp: 999_999 }),
    });
    const { state, warnings } = newStore(storage).load();
    expect(state.totalXp).toBe(TOTAL_XP);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("XPは初回クリア時のみ加算され、二重付与しない", () => {
    const store = newStore(fakeStorage());
    let state = defaultProgressState();
    const first = store.markCleared(state, "01", 100, ["first-read"]);
    expect(first.awardedXp).toBe(100);
    state = first.state;
    expect(state.challengeStatus["01"]).toBe("QUEST CLEAR");

    const second = store.markCleared(state, "01", 100, ["first-read"]);
    expect(second.awardedXp).toBe(0);
    expect(second.state.totalXp).toBe(100);
    expect(second.state.badges).toEqual(["first-read"]);
  });

  it("課題リセットではクイズ回答だけが消え、クリア記録は残る", () => {
    const store = newStore(fakeStorage());
    let state = store.markCleared(defaultProgressState(), "01", 100, ["first-read"]).state;
    state = store.recordQuizAnswer(state, "01", "q01-decimals", "opt-1000-usdc");
    state = store.clearQuizAnswers(state, "01");
    expect(state.quizAnswers["01"]).toBeUndefined();
    expect(state.clearedChallengeIds).toEqual(["01"]);
    expect(state.totalXp).toBe(100);
  });

  it("エクスポート→インポートで復旧できる。不正なインポートは null", () => {
    const store = newStore(fakeStorage());
    const state = { ...defaultProgressState(), totalXp: 250, clearedChallengeIds: ["01", "02"] };
    const restored = store.importJson(store.exportJson(state));
    expect(restored?.totalXp).toBe(250);
    expect(store.importJson("not json")).toBeNull();
    expect(store.importJson(JSON.stringify({ version: 99 }))).toBeNull();
  });
});
