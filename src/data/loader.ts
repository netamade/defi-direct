// 課題JSON・バッジJSONの読み込みとスキーマ検証（設計書 3.6 / 0.5.3）
//
// - 検証に失敗した課題は一覧に表示せず、他の課題のプレイを妨げない。
// - passCondition の未知の type・op・キーは読み込み時にエラーにする（fail-closed の入口）。
// - 実行時に評価器が検出した未知条件も fail-closed とする（scoring/evaluator.ts）。
import { isValidAddress } from "../engine/validation";
import type {
  BadgeDefinition,
  BadgesFile,
  ChallengeDefinition,
  ChallengeIndex,
  PassCondition,
} from "./types";

export interface InvalidChallenge {
  file: string;
  errors: string[];
}

export interface LoadedData {
  index: ChallengeIndex;
  /** index の順序どおりに並んだ、有効な課題定義 */
  challenges: ChallengeDefinition[];
  byId: Map<string, ChallengeDefinition>;
  invalid: InvalidChallenge[];
  badges: BadgeDefinition[];
  /** XPクランプ上限：index.json の課題XP合計（動的算出。設計書 4.6） */
  totalXp: number;
  /** データ全体の問題（index・badges の不整合など） */
  problems: string[];
}

const PASS_TYPES = new Set([
  "actionSucceeded",
  "actionFailed",
  "actionSequence",
  "balanceEquals",
  "allowanceEquals",
  "readSucceeded",
  "readResultEquals",
  "errorIdentified",
  "quizCorrect",
  "forbiddenAction",
]);

const PASS_KEYS: Record<string, string[]> = {
  actionSucceeded: ["type", "functionName", "minCount", "exactCount", "amountRaw", "spender", "contract"],
  actionFailed: ["type", "functionName", "revertCode", "minCount"],
  actionSequence: ["type", "sequence"],
  balanceEquals: ["type", "token", "account", "expectedDisplay", "expectedRaw"],
  allowanceEquals: ["type", "token", "owner", "spender", "expectedDisplay", "expectedRaw"],
  readSucceeded: ["type", "functionName", "minCount"],
  readResultEquals: ["type", "functionName", "contract", "args", "expectedDisplay", "expectedRaw"],
  errorIdentified: ["type", "questionId", "correctOptionId"],
  quizCorrect: ["type", "questionId", "correctOptionId", "correctValue"],
  forbiddenAction: ["type", "forbiddenId"],
};

const SEQUENCE_STEP_KEYS = ["functionName", "kind", "contract", "args", "returnRaw", "status"];

/** forbiddenAction.match.condition の解釈可能形式（scoring 側と共通の文法） */
export const FORBIDDEN_CONDITION_PATTERN = /^([A-Za-z][A-Za-z0-9]*)\s*(==|>)\s*(maxUint256|\d+)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeIntString(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === "string");
}

