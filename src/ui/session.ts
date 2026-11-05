// プレイ画面の進行ロジック（S-04 の中核）。
// 画面（ui/play.ts）はこのセッションを描画し、操作を委譲するだけにする。
// フローテスト（tests/flows.test.ts）も同じセッションを通すことで、
// 「画面操作だけで完結するフロー」を自動検証できるようにしている。
import {
  Engine,
  engineConfigFromChallenge,
  type ReadFunctionName,
  type ReadResult,
  type WriteFunctionName,
  type WriteResult,
} from "../engine/executor";
import type { Address, SimulationState } from "../engine/state";
import { formatUnits, MAX_UINT256, rateToRational, swapAmountOutRaw } from "../engine/units";
import type { LoadedData } from "../data/loader";
import type { ChallengeDefinition, ForbiddenAction } from "../data/types";
import {
  ProgressStore,
  type ChallengeStatus,
  type ProgressState,
} from "../store/progressStore";
import { SimulationStore } from "../store/simulationStore";
import {
  evaluateChallenge,
  matchForbiddenAction,
  normalizeNumericAnswer,
  type EvalResult,
} from "../scoring/evaluator";
import {
  badgesOnClear,
  revertQuizKey,
  revertReaderSatisfied,
  REVERT_READER_BADGE_ID,
} from "../scoring/badges";
import { levelForXp } from "../scoring/levels";

/** クリアイベント（QUEST CLEAR演出の材料）。false→true へ転じた瞬間にだけ発生する */
export interface ClearEvent {
  /** 今回新たに付与されたXP（再クリア時は0） */
  awardedXp: number;
  /** 今回新たに獲得したバッジID */
  newBadgeIds: string[];
  /** 初回クリアかどうか */
  firstClear: boolean;
  /** レベルアップしたかどうか */
  leveledUp: boolean;
  newLevel: number;
}

export interface ActionOutcome {
  evaluation: EvalResult;
  clear: ClearEvent | null;
}

export type WriteRequest =
  | { kind: "blocked"; action: ForbiddenAction }
  | { kind: "warn"; action: ForbiddenAction; preview: WritePreview }
  | { kind: "confirm"; preview: WritePreview };

export interface WritePreview {
  functionName: string;
  gasUsed: number;
  gasPriceGwei: number;
  gasFeeEth: string;
  /** 状態変化の予測（表示値とraw値の併記。設計書 2.6） */
  diffs: { label: string; before: string; after: string }[];
}

export interface ChecklistItem {
  text: string;
  done: boolean;
  optional: boolean;
}

export class PlaySession {
  readonly def: ChallengeDefinition;
  readonly engine: Engine;
  private readonly progressStore: ProgressStore;
  private readonly simStore: SimulationStore;
  private readonly badgeIds: Set<string>;
  progress: ProgressState;
  evaluation: EvalResult;
  /** 直近の評価が合格だったか（クリア演出の発火判定に使う） */
  private wasPassed: boolean;

  constructor(data: LoadedData, def: ChallengeDefinition, progressStore: ProgressStore, simStore: SimulationStore) {
    this.def = def;
    this.progressStore = progressStore;
    this.simStore = simStore;
    this.badgeIds = new Set(data.badges.map((b) => b.id));
    this.engine = new Engine(engineConfigFromChallenge(def));
    const restored = simStore.load(def.id);
    if (restored) this.engine.state = restored;
    this.progress = progressStore.load().state;
    this.evaluation = evaluateChallenge(def, this.engine.state, this.quizAnswers());
    this.wasPassed = this.evaluation.passed;
  }

  get state(): SimulationState {
    return this.engine.state;
  }

  get userAddress(): Address {
    return this.def.initialState.userAddress;
  }

  quizAnswers(): Record<string, string> {
    return this.progress.quizAnswers[this.def.id] ?? {};
  }

  status(): ChallengeStatus {
    return this.progress.challengeStatus[this.def.id] ?? "未着手";
  }

  alreadyCleared(): boolean {
    return this.progress.clearedChallengeIds.includes(this.def.id);
  }

