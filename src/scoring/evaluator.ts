import type { SignatureRecord } from "../engine/permits";
// 採点エンジン（設計書 第4節）
//
// - 入力は「現在の試行の状態・txLog・callLog」と「クイズ回答」。判定は読むだけ（状態を変えない）。
// - forbiddenAction のゲート（4.2）：該当操作が現在の試行の履歴に存在する間は、
//   passCondition の他の条件がすべて真でも合格にしない。評価前にゲートを検査する。
// - 未定義の type・op・キーは fail-closed（不合格＋警告）。未知の条件を真として扱わない（3.6 / 4.3）。
// - 最終残高・allowance の比較は raw 値の BigInt 完全一致。浮動小数点比較はしない（3.6）。
import {
  allowanceKey,
  type CallRecord,
  type SimulationState,
  type TxRecord,
} from "../engine/state";
import { formatUnits, MAX_UINT256 } from "../engine/units";
import { FORBIDDEN_CONDITION_PATTERN } from "../data/loader";
import type { ChallengeDefinition, ForbiddenAction, PassCondition, SequenceStep } from "../data/types";

export interface EvalResult {
  passed: boolean;
  /** 未達成の末端条件の説明（答えそのものは含めない） */
  unmet: string[];
  /** 判定条件自体の問題（fail-closed の理由）。画面では「クリア判定ができません」案内に使う */
  warnings: string[];
  /** forbiddenAction ゲートの状態 */
  gate: { blocked: boolean; forbiddenIds: string[] };
}

/** passCondition 内の象徴名（"user" / spenderAddresses のキー）を実アドレスへ解決する */
export function resolveSymbol(def: ChallengeDefinition, value: string): string {
  if (value === "user") return def.initialState.userAddress;
  const spender = def.initialState.spenderAddresses[value];
  if (spender) return spender;
  return value;
}

// --- クイズ数値回答の正規化（設計書 4.5） ---

const FULLWIDTH_MAP: Record<string, string> = {
  "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
  "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
  "，": ",", "　": " ", "．": ".",
};

/** 数値回答を正規化する。単位の有無・カンマ・末尾ゼロの違いを吸収する（設計書 4.5） */
export function normalizeNumericAnswer(input: string, unit?: string): string {
  let text = "";
  for (const ch of String(input)) text += FULLWIDTH_MAP[ch] ?? ch;
  text = text.trim();
  if (unit) {
    const lower = text.toLowerCase();
    const unitLower = unit.toLowerCase();
    if (lower.endsWith(unitLower)) text = text.slice(0, text.length - unit.length).trim();
  }
  text = text.replace(/[,\s]/g, "");
  const dotIndex = text.indexOf(".");
  let intPart = dotIndex >= 0 ? text.slice(0, dotIndex) : text;
  let fracPart = dotIndex >= 0 ? text.slice(dotIndex + 1) : "";
  intPart = intPart.replace(/^0+(?=\d)/, "");
  if (intPart === "") intPart = "0";
  fracPart = fracPart.replace(/0+$/, "");
  return fracPart === "" ? intPart : `${intPart}.${fracPart}`;
}

// --- forbiddenAction のマッチング ---

/**
 * match.condition の raw 値を BigInt で比較する。
 * 課題03・08は必要なapprove量（10 / 20 USDC）を条件の上限とする。
 * 必要額ちょうどは許可し、それを超える額は警告と履歴ゲートの両方で検出する。
 */
export function forbiddenConditionMatches(condition: string | undefined, args: Record<string, string>): boolean {
  if (condition === undefined) return true;
  const match = FORBIDDEN_CONDITION_PATTERN.exec(condition.trim());
  if (!match) return false; // 解釈できない条件はローダーで弾く前提。ここでは一致扱いにしない
  const field = match[1] as string;
  const operator = match[2] as string;
  const expectedText = match[3] as string;
  const expected = expectedText === "maxUint256" ? MAX_UINT256 : BigInt(expectedText);
  const candidates = [args[field], args[`${field}Raw`], args["amountRaw"], args["amountInRaw"]];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    try {
      const amount = BigInt(candidate);
      if (operator === ">" ? amount > expected : amount === expected) return true;
    } catch {
      // 数値でない引数は一致しない
    }
  }
  return false;
}

/** 指定の操作（関数名＋raw引数）が forbiddenActions のいずれかに該当すれば、その定義を返す */
export function matchForbiddenAction(
  def: ChallengeDefinition,
  functionName: string,
  args: Record<string, string>,
): ForbiddenAction | undefined {
  return def.forbiddenActions.find(
    (action) => action.match.functionName === functionName && forbiddenConditionMatches(action.match.condition, args),
  );
}