function validatePassCondition(node: unknown, path: string, errors: string[]): void {
  if (!isRecord(node)) {
    errors.push(`${path}: 判定条件がオブジェクトではありません`);
    return;
  }
  if ("op" in node) {
    const op = node["op"];
    if (op !== "and" && op !== "or" && op !== "not") {
      errors.push(`${path}: 未知の op です: ${String(op)}`);
      return;
    }
    const extraKeys = Object.keys(node).filter((k) => k !== "op" && k !== "conditions" && k !== "condition");
    if (extraKeys.length > 0) errors.push(`${path}: 未知のキーがあります: ${extraKeys.join(", ")}`);
    if (op === "not") {
      validatePassCondition(node["condition"], `${path}.condition`, errors);
    } else {
      const conditions = node["conditions"];
      if (!Array.isArray(conditions) || conditions.length === 0) {
        errors.push(`${path}: conditions が空、または配列ではありません`);
        return;
      }
      conditions.forEach((child, i) => validatePassCondition(child, `${path}.conditions[${i}]`, errors));
    }
    return;
  }
  const type = node["type"];
  if (typeof type !== "string" || !PASS_TYPES.has(type)) {
    errors.push(`${path}: 未知の type です: ${String(type)}`);
    return;
  }
  const allowed = PASS_KEYS[type] ?? [];
  const extraKeys = Object.keys(node).filter((k) => !allowed.includes(k));
  if (extraKeys.length > 0) errors.push(`${path}: 未知のキーがあります: ${extraKeys.join(", ")}`);

  switch (type) {
    case "actionSucceeded":
    case "actionFailed":
    case "readSucceeded":
      if (typeof node["functionName"] !== "string") errors.push(`${path}: functionName が必要です`);
      break;
    case "actionSequence": {
      const sequence = node["sequence"];
      if (!Array.isArray(sequence) || sequence.length === 0) {
        errors.push(`${path}: sequence が空、または配列ではありません`);
        break;
      }
      sequence.forEach((step, i) => {
        if (!isRecord(step)) {
          errors.push(`${path}.sequence[${i}]: オブジェクトではありません`);
          return;
        }
        const stepExtra = Object.keys(step).filter((k) => !SEQUENCE_STEP_KEYS.includes(k));
        if (stepExtra.length > 0) {
          errors.push(`${path}.sequence[${i}]: 未知のキーがあります: ${stepExtra.join(", ")}`);
        }
        if (typeof step["functionName"] !== "string") {
          errors.push(`${path}.sequence[${i}]: functionName が必要です`);
        }
        if (step["args"] !== undefined && !isStringRecord(step["args"])) {
          errors.push(`${path}.sequence[${i}]: args は文字列のマップである必要があります`);
        }
      });
      break;
    }
    case "balanceEquals":
    case "allowanceEquals":
    case "readResultEquals":
      if (type === "readResultEquals" && typeof node["functionName"] !== "string") {
        errors.push(`${path}: functionName が必要です`);
      }
      if (!isNonNegativeIntString(node["expectedRaw"])) {
        errors.push(`${path}: expectedRaw は0以上の整数文字列である必要があります`);
      }
      if (typeof node["expectedDisplay"] !== "string") {
        errors.push(`${path}: expectedDisplay が必要です`);
      }
      break;
    case "errorIdentified":
    case "quizCorrect":
      if (typeof node["questionId"] !== "string") errors.push(`${path}: questionId が必要です`);
      break;
    case "forbiddenAction":
      if (typeof node["forbiddenId"] !== "string") errors.push(`${path}: forbiddenId が必要です`);
      break;
  }
}

/** 手順表示の条件は操作履歴とクイズだけ。状態や合否への推測フォールバックはしない。 */
function validateChecklistCondition(node: unknown, path: string, errors: string[]): void {
  if (!isRecord(node)) { errors.push(`${path}: 条件がオブジェクトではありません`); return; }
  if (node["op"] === "and" || node["op"] === "or") {
    if (Object.keys(node).some(k => k !== "op" && k !== "conditions")) errors.push(`${path}: 未知のキーがあります`);
    const children = node["conditions"];
    if (!Array.isArray(children) || children.length === 0) { errors.push(`${path}: conditions が空、または配列ではありません`); return; }
    children.forEach((child, i) => validateChecklistCondition(child, `${path}.conditions[${i}]`, errors));
    return;
  }
  if (node["type"] === "quizCorrect") {
    validatePassCondition(node, path, errors);
    if (Object.keys(node).some(k => k !== "type" && k !== "questionId")) errors.push(`${path}: 未知のキーがあります`);
    return;
  }
  if (node["type"] !== "actionSequence") { errors.push(`${path}: 手順表示の未知の条件です`); return; }
  const sequence = node["sequence"];
  if (!Array.isArray(sequence)) { errors.push(`${path}: sequence は配列である必要があります`); return; }
  // 既存条件の構造検証を流用し、手順表示専用のrevertCodeだけ追加で検証する。
  validatePassCondition({ ...node, sequence: sequence.map(action => {
    if (!isRecord(action)) return action;
    const { revertCode: _revertCode, ...step } = action;
    return step;
  }) }, path, errors);
  sequence.forEach((action, i) => {
    if (!isRecord(action)) return;
    const label = `${path}.sequence[${i}]`;
    if (action["kind"] !== "read" && action["kind"] !== "write" && action["kind"] !== "sign") errors.push(`${label}: kind は read / write / sign が必要です`);
    if (action["contract"] !== undefined && typeof action["contract"] !== "string") errors.push(`${label}: contract は文字列が必要です`);
    if (action["status"] !== undefined && action["status"] !== 0 && action["status"] !== 1) errors.push(`${label}: status は0か1が必要です`);
    if (action["returnRaw"] !== undefined && (typeof action["returnRaw"] !== "string" || action["kind"] !== "read")) errors.push(`${label}: returnRaw はReadの文字列が必要です`);
    if (action["revertCode"] !== undefined && (typeof action["revertCode"] !== "string" || action["kind"] !== "write" || action["status"] !== 0)) errors.push(`${label}: revertCode はstatus=0のWriteに指定してください`);
  });
}