  // --- Read（S-05） ---

  doRead(functionName: ReadFunctionName, contract: Address, args: Record<string, string> = {}): { result: ReadResult } & ActionOutcome {
    const result = this.engine.read(functionName, contract, args);
    if (result.ok) {
      this.touchInProgress();
      this.simStore.save(this.engine.state);
    }
    return { result, ...this.afterAction() };
  }

  // --- Write（S-06）：送信前確認とガード ---

  /** 送信前の確認材料を作る。forbiddenAction の該当もここで判定する */
  requestWrite(functionName: WriteFunctionName, contract: Address, args: Record<string, string>): WriteRequest {
    const forbidden = matchForbiddenAction(this.def, functionName, args);
    const preview = this.previewWrite(functionName, contract, args);
    if (forbidden?.mode === "block") return { kind: "blocked", action: forbidden };
    if (forbidden?.mode === "warn") return { kind: "warn", action: forbidden, preview };
    return { kind: "confirm", preview };
  }

  /** 確認（または警告）を通した書き込みを実行する */
  executeWrite(
    functionName: WriteFunctionName,
    contract: Address,
    args: Record<string, string>,
  ): { result: WriteResult } & ActionOutcome {
    const result = this.engine.write(functionName, contract, args);
    if (result.kind !== "preflight-failure") {
      this.touchInProgress();
      this.simStore.save(this.engine.state);
    }
    return { result, ...this.afterAction() };
  }

  /** 状態変化の予測（確認モーダル用）。状態は変えない */
  previewWrite(functionName: string, contract: Address, args: Record<string, string>): WritePreview {
    const gas = this.def.gas[functionName] ?? { gasUsed: 45_000, gasPriceGwei: 20 };
    const gasFeeWei = BigInt(gas.gasUsed) * BigInt(gas.gasPriceGwei) * 1_000_000_000n;
    const state = this.engine.state;
    const user = this.userAddress;
    const diffs: WritePreview["diffs"] = [];
    const tokenOf = (address: Address) => state.tokens[address];
    const describe = (tokenAddress: Address, raw: bigint): string => {
      const token = tokenOf(tokenAddress);
      if (!token) return raw.toString();
      return `${formatUnits(raw, token.decimals)} ${token.symbol}（raw ${raw.toString()}、decimals ${token.decimals}）`;
    };

    if (functionName === "approve") {
      const spender = args["spender"] ?? "";
      const amount = BigInt(args["amountRaw"] ?? "0");
      const before = this.engine.getAllowance(contract, user, spender);
      diffs.push({
        label: "allowance（承認量）",
        before: describe(contract, before),
        after: describe(contract, amount),
      });
    } else if (functionName === "transfer") {
      const to = args["to"] ?? "";
      const amount = BigInt(args["amountRaw"] ?? "0");
      const senderBefore = this.engine.getBalance(contract, user);
      const recipientBefore = this.engine.getBalance(contract, to);
      diffs.push({
        label: "あなたの残高",
        before: describe(contract, senderBefore),
        after: describe(contract, senderBefore - amount),
      });
      diffs.push({
        label: "送り先の残高",
        before: describe(contract, recipientBefore),
        after: describe(contract, recipientBefore + amount),
      });
    } else if (this.engine.config.swap && functionName !== "approve" && functionName !== "transfer") {
      const swap = this.engine.config.swap;
      const amountIn = BigInt(args["amountInRaw"] ?? "0");
      const tokenIn = tokenOf(swap.tokenIn);
      const tokenOut = tokenOf(swap.tokenOut);
      if (tokenIn && tokenOut) {
        const amountOut = swapAmountOutRaw(
          amountIn,
          tokenIn.decimals,
          tokenOut.decimals,
          rateToRational(this.engine.config.swapRate ?? 1),
        );
        const inBefore = this.engine.getBalance(swap.tokenIn, user);
        const outBefore = this.engine.getBalance(swap.tokenOut, user);
        const allowanceBefore = this.engine.getAllowance(swap.tokenIn, user, swap.dexAddress);
        diffs.push({
          label: `${tokenIn.symbol} 残高`,
          before: describe(swap.tokenIn, inBefore),
          after: describe(swap.tokenIn, inBefore - amountIn),
        });
        diffs.push({
          label: `${tokenOut.symbol} 残高`,
          before: describe(swap.tokenOut, outBefore),
          after: describe(swap.tokenOut, outBefore + amountOut),
        });
        if (allowanceBefore !== MAX_UINT256) {
          diffs.push({
            label: "allowance（DEXへの承認量）",
            before: describe(swap.tokenIn, allowanceBefore),
            after: describe(swap.tokenIn, allowanceBefore - amountIn),
          });
        }
      }
    }

    return {
      functionName,
      gasUsed: gas.gasUsed,
      gasPriceGwei: gas.gasPriceGwei,
      gasFeeEth: formatUnits(gasFeeWei, 18),
      diffs,
    };
  }