// --- 履歴の統合タイムライン ---

type TimelineEntry =
  | { origin: "write"; record: TxRecord }
  | { origin: "read"; record: CallRecord }
  | { origin: "sign"; record: SignatureRecord };

function currentAttemptTimeline(state: SimulationState, signatures: SignatureRecord[] = []): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const record of state.txLog) {
    if (record.attemptId === state.attemptId) entries.push({ origin: "write", record });
  }
  for (const record of state.callLog) {
    if (record.attemptId === state.attemptId) entries.push({ origin: "read", record });
  }
  for (const record of signatures) {
    if (record.attemptId === state.attemptId) entries.push({ origin: "sign", record });
  }
  entries.sort((a, b) => a.record.sequence - b.record.sequence);
  return entries;
}

function functionKind(def: ChallengeDefinition, functionName: string): "read" | "write" | undefined {
  return def.functions.find((fn) => fn.name === functionName)?.kind;
}

function argsMatch(
  def: ChallengeDefinition,
  expected: Record<string, string> | undefined,
  actual: Record<string, string>,
): boolean {
  if (!expected) return true;
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== resolveSymbol(def, value)) return false;
  }
  return true;
}

function entryAmountRaw(entry: TimelineEntry): string | undefined {
  return entry.record.args["amountRaw"] ?? entry.record.args["amountInRaw"];
}

// --- 条件評価 ---

interface EvalContext {
  def: ChallengeDefinition;
  state: SimulationState;
  timeline: TimelineEntry[];
  quizAnswers: Record<string, string>;
  warnings: string[];
}

function evaluateSequence(ctx: EvalContext, sequence: SequenceStep[]): boolean {
  let stepIndex = 0;
  for (const entry of ctx.timeline) {
    if (stepIndex >= sequence.length) break;
    const step = sequence[stepIndex] as SequenceStep;
    if (stepMatches(ctx, step, entry)) stepIndex += 1;
  }
  return stepIndex >= sequence.length;
}

/** actionSequence のマッチ済みステップ数（手順チェックリストの進捗表示に使う） */
export function sequenceMatchedCount(
  def: ChallengeDefinition,
  state: SimulationState,
  sequence: SequenceStep[],
): number {
  const ctx: EvalContext = { def, state, timeline: currentAttemptTimeline(state), quizAnswers: {}, warnings: [] };
  let stepIndex = 0;
  for (const entry of ctx.timeline) {
    if (stepIndex >= sequence.length) break;
    const step = sequence[stepIndex] as SequenceStep;
    if (stepMatches(ctx, step, entry)) stepIndex += 1;
  }
  return stepIndex;
}

function stepMatches(ctx: EvalContext, step: SequenceStep, entry: TimelineEntry): boolean {
  const record = entry.record;
  if (record.functionName !== step.functionName) return false;
  const kind = step.kind ?? functionKind(ctx.def, step.functionName) ?? entry.origin;
  if (kind !== entry.origin) return false;
  const requiredStatus = step.status ?? 1;
  if (entry.origin === "write") {
    if ((entry.record as TxRecord).status !== requiredStatus) return false;
  } else if (requiredStatus !== 1) {
    return false; // Readは成功したものだけがcallLogに残る
  }
  if (step.contract !== undefined && record.contract !== step.contract) return false;
  if (!argsMatch(ctx.def, step.args, record.args)) return false;
  if (step.returnRaw !== undefined) {
    if (entry.origin !== "read") return false;
    if ((entry.record as CallRecord).returnValueRaw !== step.returnRaw) return false;
  }
  return true;
}

function countSucceeded(ctx: EvalContext, condition: Extract<PassCondition, { type: "actionSucceeded" }>): number {
  const kind = functionKind(ctx.def, condition.functionName);
  let count = 0;
  for (const entry of ctx.timeline) {
    const record = entry.record;
    if (record.functionName !== condition.functionName) continue;
    if (kind !== undefined && entry.origin !== kind) continue;
    if (entry.origin === "write" && (entry.record as TxRecord).status !== 1) continue;
    if (condition.contract !== undefined && record.contract !== condition.contract) continue;
    if (condition.spender !== undefined && record.args["spender"] !== resolveSymbol(ctx.def, condition.spender)) {
      continue;
    }
    if (condition.amountRaw !== undefined && entryAmountRaw(entry) !== condition.amountRaw) continue;
    count += 1;
  }
  return count;
}

