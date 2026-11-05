// バッジ付与の判定（設計書 4.6 / data/badges.json の獲得条件）
//
// - 課題クリアバッジ：課題JSONの badges をクリア時に付与する。
// - リトライの達人（retry-master）：RETRY状態になった課題を、その後の挑戦でクリアした場合に付与する。
// - リバート読み解き（revert-reader）：課題03の発展条件。allowance不足による swap の revert を
//   経験し、その理由（INSUFFICIENT_ALLOWANCE）を理由クイズで正しく選んだ場合に付与する。
import type { SimulationState } from "../engine/state";
import type { ChallengeDefinition } from "../data/types";

export const RETRY_MASTER_BADGE_ID = "retry-master";
export const REVERT_READER_BADGE_ID = "revert-reader";
export const REVERT_READER_CODE = "INSUFFICIENT_ALLOWANCE";

/** 理由クイズの回答を進捗ストアへ記録するときのキー（quizAnswers 内の合成キー） */
export function revertQuizKey(functionName: string): string {
  return `revert:${functionName}`;
}

/** RETRYを経てクリアしたかどうか */
export function shouldAwardRetryMaster(previousStatus: string | undefined): boolean {
  return previousStatus === "RETRY";
}

/**
 * revert-reader の獲得条件を満たすか。
 * 現在の試行に「理由コードが INSUFFICIENT_ALLOWANCE の revert」があり、
 * その関数の理由クイズに同じコードで正しく回答していること。
 */
export function revertReaderSatisfied(
  state: SimulationState,
  quizAnswers: Record<string, string>,
): boolean {
  for (const record of state.txLog) {
    if (record.attemptId !== state.attemptId) continue;
    if (record.status !== 0 || record.revertReason !== REVERT_READER_CODE) continue;
    if (quizAnswers[revertQuizKey(record.functionName)] === REVERT_READER_CODE) return true;
  }
  return false;
}

/** クリア時に付与するバッジIDの一覧（重複は呼び出し側で除く） */
export function badgesOnClear(def: ChallengeDefinition, previousStatus: string | undefined): string[] {
  const ids = [...def.badges];
  if (shouldAwardRetryMaster(previousStatus)) ids.push(RETRY_MASTER_BADGE_ID);
  return ids;
}
