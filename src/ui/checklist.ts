import type { SignatureRecord } from "../engine/permits";
// 手順チェックは各手順自身の証跡を現在の試行から独立して調べる。
// 成功ログを先頭の未完了手順へ割り当てず、合格・禁止操作ゲートにも連動させない。
import type { ChallengeDefinition, ChecklistCondition, SequenceStep } from "../data/types";
import type { SimulationState, CallRecord, TxRecord } from "../engine/state";
import { resolveSymbol } from "../scoring/evaluator";

export function checklistConditionMet(
  def: ChallengeDefinition,
  state: SimulationState,
  condition: ChecklistCondition,
  isQuizCorrect: (questionId: string) => boolean,
  signatures: SignatureRecord[] = [],
): boolean {
  if ("op" in condition) {
    const results = condition.conditions.map(child => checklistConditionMet(def, state, child, isQuizCorrect, signatures));
    return condition.op === "and" ? results.every(Boolean) : results.some(Boolean);
  }
  if (condition.type === "quizCorrect") return isQuizCorrect(condition.questionId);
  const timeline = [...state.callLog, ...state.txLog, ...signatures]
    .filter(record => record.attemptId === state.attemptId)
    .sort((a, b) => a.sequence - b.sequence);
  let index = 0;
  for (const record of timeline) {
    const action = condition.sequence[index];
    if (action && matches(def, action, record)) index += 1;
  }
  return condition.sequence.length > 0 && index === condition.sequence.length;
}

function matches(
  def: ChallengeDefinition,
  action: SequenceStep & { revertCode?: string },
  record: CallRecord | TxRecord | SignatureRecord,
): boolean {
  if (record.functionName !== action.functionName) return false;
  const kind = action.kind ?? def.functions.find(fn => fn.name === action.functionName)?.kind;
  if (kind !== record.type) return false;
  if ((record.type === "write" ? record.status : 1) !== (action.status ?? 1)) return false;
  if (action.contract !== undefined && record.contract !== resolveSymbol(def, action.contract)) return false;
  if (action.revertCode !== undefined && (record.type !== "write" || record.revertReason !== action.revertCode)) return false;
  if (action.returnRaw !== undefined && (record.type !== "read" || record.returnValueRaw !== action.returnRaw)) return false;
  return Object.entries(action.args ?? {}).every(([key, value]) => record.args[key] === resolveSymbol(def, value));
}