  // --- クイズ ---

  answerQuiz(questionId: string, answer: string): ActionOutcome {
    this.progress = this.progressStore.recordQuizAnswer(this.progress, this.def.id, questionId, answer);
    this.progressStore.save(this.progress);
    this.touchInProgress();
    return this.afterAction();
  }

  /** クイズの正誤（画面のフィードバック用） */
  isQuizCorrect(questionId: string): boolean {
    const question = this.def.questions?.find((q) => q.questionId === questionId);
    const answer = this.quizAnswers()[questionId];
    if (!question || answer === undefined) return false;
    if (question.kind === "choice") return answer === question.correctOptionId;
    if (question.correctValue === undefined) return false;
    return normalizeNumericAnswer(answer, question.unit) === normalizeNumericAnswer(question.correctValue, question.unit);
  }

  /**
   * revert理由クイズへの回答。理由を正しく選べたら記録し、
   * revert-reader の条件を満たせばバッジを付与する。
   */
  answerRevertQuiz(functionName: string, code: string): { correct: boolean; awardedBadge: string | null } {
    const record = [...this.engine.state.txLog]
      .reverse()
      .find(
        (r) =>
          r.attemptId === this.engine.state.attemptId &&
          r.status === 0 &&
          r.functionName === functionName &&
          r.revertReason === code,
      );
    const correct = record !== undefined;
    if (!correct) return { correct: false, awardedBadge: null };
    this.progress = this.progressStore.recordQuizAnswer(this.progress, this.def.id, revertQuizKey(functionName), code);
    let awardedBadge: string | null = null;
    if (
      this.badgeIds.has(REVERT_READER_BADGE_ID) &&
      !this.progress.badges.includes(REVERT_READER_BADGE_ID) &&
      revertReaderSatisfied(this.engine.state, this.quizAnswers())
    ) {
      this.progress = { ...this.progress, badges: [...this.progress.badges, REVERT_READER_BADGE_ID] };
      awardedBadge = REVERT_READER_BADGE_ID;
    }
    this.progressStore.save(this.progress);
    return { correct: true, awardedBadge };
  }

  // --- 区切り・リセット ---

  /** RETRYとして区切る（クリア済みの課題はステータスを下げない） */
  markRetry(): void {
    if (this.alreadyCleared()) return;
    this.progress = {
      ...this.progress,
      challengeStatus: { ...this.progress.challengeStatus, [this.def.id]: "RETRY" },
      lastPlayedAt: new Date().toISOString(),
    };
    this.progressStore.save(this.progress);
  }

  /** 課題リセット：シミュレーション状態・ログ・クイズ回答を初期化する（進捗・XP・バッジは消えない） */
  reset(): ActionOutcome {
    this.engine.reset();
    this.simStore.save(this.engine.state);
    this.progress = this.progressStore.clearQuizAnswers(this.progress, this.def.id);
    this.progressStore.save(this.progress);
    return this.afterAction();
  }

  // --- 手順チェックリスト（設計書 3.2：達成判定はpassConditionとは別にtxLog・callLogから導く） ---