/** 課題JSON 1件の検証。問題があれば errors に積む（設計書 3.6 の読み込み時バリデーション） */
export function validateChallengeDefinition(raw: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["課題データがオブジェクトではありません"] };
  const def = raw;

  if (def["schemaVersion"] !== 1) errors.push("schemaVersion が 1 ではありません");
  if (typeof def["id"] !== "string" || def["id"] === "") errors.push("id がありません");
  for (const field of ["title", "subtitle", "goal", "scenario", "successMessage", "retryMessage"] as const) {
    if (typeof def[field] !== "string") errors.push(`${field} がありません`);
  }
  if (!isRecord(def["chapter"]) || typeof def["chapter"]["bookChapter"] !== "number") {
    errors.push("chapter.bookChapter がありません");
  }
  if (def["difficulty"] !== 1 && def["difficulty"] !== 2 && def["difficulty"] !== 3) {
    errors.push("difficulty は 1〜3 である必要があります");
  }
  if (typeof def["xp"] !== "number" || def["xp"] < 0) errors.push("xp が不正です");
  if (!Array.isArray(def["badges"]) || !def["badges"].every((b) => typeof b === "string")) {
    errors.push("badges は文字列の配列である必要があります");
  }
  if (!Array.isArray(def["steps"]) || !def["steps"].every((s) => typeof s === "string")) {
    errors.push("steps は文字列の配列である必要があります");
  }
  const stepChecks = def["stepChecks"];
  if (!Array.isArray(stepChecks) || !Array.isArray(def["steps"]) || stepChecks.length !== def["steps"].length) {
    errors.push("stepChecks はstepsと同じ件数の配列が必要です");
  } else {
    stepChecks.forEach((check, i) => {
      const path = `stepChecks[${i}]`;
      if (!isRecord(check)) { errors.push(`${path}: オブジェクトが必要です`); return; }
      if (Object.keys(check).some(k => k !== "condition" && k !== "optional")) errors.push(`${path}: 未知のキーがあります`);
      if (check["optional"] !== undefined && typeof check["optional"] !== "boolean") errors.push(`${path}: optional はbooleanが必要です`);
      validateChecklistCondition(check["condition"], `${path}.condition`, errors);
    });
  }
  if (!Array.isArray(def["hints"]) || !def["hints"].every((s) => typeof s === "string")) {
    errors.push("hints は文字列の配列である必要があります");
  }

  // コントラクト
  const contracts = def["contracts"];
  if (!Array.isArray(contracts) || contracts.length === 0) {
    errors.push("contracts が空、または配列ではありません");
  } else {
    for (const contract of contracts) {
      if (!isRecord(contract)) {
        errors.push("contracts の要素がオブジェクトではありません");
        continue;
      }
      if (!isValidAddress(String(contract["address"]))) {
        errors.push(`contracts のアドレス形式が不正です: ${String(contract["address"])}`);
      }
      const decimals = contract["decimals"];
      if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
        errors.push(`decimals は 0〜18 の整数である必要があります: ${String(contract["symbol"])}`);
      }
      if (contract["isPractice"] !== true) errors.push("contracts.isPractice は true である必要があります");
    }
  }

  // 初期状態
  const initial = def["initialState"];
  if (!isRecord(initial)) {
    errors.push("initialState がありません");
  } else {
    if (!isValidAddress(String(initial["userAddress"]))) errors.push("initialState.userAddress の形式が不正です");
    if (!isNonNegativeIntString(initial["ethBalanceWei"])) {
      errors.push("initialState.ethBalanceWei は0以上の整数文字列（wei）である必要があります");
    }
    if (!isRecord(initial["spenderAddresses"])) {
      errors.push("initialState.spenderAddresses がありません");
    } else {
      for (const [key, address] of Object.entries(initial["spenderAddresses"])) {
        if (!isValidAddress(String(address))) {
          errors.push(`initialState.spenderAddresses.${key} の形式が不正です`);
        }
      }
    }
    if (!isRecord(initial["balances"])) {
      errors.push("initialState.balances がありません");
    } else {
      for (const [token, perAccount] of Object.entries(initial["balances"])) {
        if (!isValidAddress(token)) errors.push(`initialState.balances のトークンアドレスが不正です: ${token}`);
        if (!isRecord(perAccount)) continue;
        for (const [account, rawValue] of Object.entries(perAccount)) {
          if (!isValidAddress(account)) errors.push(`initialState.balances のアカウントが不正です: ${account}`);
          if (!isNonNegativeIntString(rawValue)) {
            errors.push(`初期残高は0以上の整数文字列である必要があります: ${token} / ${account}`);
          }
        }
      }
    }
    if (!isRecord(initial["allowances"])) {
      errors.push("initialState.allowances がありません");
    } else {
      for (const [key, rawValue] of Object.entries(initial["allowances"])) {
        if (!isNonNegativeIntString(rawValue)) {
          errors.push(`初期allowanceは0以上の整数文字列である必要があります: ${key}`);
        }
      }
    }
  }

  if (isRecord(initial)) {
    const flags = initial["flags"], nonces = initial["permitNonces"];
    if (flags !== undefined && (!isRecord(flags) || !Object.values(flags).every(v => typeof v === "boolean"))) errors.push("initialState.flags はbooleanのマップが必要です");
    if (nonces !== undefined && (!isRecord(nonces) || !Object.entries(nonces).every(([k,v]) => isValidAddress(k) && Number.isSafeInteger(v) && Number(v) >= 0))) errors.push("initialState.permitNonces が不正です");
  }
  if (def["airdrop"] !== undefined) {
    const drop = def["airdrop"];
    const addresses = Array.isArray(contracts) ? contracts.filter(isRecord).map(c => c["address"]) : [];
    if (!isRecord(drop) || !isValidAddress(String(drop["distributor"])) || !addresses.includes(drop["token"]) || !/^0x[0-9a-f]{64}$/i.test(String(drop["root"]))) errors.push("airdropの契約・トークン・rootが不正です");
  }

  if (def["permit"] !== undefined) {
    const permit = def["permit"];
    const token = isRecord(permit) && Array.isArray(contracts) ? contracts.filter(isRecord).find(c => c["address"] === permit["token"]) : undefined;
    if (!isRecord(permit) || !token || !Array.isArray(permit["preSigned"]) || !isRecord(permit["ownRequest"])) errors.push("permitのtoken・署名リクエストが不正です");
    else {
      const requests = [...permit["preSigned"], permit["ownRequest"]];
      const ids = new Set<string>();
      for (const request of requests) {
        if (!isRecord(request) || typeof request["id"] !== "string" || ids.has(request["id"]) ||
            request["owner"] !== (isRecord(initial) ? initial["userAddress"] : undefined) || !isValidAddress(String(request["spender"])) ||
            !Number.isSafeInteger(request["nonce"]) || Number(request["nonce"]) < 0 ||
            !["spenderLabel", "deadline", "origin", "value"].every(k => typeof request[k] === "string") ||
            (request["value"] !== "maxUint256" && !/^\d+(?:\.\d+)?$/.test(String(request["value"])))) errors.push("permitの署名データが不正です");
        else ids.add(request["id"]);
      }
    }
  }

  // 関数定義
  if (!Array.isArray(def["functions"])) {
    errors.push("functions がありません");
  } else {
    for (const fn of def["functions"]) {
      if (!isRecord(fn) || typeof fn["name"] !== "string" || (fn["kind"] !== "read" && fn["kind"] !== "write")) {
        errors.push("functions の要素が不正です（name と kind が必要です）");
      }
    }
  }

  // クイズ
  if (def["questions"] !== undefined) {
    if (!Array.isArray(def["questions"])) {
      errors.push("questions は配列である必要があります");
    } else {
      for (const q of def["questions"]) {
        if (!isRecord(q) || typeof q["questionId"] !== "string") {
          errors.push("questions の要素が不正です");
          continue;
        }
        if (q["kind"] !== "choice" && q["kind"] !== "numeric") {
          errors.push(`questions.${String(q["questionId"])}: kind は choice / numeric のいずれかです`);
        }
        if (q["kind"] === "choice" && (!Array.isArray(q["options"]) || typeof q["correctOptionId"] !== "string")) {
          errors.push(`questions.${String(q["questionId"])}: choice には options と correctOptionId が必要です`);
        }
        if (q["kind"] === "numeric" && typeof q["correctValue"] !== "string") {
          errors.push(`questions.${String(q["questionId"])}: numeric には correctValue が必要です`);
        }
      }
    }
  }

  // 禁止操作
  if (!Array.isArray(def["forbiddenActions"])) {
    errors.push("forbiddenActions がありません");
  } else {
    for (const action of def["forbiddenActions"]) {
      if (!isRecord(action) || typeof action["id"] !== "string") {
        errors.push("forbiddenActions の要素が不正です");
        continue;
      }
      if (action["mode"] !== "block" && action["mode"] !== "warn") {
        errors.push(`forbiddenActions.${action["id"]}: mode は block / warn のいずれかです`);
      }
      if (!isRecord(action["match"]) || typeof action["match"]["functionName"] !== "string") {
        errors.push(`forbiddenActions.${action["id"]}: match.functionName が必要です`);
      } else if (
        action["match"]["condition"] !== undefined &&
        (typeof action["match"]["condition"] !== "string" ||
          !FORBIDDEN_CONDITION_PATTERN.test(action["match"]["condition"]))
      ) {
        errors.push(`forbiddenActions.${action["id"]}: condition の形式が解釈できません`);
      }
    }
  }

  // swap 明示フィールド：swapRate がある課題では必須とし、参照先の実在も確認する
  if (def["swapRate"] !== undefined) {
    const swap = def["swap"];
    if (!isRecord(swap)) {
      errors.push("swapRate がある課題には swap 明示フィールド（tokenIn / tokenOut / spenderKey）が必要です");
    } else {
      const contractAddresses = Array.isArray(contracts)
        ? contracts.filter(isRecord).map((c) => String(c["address"]))
        : [];
      if (!isValidAddress(String(swap["tokenIn"])) || !contractAddresses.includes(String(swap["tokenIn"]))) {
        errors.push("swap.tokenIn は contracts に含まれるアドレスである必要があります");
      }
      if (!isValidAddress(String(swap["tokenOut"])) || !contractAddresses.includes(String(swap["tokenOut"]))) {
        errors.push("swap.tokenOut は contracts に含まれるアドレスである必要があります");
      }
      const spenders = isRecord(initial) ? initial["spenderAddresses"] : undefined;
      if (
        typeof swap["spenderKey"] !== "string" ||
        !isRecord(spenders) ||
        !(swap["spenderKey"] in spenders)
      ) {
        errors.push("swap.spenderKey は initialState.spenderAddresses のキーである必要があります");
      }
    }
  }

  if (def["vault"] !== undefined) {
    const vault = def["vault"];
    const addresses = Array.isArray(contracts) ? contracts.filter(isRecord).map(c => c["address"]) : [];
    if (!isRecord(vault) || !addresses.includes(vault["asset"]) || !addresses.includes(vault["shareToken"]) || vault["asset"] === vault["shareToken"]) errors.push("vault は異なる資産・シェアコントラクトを指定してください");
  }

  // 判定条件
  if (def["passCondition"] === undefined) {
    errors.push("passCondition がありません");
  } else {
    validatePassCondition(def["passCondition"], "passCondition", errors);
  }

  return { ok: errors.length === 0, errors };
}

