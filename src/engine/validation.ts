// 入力バリデーションとrevert理由の定義（設計書 2.5）
//
// 画面側エラー（入力バリデーション）：トランザクションにならない。
//   txLog・callLogに記録せず、nonce・ブロック・ガスは動かない。
// オンチェーンrevert：ブロックに包含される。txLogにstatus=0で記録し、
//   ガス・nonce・ブロックが動く。
// この2つを混同しないことが本モジュールの役割。
import type { Address } from "./state";
import { parseUnits, UnitsError } from "./units";

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** アドレス形式チェック（0xから始まる42文字。チェックサム検証は簡易版とする） */
export function isValidAddress(address: string): boolean {
  return typeof address === "string" && ADDRESS_PATTERN.test(address);
}

export type ValidationErrorCode =
  | "EMPTY_INPUT"
  | "NOT_A_NUMBER"
  | "NEGATIVE_NOT_ALLOWED"
  | "TOO_MANY_DECIMALS"
  | "INVALID_ADDRESS";

export interface ValidationFailure {
  ok: false;
  code: ValidationErrorCode;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | ValidationFailure;

function failure(code: ValidationErrorCode, message: string): ValidationFailure {
  return { ok: false, code, message };
}

/** アドレス入力の検証（画面側エラー用） */
export function validateAddressInput(address: string): ValidationResult<Address> {
  if (typeof address !== "string" || address.trim() === "") {
    return failure("EMPTY_INPUT", "アドレスが入力されていません。練習用アドレスから選んでみよう。");
  }
  if (!isValidAddress(address.trim())) {
    return failure(
      "INVALID_ADDRESS",
      "アドレスは0xから始まる42文字だよ。練習用アドレスから選んでみよう。",
    );
  }
  return { ok: true, value: address.trim() };
}

/**
 * 数量入力（表示値文字列）の検証（画面側エラー用）。
 * 成功時は raw値（BigInt）を返す。transferの0数量はここでは正常（成功）として扱い、
 * revertにも画面側エラーにもしない（設計書 2.5）。
 */
export function validateAmountInput(input: string, decimals: number): ValidationResult<bigint> {
  try {
    return { ok: true, value: parseUnits(input, decimals) };
  } catch (error) {
    if (error instanceof UnitsError) {
      switch (error.code) {
        case "EMPTY_INPUT":
          return failure("EMPTY_INPUT", "数量が入力されていません");
        case "NEGATIVE_NOT_ALLOWED":
          return failure("NEGATIVE_NOT_ALLOWED", "負の数量は入力できません");
        case "TOO_MANY_DECIMALS":
          return failure(
            "TOO_MANY_DECIMALS",
            `小数点以下の桁数が多すぎます。このトークンは${decimals}桁までだよ。`,
          );
        default:
          return failure("NOT_A_NUMBER", "数量は数字で入力してみよう");
      }
    }
    throw error;
  }
}

// --- オンチェーンrevertの理由コードと日本語メッセージ ---

export type RevertCode =
  | "ZERO_ADDRESS_SPENDER"
  | "ZERO_ADDRESS_RECIPIENT"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_ALLOWANCE"
  | "INSUFFICIENT_OUTPUT_AMOUNT";

export const REVERT_MESSAGES: Record<RevertCode, string> = {
  INSUFFICIENT_OUTPUT_AMOUNT: "受け取り量がamountOutMinを下回るため止まったよ。見積もりと最低受取量を確かめよう。",
  ZERO_ADDRESS_SPENDER: "承認先にゼロアドレスは使えないよ。疑似DEXのアドレスを確かめてみよう。",
  ZERO_ADDRESS_RECIPIENT: "送り先にゼロアドレスは使えないよ。宛先を確かめてみよう。",
  INSUFFICIENT_BALANCE: "残高が足りないよ。数量を確かめてみよう。",
  INSUFFICIENT_ALLOWANCE: "DEXへの承認量が足りないよ。approveで許可を増やしてみよう。",
};

export function revertMessage(code: RevertCode): string {
  return REVERT_MESSAGES[code];
}

/** ガス不足（送信前・未包含の失敗）時の文言。責めない表現にする（設計書 2.5）。 */
export const INSUFFICIENT_GAS_MESSAGE =
  "疑似ETHがガス代に足りないよ。課題をリセットすると疑似ETHが初期状態に戻るよ。";
