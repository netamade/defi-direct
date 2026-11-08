// 課題JSON・バッジJSONの型定義（設計書 3.2）
//
// フェーズ3で固定する種類（フェーズ5では変更しない。設計書 5.3 フェーズ3）:
// - クイズの種類：choice / numeric（正規化ルールは scoring/evaluator.ts）
// - ヒントの種類：段階式テキストリスト（hints: string[]）
// - バッジの種類：課題クリアバッジ＋行動バッジ（data/badges.json に集約）
// - 判定条件の種類：下記 PassCondition の一覧
import type { Address, ContractInfo, InitialStateInput } from "../engine/state";

export type { Address, ContractInfo, InitialStateInput };

export interface ChapterRef {
  bookChapter: number;
  bookTitle: string;
  section: string;
}

export interface FunctionInput {
  name: string;
  type: string;
  description: string;
}

export interface FunctionDefinition {
  name: string;
  kind: "read" | "write";
  description: string;
  inputs: FunctionInput[];
  payable?: boolean; // ETH valueを送るWrite（状態スキーマには影響しない）
  revertReasons?: { code: string; message: string }[];
}

export interface QuestionDefinition {
  questionId: string;
  kind: "choice" | "numeric"; // フェーズ3で固定する種類
  prompt: string;
  options?: { optionId: string; label: string }[];
  correctOptionId?: string; // kind=choice の場合
  correctValue?: string; // kind=numeric の場合の正解表示値（正規化して比較する）
  unit?: string; // 許容する単位（例: "USDC"）。単位の有無は正誤に影響しない
}

export interface SequenceStep {
  functionName: string;
  kind?: "read" | "write"; // 省略時は関数定義のkindで判定する
  contract?: string; // トークン（コントラクト）アドレス。指定時は一致必須
  args?: Record<string, string>; // spender・token・amountRaw等。指定したキーのみ一致必須
  returnRaw?: string; // Readステップの場合の返却値raw。指定時はcallLogの返却値と一致必須
  status?: 0 | 1; // 既定は1（成功のみ）
}

export type PassCondition =
  | { op: "and"; conditions: PassCondition[] }
  | { op: "or"; conditions: PassCondition[] }
  | { op: "not"; condition: PassCondition }
  | {
      type: "actionSucceeded";
      functionName: string;
      minCount?: number;
      exactCount?: number;
      amountRaw?: string;
      spender?: string;
      contract?: string;
    }
  | { type: "actionFailed"; functionName: string; revertCode?: string; minCount?: number }
  | { type: "actionSequence"; sequence: SequenceStep[] }
  | {
      type: "balanceEquals";
      token: string;
      account: "user" | string;
      expectedDisplay: string;
      expectedRaw: string;
    }
  | {
      type: "allowanceEquals";
      token: string;
      owner: "user" | string;
      spender: string;
      expectedDisplay: string;
      expectedRaw: string;
    }
  | { type: "readSucceeded"; functionName: string; minCount?: number }
  | {
      type: "readResultEquals";
      functionName: string;
      contract?: string;
      args?: Record<string, string>;
      expectedDisplay: string;
      expectedRaw: string;
    }
  | { type: "errorIdentified"; questionId: string; correctOptionId: string }
  | { type: "quizCorrect"; questionId: string; correctOptionId?: string; correctValue?: string }
  | { type: "forbiddenAction"; forbiddenId: string };

/** 手順表示専用の操作証跡。合否判定・保存状態のスキーマとは独立。 */
export type ChecklistCondition =
  | { type: "actionSequence"; sequence: (SequenceStep & { revertCode?: string })[] }
  | { type: "quizCorrect"; questionId: string }
  | { op: "and" | "or"; conditions: ChecklistCondition[] };

export interface StepCheck {
  condition: ChecklistCondition;
  optional?: boolean;
}

export interface ForbiddenAction {
  id: string;
  description: string;
  mode: "block" | "warn"; // block=送信不可、warn=警告の上で送信可（採点は第4.2節のゲート）
  match: { functionName: string; condition?: string }; // 例: approveで無制限量（amount == maxUint256）
}

/** swap の明示フィールド（フェーズ3で追加。contracts の並び順による推論を廃止） */
export interface SwapDefinition {
  tokenIn: Address; // 支払うトークンのコントラクトアドレス
  tokenOut: Address; // 受け取るトークンのコントラクトアドレス
  spenderKey: string; // initialState.spenderAddresses のキー（例: "dex"）
}

export interface ChallengeDefinition {
  schemaVersion: 1;
  id: string; // "01" / "02" / "03"。ファイル名と一致させる
  title: string;
  subtitle: string;
  chapter: ChapterRef;
  difficulty: 1 | 2 | 3;
  estimatedMinutes: number;
  xp: number; // クリア時獲得XP
  badges: string[]; // クリア時付与バッジID
  goal: string; // 学習ゴール1文
  scenario: string;
  steps: string[]; // 手順チェックリストの文言（表示用）
  stepChecks: StepCheck[]; // stepsと同じ順・件数の操作証跡（文言から推測しない）
  hints: string[]; // 段階式ヒント。答えそのものは漏らさない
  successMessage: string;
  retryMessage: string;
  contracts: ContractInfo[];
  initialState: InitialStateInput;
  functions: FunctionDefinition[];
  gas: Record<string, { gasUsed: number; gasPriceGwei: number }>; // すべて疑似値
  swapQuoteRate?: number; // 参考見積もりレート。省略時はswapRate
  swapRate?: number; // 表示値ベースのレート。03では1
  airdrop?: { distributor: Address; token: Address; root: string; distribution?: { label: string; address: Address; amount: string }[]; publicProofs?: { label: string; proof: string[] }[] };
  vault?: { asset: Address; shareToken: Address };
  swap?: SwapDefinition; // swap を使う課題では必須（ローダーで検証する）
  questions?: QuestionDefinition[];
  passCondition: PassCondition;
  forbiddenActions: ForbiddenAction[];
}

export interface ChallengeIndexEntry {
  id: string;
  order: number;
  file: string;
  title: string;
  bookChapter: number;
  xp: number;
}

export interface ChallengeIndex {
  schemaVersion: 1;
  challenges: ChallengeIndexEntry[];
}

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  condition: string; // 獲得条件文（未獲得時の表示用）
}

export interface BadgesFile {
  schemaVersion: 1;
  badges: BadgeDefinition[];
}