/** expectedDisplay と expectedRaw の換算一致を検証する（設計書 3.6）。不一致は fail-closed の警告 */
function displayConsistent(
  ctx: EvalContext,
  tokenAddress: string,
  expectedDisplay: string,
  expectedRaw: string,
  label: string,
): boolean {
  const token = ctx.def.contracts.find((c) => c.address === tokenAddress);
  if (!token) return true; // 参照先がない場合はraw比較のみで判定する
  let raw: bigint;
  try {
    raw = BigInt(expectedRaw);
  } catch {
    ctx.warnings.push(`${label}: expectedRaw が数値ではありません`);
    return false;
  }
  const converted = formatUnits(raw, token.decimals);
  if (normalizeNumericAnswer(converted) !== normalizeNumericAnswer(expectedDisplay)) {
    ctx.warnings.push(`${label}: expectedDisplay と expectedRaw の換算が一致しません`);
    return false;
  }
  return true;
}

type LeafCondition = Exclude<PassCondition, { op: "and" } | { op: "or" } | { op: "not" }>;

function evaluateLeaf(ctx: EvalContext, condition: LeafCondition): boolean {
  const { def, state } = ctx;
  switch (condition.type) {
    case "readSucceeded": {
      const count = state.callLog.filter(
        (r) => r.attemptId === state.attemptId && r.functionName === condition.functionName,
      ).length;
      return count >= (condition.minCount ?? 1);
    }
    case "readResultEquals": {
      const matches = state.callLog.filter((r) => {
        if (r.attemptId !== state.attemptId || r.functionName !== condition.functionName) return false;
        if (condition.contract !== undefined && r.contract !== condition.contract) return false;
        return argsMatch(def, condition.args, r.args);
      });
      const latest = matches[matches.length - 1];
      if (!latest) return false;
      if (condition.contract !== undefined) {
        if (!displayConsistent(ctx, condition.contract, condition.expectedDisplay, condition.expectedRaw, "readResultEquals")) {
          return false;
        }
      }
      try {
        return BigInt(latest.returnValueRaw) === BigInt(condition.expectedRaw);
      } catch {
        return false;
      }
    }
    case "actionSucceeded": {
      const count = countSucceeded(ctx, condition);
      if (condition.exactCount !== undefined) return count === condition.exactCount;
      return count >= (condition.minCount ?? 1);
    }
    case "actionFailed": {
      const count = state.txLog.filter((r) => {
        if (r.attemptId !== state.attemptId || r.status !== 0 || r.functionName !== condition.functionName) {
          return false;
        }
        return condition.revertCode === undefined || r.revertReason === condition.revertCode;
      }).length;
      return count >= (condition.minCount ?? 1);
    }
    case "actionSequence":
      return evaluateSequence(ctx, condition.sequence);
    case "balanceEquals": {
      const account = resolveSymbol(def, condition.account);
      const balance = state.tokens[condition.token]?.balances[account] ?? 0n;
      if (!displayConsistent(ctx, condition.token, condition.expectedDisplay, condition.expectedRaw, "balanceEquals")) {
        return false;
      }
      try {
        return balance === BigInt(condition.expectedRaw);
      } catch {
        return false;
      }
    }
    case "allowanceEquals": {
      const owner = resolveSymbol(def, condition.owner);
      const spender = resolveSymbol(def, condition.spender);
      const value = state.allowances[allowanceKey(owner, spender, condition.token)] ?? 0n;
      if (!displayConsistent(ctx, condition.token, condition.expectedDisplay, condition.expectedRaw, "allowanceEquals")) {
        return false;
      }
      try {
        return value === BigInt(condition.expectedRaw);
      } catch {
        return false;
      }
    }
    case "errorIdentified":
      return ctx.quizAnswers[condition.questionId] === condition.correctOptionId;
    case "quizCorrect": {
      const question = def.questions?.find((q) => q.questionId === condition.questionId);
      if (!question) {
        ctx.warnings.push(`quizCorrect: 質問 ${condition.questionId} が課題に定義されていません`);
        return false;
      }
      const answer = ctx.quizAnswers[condition.questionId];
      if (answer === undefined) return false;
      if (question.kind === "choice") {
        const expected = condition.correctOptionId ?? question.correctOptionId;
        return expected !== undefined && answer === expected;
      }
      const expected = condition.correctValue ?? question.correctValue;
      if (expected === undefined) return false;
      return normalizeNumericAnswer(answer, question.unit) === normalizeNumericAnswer(expected, question.unit);
    }
    case "forbiddenAction": {
      const target = def.forbiddenActions.find((a) => a.id === condition.forbiddenId);
      if (!target) {
        ctx.warnings.push(`forbiddenAction: ${condition.forbiddenId} が課題に定義されていません`);
        return false;
      }
      return !historyHasForbidden(ctx, target);
    }
    default:
      ctx.warnings.push(`未知の判定条件です: ${JSON.stringify(condition)}`);
      return false;
  }
}

