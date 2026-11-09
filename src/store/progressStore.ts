// 進捗ストア（設計書 4.6 / docs/progress-store.md）
//
// - 保存先は localStorage キー `chokukon_progress_v1`（StorageLike を注入可能にし、テスト可能にする）
// - 読み込みは必ず検証を通し、破損時は既定値で復旧する（クラッシュさせない）
// - totalXp は既知のクリア済み課題のXPから再計算する
// - XPは初回クリア時のみ加算する

export const PROGRESS_STORAGE_KEY = "chokukon_progress_v1";
export const PROGRESS_VERSION = 1;

export type ChallengeStatus = "未着手" | "IN PROGRESS" | "QUEST CLEAR" | "RETRY";

const CHALLENGE_STATUSES: readonly ChallengeStatus[] = [
  "未着手",
  "IN PROGRESS",
  "QUEST CLEAR",
  "RETRY",
];

export interface ProgressState {
  version: 1;
  totalXp: number;
  clearedChallengeIds: string[];
  challengeStatus: Record<string, ChallengeStatus>;
  badges: string[];
  quizAnswers: Record<string, Record<string, string>>;
  lastPlayedAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LoadResult {
  state: ProgressState;
  /** 既定値で復旧した（破損・バージョン不一致・未保存を含む）場合は true */
  recovered: boolean;
  warnings: string[];
}

export function defaultProgressState(): ProgressState {
  return {
    version: PROGRESS_VERSION,
    totalXp: 0,
    clearedChallengeIds: [],
    challengeStatus: {},
    badges: [],
    quizAnswers: {},
    lastPlayedAt: new Date(0).toISOString(),
  };
}

/** ブラウザでは localStorage、それ以外ではメモリ上の空ストアを返す */
export function defaultStorage(): StorageLike {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // localStorage へアクセスできない環境ではメモリストアに落とす
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    },
    removeItem: (key) => {
      memory.delete(key);
    },
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

export interface ProgressCatalog {
  challengeXp: ReadonlyMap<string, number>;
  badgeIds: ReadonlySet<string>;
}

const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);

/**
 * 未検証データを ProgressState として検証する。
 * 戻り値 null は「復旧不能（既定値へフォールバック）」を表す。
 */
export function validateProgress(
  raw: unknown,
  catalog: ProgressCatalog,
): { state: ProgressState; warnings: string[] } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  if (data["version"] !== PROGRESS_VERSION) return null;
  if (typeof data["totalXp"] !== "number" || !Number.isFinite(data["totalXp"])) return null;
  if (!isStringArray(data["clearedChallengeIds"])) return null;
  if (!isStringArray(data["badges"])) return null;
  if (typeof data["challengeStatus"] !== "object" || data["challengeStatus"] === null) return null;
  if (typeof data["quizAnswers"] !== "object" || data["quizAnswers"] === null) return null;
  if (typeof data["lastPlayedAt"] !== "string") return null;

  const warnings: string[] = [];
  const knownChallenge = (id: string) => !unsafeKeys.has(id) && catalog.challengeXp.has(id);
  const clearedChallengeIds = dedupe(data["clearedChallengeIds"]).filter(id => {
    if (knownChallenge(id)) return true;
    warnings.push(`clearedChallengeIds.${id} を除外しました`);
    return false;
  });
  const badges = dedupe(data["badges"]).filter(id => {
    if (!unsafeKeys.has(id) && catalog.badgeIds.has(id)) return true;
    warnings.push(`badges.${id} を除外しました`);
    return false;
  });

  const challengeStatus: Record<string, ChallengeStatus> = {};
  for (const [id, status] of Object.entries(data["challengeStatus"] as Record<string, unknown>)) {
    if (knownChallenge(id) && typeof status === "string" && (CHALLENGE_STATUSES as readonly string[]).includes(status)) {
      challengeStatus[id] = status as ChallengeStatus;
    } else {
      warnings.push(`challengeStatus.${id} の値が不正なため除外しました`);
    }
  }

  const quizAnswers: Record<string, Record<string, string>> = {};
  for (const [challengeId, answers] of Object.entries(data["quizAnswers"] as Record<string, unknown>)) {
    if (!knownChallenge(challengeId) || typeof answers !== "object" || answers === null || Array.isArray(answers)) {
      warnings.push(`quizAnswers.${challengeId} を除外しました`);
      continue;
    }
    const perQuestion: Record<string, string> = {};
    for (const [questionId, answer] of Object.entries(answers as Record<string, unknown>)) {
      if (!unsafeKeys.has(questionId) && typeof answer === "string") perQuestion[questionId] = answer;
      else warnings.push(`quizAnswers.${challengeId}.${questionId} を除外しました`);
    }
    quizAnswers[challengeId] = perQuestion;
  }

  const totalXp = clearedChallengeIds.reduce((sum, id) => sum + catalog.challengeXp.get(id)!, 0);
  if (totalXp !== data["totalXp"]) warnings.push("totalXp をクリア済み課題のXP合計から再計算しました");

  return {
    state: {
      version: PROGRESS_VERSION,
      totalXp,
      clearedChallengeIds,
      challengeStatus,
      badges,
      quizAnswers,
      lastPlayedAt: data["lastPlayedAt"],
    },
    warnings,
  };
}

/**
 * バージョン不一致時のマイグレーション。現行は version 1 のみのため、
 * 未知のバージョンは null（＝既定値へフォールバック）を返す。
 */