  checklist(): ChecklistItem[] {
    const state = this.engine.state;
    type Op = { kind: "read" | "write"; functionName: string };
    // 成功した操作だけを sequence 順の時系列にする（ReadはcallLog、Writeはstatus=1のtxLog）
    const timeline: Op[] = [
      ...state.callLog
        .filter((r) => r.attemptId === state.attemptId)
        .map((r) => ({ sequence: r.sequence, op: { kind: "read" as const, functionName: r.functionName } })),
      ...state.txLog
        .filter((r) => r.attemptId === state.attemptId && r.status === 1)
        .map((r) => ({ sequence: r.sequence, op: { kind: "write" as const, functionName: r.functionName } })),
    ]
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => s.op);
    const hasRevert = state.txLog.some((r) => r.attemptId === state.attemptId && r.status === 0);

    let pointer = 0;
    const consume = (kind: "read" | "write", functionName: string): boolean => {
      for (let i = pointer; i < timeline.length; i++) {
        const op = timeline[i] as Op;
        if (op.kind === kind && op.functionName === functionName) {
          pointer = i + 1;
          return true;
        }
      }
      return false;
    };

    return this.def.steps.map((text) => {
      const optional = text.includes("（発展）");
      if (optional) return { text, done: hasRevert, optional };
      if (text.includes("クイズ")) {
        const questions = this.def.questions ?? [];
        const done = questions.length > 0 && questions.every((q) => this.isQuizCorrect(q.questionId));
        return { text, done, optional };
      }
      const target = checklistTarget(text);
      if (!target) return { text, done: this.evaluation.passed, optional };
      return { text, done: consume(target.kind, target.functionName), optional };
    });
  }

  // --- 内部 ---

  private touchInProgress(): void {
    if (this.alreadyCleared()) return;
    if (this.status() === "未着手") {
      this.progress = {
        ...this.progress,
        challengeStatus: { ...this.progress.challengeStatus, [this.def.id]: "IN PROGRESS" },
        lastPlayedAt: new Date().toISOString(),
      };
      this.progressStore.save(this.progress);
    }
  }

  /** 操作後の再評価と、クリア転じた場合のXP・バッジ付与 */
  private afterAction(): ActionOutcome {
    const previousStatus = this.status();
    const previousLevel = levelForXp(this.progress.totalXp).current.level;
    this.evaluation = evaluateChallenge(this.def, this.engine.state, this.quizAnswers());
    let clear: ClearEvent | null = null;
    if (this.evaluation.passed && !this.wasPassed) {
      const firstClear = !this.alreadyCleared();
      const badgeIds = badgesOnClear(this.def, previousStatus).filter((id) => this.badgeIds.has(id));
      const { state, awardedXp } = this.progressStore.markCleared(this.progress, this.def.id, this.def.xp, badgeIds);
      const newBadgeIds = state.badges.filter((b) => !this.progress.badges.includes(b));
      this.progress = state;
      this.progressStore.save(this.progress);
      const newLevel = levelForXp(this.progress.totalXp).current.level;
      clear = {
        awardedXp,
        newBadgeIds,
        firstClear,
        leveledUp: newLevel > previousLevel,
        newLevel,
      };
    }
    this.wasPassed = this.evaluation.passed;
    return { evaluation: this.evaluation, clear };
  }
}

/** 手順文から、対応する操作（種類＋関数名）を推定する */
function checklistTarget(text: string): { kind: "read" | "write"; functionName: string } | null {
  if (text.includes("swap") || text.includes("交換する")) {
    return { kind: "write", functionName: "swapExactUSDCForTKN" };
  }
  if (text.includes("approve")) return { kind: "write", functionName: "approve" };
  if (text.includes("transfer")) return { kind: "write", functionName: "transfer" };
  if (text.includes("allowance")) return { kind: "read", functionName: "allowance" };
  if (text.includes("balanceOf") || text.includes("残高")) return { kind: "read", functionName: "balanceOf" };
  if (text.includes("decimals")) return { kind: "read", functionName: "decimals" };
  return null;
}