function historyHasForbidden(ctx: EvalContext, target: ForbiddenAction): boolean {
  for (const record of ctx.state.txLog) {
    if (record.attemptId !== ctx.state.attemptId) continue;
    if (record.functionName !== target.match.functionName) continue;
    if (forbiddenConditionMatches(target.match.condition, record.args)) return true;
  }
  return false;
}

const KNOWN_LEAF_KEYS: Record<string, string[]> = {
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

function unmetMessage(condition: LeafCondition): string {
  switch (condition.type) {
    case "readSucceeded":
    case "readResultEquals":
      return `「${condition.functionName}」の Read を確かめてみよう`;
    case "actionSucceeded":
      return condition.exactCount !== undefined
        ? `「${condition.functionName}」の成功回数が条件と違うようだよ`
        : `「${condition.functionName}」を成功させてみよう`;
    case "actionFailed":
      return `「${condition.functionName}」の revert を経験してみよう`;
    case "actionSequence":
      return "操作の順番があと少しのようだよ。手順を確かめてみよう";
    case "balanceEquals":
      return "最終の残高が条件と合っていないようだよ";
    case "allowanceEquals":
      return "最終の allowance が条件と合っていないようだよ";
    case "errorIdentified":
    case "quizCorrect":
      return "確認クイズの答えをもう一度確かめてみよう";
    case "forbiddenAction":
      return "この試行では、しないはずの操作が含まれているよ";
    default:
      return "条件を確かめてみよう";
  }
}

function evaluateNode(ctx: EvalContext, node: PassCondition, unmet: string[]): boolean {
  if (typeof node !== "object" || node === null) {
    ctx.warnings.push("判定条件の形式が不正です");
    return false;
  }
  if ("op" in node) {
    if (node.op === "and" || node.op === "or") {
      const extra = Object.keys(node).filter((k) => k !== "op" && k !== "conditions");
      if (extra.length > 0) ctx.warnings.push(`未知のキーがあります: ${extra.join(", ")}`);
      const results = node.conditions.map((child) => evaluateNode(ctx, child, unmet));
      return node.op === "and" ? results.every(Boolean) : results.some(Boolean);
    }
    if (node.op === "not") {
      const extra = Object.keys(node).filter((k) => k !== "op" && k !== "condition");
      if (extra.length > 0) ctx.warnings.push(`未知のキーがあります: ${extra.join(", ")}`);
      const innerUnmet: string[] = [];
      return !evaluateNode(ctx, node.condition, innerUnmet);
    }
    ctx.warnings.push(`未知の op です: ${String((node as { op: unknown }).op)}`);
    return false;
  }
  const leaf = node as LeafCondition;
  const allowedKeys = KNOWN_LEAF_KEYS[leaf.type];
  if (!allowedKeys) {
    ctx.warnings.push(`未知の type です: ${String((leaf as { type: unknown }).type)}`);
    return false;
  }
  const extra = Object.keys(leaf).filter((k) => !allowedKeys.includes(k));
  if (extra.length > 0) {
    ctx.warnings.push(`未知のキーがあります: ${extra.join(", ")}`);
    return false;
  }
  const ok = evaluateLeaf(ctx, leaf);
  if (!ok) unmet.push(unmetMessage(leaf));
  return ok;
}

/**
 * 課題の合格判定（設計書 4.1 / 4.2）。
 * ゲートを先に検査し、該当があれば他の条件にかかわらず不合格を返す。
 */
export function evaluateChallenge(
  def: ChallengeDefinition,
  state: SimulationState,
  quizAnswers: Record<string, string>,
  signatures: SignatureRecord[] = [],
): EvalResult {
  const ctx: EvalContext = {
    def,
    state,
    timeline: currentAttemptTimeline(state, signatures),
    quizAnswers,
    warnings: [],
  };

  // forbiddenAction ゲート（4.2）：評価前に検査し、該当があれば全体を false に固定する
  const gateIds: string[] = [];
  for (const target of def.forbiddenActions) {
    if (historyHasForbidden(ctx, target)) gateIds.push(target.id);
  }
  if (gateIds.length > 0) {
    return {
      passed: false,
      unmet: ["この試行では、しないはずの操作が含まれているよ。リセットすれば、もう一度挑戦できるよ"],
      warnings: ctx.warnings,
      gate: { blocked: true, forbiddenIds: gateIds },
    };
  }

  const unmet: string[] = [];
  const passed = evaluateNode(ctx, def.passCondition, unmet);
  return { passed, unmet, warnings: ctx.warnings, gate: { blocked: false, forbiddenIds: [] } };
}