function migrateProgress(raw: unknown): unknown {
  if (typeof raw === "object" && raw !== null && (raw as Record<string, unknown>)["version"] === PROGRESS_VERSION) {
    return raw;
  }
  return null;
}

export class ProgressStore {
  private readonly storage: StorageLike;
  private readonly catalogProvider: () => ProgressCatalog;
  private lastGoodJson: string | null = null;

  /**
   * @param storage 保存先（テストではフェイクを注入する）
   * @param catalogProvider 既知の課題XPとバッジIDを返す関数
   */
  constructor(storage: StorageLike, catalogProvider: () => ProgressCatalog) {
    this.storage = storage;
    this.catalogProvider = catalogProvider;
  }

  private maxTotalXp(): number {
    return [...this.catalogProvider().challengeXp.values()].reduce((sum, xp) => sum + xp, 0);
  }

  load(): LoadResult {
    const warnings: string[] = [];
    let rawText: string | null = null;
    try {
      rawText = this.storage.getItem(PROGRESS_STORAGE_KEY);
    } catch {
      warnings.push("進捗データを読み込めませんでした");
      return { state: defaultProgressState(), recovered: true, warnings };
    }
    if (rawText === null) {
      return { state: defaultProgressState(), recovered: true, warnings };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      warnings.push("進捗データが壊れていたため、初期状態から始めます");
      return { state: defaultProgressState(), recovered: true, warnings };
    }
    const migrated = migrateProgress(parsed);
    if (migrated === null) {
      warnings.push("進捗データのバージョンが異なるため、初期状態から始めます");
      return { state: defaultProgressState(), recovered: true, warnings };
    }
    const validated = validateProgress(migrated, this.catalogProvider());
    if (validated === null) {
      warnings.push("進捗データの形式が不正なため、初期状態から始めます");
      return { state: defaultProgressState(), recovered: true, warnings };
    }
    this.lastGoodJson = JSON.stringify(validated.state);
    return { state: validated.state, recovered: false, warnings: [...warnings, ...validated.warnings] };
  }

  /**
   * 保存する。シリアライズに失敗した場合は直前の正常値を保持し、壊れた値を書き込まない。
   * @returns 保存できたら true
   */
  save(state: ProgressState): boolean {
    const validated = validateProgress(state, this.catalogProvider());
    const toSave = validated?.state ?? state;
    let json: string;
    try {
      json = JSON.stringify(toSave);
    } catch {
      return false; // 直前の正常値（lastGoodJson）を保持したまま失敗を返す
    }
    try {
      this.storage.setItem(PROGRESS_STORAGE_KEY, json);
    } catch {
      return false;
    }
    this.lastGoodJson = json;
    return true;
  }

  /** 直前の正常値（JSON文字列）。復旧用に保持する。 */
  getLastGoodJson(): string | null {
    return this.lastGoodJson;
  }

  /**
   * 課題クリアを記録する。XPは初回クリア時のみ加算し、バッジは重複付与しない。
   * @returns 更新後の進捗と、今回新たに加算されたXP
   */
  markCleared(
    state: ProgressState,
    challengeId: string,
    xp: number,
    badgeIds: string[],
  ): { state: ProgressState; awardedXp: number } {
    const alreadyCleared = state.clearedChallengeIds.includes(challengeId);
    const awardedXp = alreadyCleared ? 0 : xp;
    const next: ProgressState = {
      ...state,
      totalXp: Math.min(this.maxTotalXp(), state.totalXp + awardedXp),
      clearedChallengeIds: alreadyCleared
        ? state.clearedChallengeIds
        : [...state.clearedChallengeIds, challengeId],
      challengeStatus: { ...state.challengeStatus, [challengeId]: "QUEST CLEAR" },
      badges: dedupe([...state.badges, ...badgeIds]),
      lastPlayedAt: new Date().toISOString(),
    };
    return { state: next, awardedXp };
  }

  /** クイズ回答を記録する */
  recordQuizAnswer(state: ProgressState, challengeId: string, questionId: string, answer: string): ProgressState {
    return {
      ...state,
      quizAnswers: {
        ...state.quizAnswers,
        [challengeId]: { ...(state.quizAnswers[challengeId] ?? {}), [questionId]: answer },
      },
      lastPlayedAt: new Date().toISOString(),
    };
  }

  /** 課題リセット時：その課題のクイズ回答だけを消す（クリア記録・XP・バッジには触れない。設計書 2.7） */
  clearQuizAnswers(state: ProgressState, challengeId: string): ProgressState {
    const quizAnswers = { ...state.quizAnswers };
    delete quizAnswers[challengeId];
    return { ...state, quizAnswers };
  }

  /** エクスポート用JSON文字列（復旧手段として提供する。設計書 4.6-④） */
  exportJson(state: ProgressState): string {
    return JSON.stringify(state, null, 2);
  }

  /** インポート：整合検証を通し、不正な場合は例外ではなく null を返す */
  importJson(json: string): ProgressState | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return null;
    }
    const migrated = migrateProgress(parsed);
    if (migrated === null) return null;
    return validateProgress(migrated, this.catalogProvider())?.state ?? null;
  }

  /** 進捗リセット（進捗のみ初期化。シミュレーション状態には触れない） */
  reset(): ProgressState {
    try {
      this.storage.removeItem(PROGRESS_STORAGE_KEY);
    } catch {
      // 削除に失敗しても既定値を返し、画面側は初期状態から始められるようにする
    }
    this.lastGoodJson = null;
    return defaultProgressState();
  }
}
