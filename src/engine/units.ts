// decimals換算ユーティリティ（設計書 2.6）
//
// raw値 ⇄ 表示値の変換は整数演算（BigInt）のみで行う。浮動小数点は使わない。
// 表示値の入力は文字列で受け取り、小数点以下の桁数がdecimalsを超えたらエラーにする。
// ethers等の外部ライブラリは入れず、自前実装とする（設計書 5.1）。

export const MAX_UINT256: bigint = (1n << 256n) - 1n;

export type UnitsErrorCode =
  | "EMPTY_INPUT"
  | "NOT_A_NUMBER"
  | "NEGATIVE_NOT_ALLOWED"
  | "TOO_MANY_DECIMALS"
  | "INVALID_DECIMALS";

export class UnitsError extends Error {
  readonly code: UnitsErrorCode;

  constructor(code: UnitsErrorCode, message: string) {
    super(message);
    this.name = "UnitsError";
    this.code = code;
  }
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 256) {
    throw new UnitsError("INVALID_DECIMALS", `decimalsが不正です: ${decimals}`);
  }
}

/**
 * 表示値（文字列）→ raw値（BigInt）。
 * 例: parseUnits("10", 6) === 10000000n
 * 負数・空欄・数値でない入力・decimals超過の小数桁は UnitsError を投げる（画面側エラーの材料）。
 */
export function parseUnits(value: string, decimals: number): bigint {
  assertDecimals(decimals);
  if (typeof value !== "string" || value.trim() === "") {
    throw new UnitsError("EMPTY_INPUT", "数量が入力されていません");
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("-")) {
    throw new UnitsError("NEGATIVE_NOT_ALLOWED", "負の数量は入力できません");
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new UnitsError("NOT_A_NUMBER", `数値として読めません: ${value}`);
  }
  const intPart = match[1] as string;
  const fracPart = match[2] ?? "";
  if (fracPart.length > decimals) {
    throw new UnitsError(
      "TOO_MANY_DECIMALS",
      `小数点以下は${decimals}桁までです（入力は${fracPart.length}桁）`,
    );
  }
  const scale = 10n ** BigInt(decimals);
  const fracPadded = fracPart.padEnd(decimals, "0");
  const fracValue = fracPadded === "" ? 0n : BigInt(fracPadded);
  return BigInt(intPart) * scale + fracValue;
}

/**
 * raw値（BigInt）→ 表示値（文字列）。末尾のゼロは取り除く。
 * 例: formatUnits(10000000n, 6) === "10"、formatUnits(500000n, 6) === "0.5"
 */
export function formatUnits(raw: bigint, decimals: number): string {
  assertDecimals(decimals);
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const intPart = abs / scale;
  const fracPart = abs % scale;
  let text = intPart.toString();
  if (fracPart !== 0n) {
    const fracText = fracPart.toString().padStart(decimals, "0").replace(/0+$/, "");
    text = `${text}.${fracText}`;
  }
  return negative ? `-${text}` : text;
}

/** ETH（decimals 18）用の短縮形 */
export function parseEther(value: string): bigint {
  return parseUnits(value, 18);
}

export function formatEther(rawWei: bigint): string {
  return formatUnits(rawWei, 18);
}

export interface Rational {
  numerator: bigint;
  denominator: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0n ? 1n : x;
}

/**
 * 表示値ベースのレート（例: 1, 0.5）を整数比に変換する。
 * 将来 swapRate が整数でない値になっても浮動小数点で計算しないため（設計書 2.4）。
 */
export function rateToRational(rate: number | string): Rational {
  const text = typeof rate === "number" ? rate.toString() : rate.trim();
  const asUnits = parseUnits(text, 18); // 10^18 を分母とする固定小数として読む
  const denominator = 10n ** 18n;
  const divisor = gcd(asUnits, denominator);
  return { numerator: asUnits / divisor, denominator: denominator / divisor };
}

/**
 * swap換算式（設計書 2.4 必須仕様）:
 *   amountOutRaw ＝ amountInRaw × 10^(decimalsOut − decimalsIn) × swapRate
 * swapRate は整数比（numerator/denominator）で受け取り、BigInt演算のみで計算する。
 * 割り切れない場合は切り捨て（整数除算）。
 */
export function swapAmountOutRaw(
  amountInRaw: bigint,
  decimalsIn: number,
  decimalsOut: number,
  rate: Rational,
): bigint {
  assertDecimals(decimalsIn);
  assertDecimals(decimalsOut);
  const exp = decimalsOut - decimalsIn;
  let numerator = amountInRaw * rate.numerator;
  let denominator = rate.denominator;
  if (exp >= 0) {
    numerator *= 10n ** BigInt(exp);
  } else {
    denominator *= 10n ** BigInt(-exp);
  }
  return numerator / denominator;
}