export function validateBadgesFile(raw: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["バッジデータがオブジェクトではありません"] };
  if (raw["schemaVersion"] !== 1) errors.push("badges.schemaVersion が 1 ではありません");
  if (!Array.isArray(raw["badges"])) {
    errors.push("badges は配列である必要があります");
  } else {
    for (const badge of raw["badges"]) {
      if (
        !isRecord(badge) ||
        typeof badge["id"] !== "string" ||
        typeof badge["name"] !== "string" ||
        typeof badge["description"] !== "string" ||
        typeof badge["condition"] !== "string"
      ) {
        errors.push("badges の要素が不正です（id / name / description / condition が必要です）");
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateIndexFile(raw: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["課題一覧データがオブジェクトではありません"] };
  if (raw["schemaVersion"] !== 1) errors.push("index.schemaVersion が 1 ではありません");
  if (!Array.isArray(raw["challenges"])) {
    errors.push("index.challenges は配列である必要があります");
  } else {
    for (const entry of raw["challenges"]) {
      if (
        !isRecord(entry) ||
        typeof entry["id"] !== "string" ||
        typeof entry["file"] !== "string" ||
        typeof entry["xp"] !== "number"
      ) {
        errors.push("index.challenges の要素が不正です（id / file / xp が必要です）");
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 読み込んだ生データ群（ファイル名 → パース済みJSON）から LoadedData を組み立てる純関数。
 * テストからはファイルシステム経由で、画面からは bundled.ts 経由で同じ入口を使う。
 */
export function buildLoadedData(input: {
  challengeFiles: Record<string, unknown>;
  indexRaw: unknown;
  badgesRaw: unknown;
}): LoadedData {
  const problems: string[] = [];

  const indexCheck = validateIndexFile(input.indexRaw);
  if (!indexCheck.ok) problems.push(...indexCheck.errors.map((e) => `index.json: ${e}`));
  const index: ChallengeIndex = indexCheck.ok
    ? (input.indexRaw as ChallengeIndex)
    : { schemaVersion: 1, challenges: [] };

  const badgesCheck = validateBadgesFile(input.badgesRaw);
  if (!badgesCheck.ok) problems.push(...badgesCheck.errors.map((e) => `badges.json: ${e}`));
  const badges: BadgeDefinition[] = badgesCheck.ok ? (input.badgesRaw as BadgesFile).badges : [];

  const challenges: ChallengeDefinition[] = [];
  const byId = new Map<string, ChallengeDefinition>();
  const invalid: InvalidChallenge[] = [];

  const entries = [...index.challenges].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const entry of entries) {
    const raw = input.challengeFiles[entry.file];
    if (raw === undefined) {
      invalid.push({ file: entry.file, errors: ["課題ファイルが見つかりません"] });
      continue;
    }
    const check = validateChallengeDefinition(raw);
    if (!check.ok) {
      invalid.push({ file: entry.file, errors: check.errors });
      continue;
    }
    const def = raw as ChallengeDefinition;
    if (def.id !== entry.id) {
      invalid.push({ file: entry.file, errors: [`id が index と一致しません（index: ${entry.id} / file: ${def.id}）`] });
      continue;
    }
    challenges.push(def);
    byId.set(def.id, def);
  }

  // index に載っていない課題ファイルは無視する（開発者向けに問題として記録）
  for (const file of Object.keys(input.challengeFiles)) {
    if (!entries.some((e) => e.file === file)) {
      problems.push(`index.json に載っていない課題ファイルがあります: ${file}`);
    }
  }

  const totalXp = index.challenges.reduce((sum, entry) => sum + entry.xp, 0);
  return { index, challenges, byId, invalid, badges, totalXp, problems };
}

/** LoadedData のコンソール向け警告出力（画面には一般向け文言だけを出す） */
export function reportLoadedDataProblems(data: LoadedData): void {
  for (const problem of data.problems) console.warn(`[loader] ${problem}`);
  for (const entry of data.invalid) {
    console.warn(`[loader] 課題 ${entry.file} を読み込めませんでした: ${entry.errors.join(" / ")}`);
  }
}

export type { PassCondition };
