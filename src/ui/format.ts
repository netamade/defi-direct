// 表示の書式ヘルパー（設計書 0.5.2 の疑似明示、2.6 の3点セット表示）
import { formatUnits } from "../engine/units";
import type { Address } from "../engine/state";
import type { ChallengeDefinition } from "../data/types";

/** 疑似アドレス（全文）。`疑似` を省略しない */
export function pseudoAddressFull(address: Address): string {
  return `疑似 ${address}（架空）`;
}

/** 疑似アドレス（短縮）。短縮しても `疑似` と（架空）を付ける */
export function pseudoAddressShort(address: Address): string {
  if (address.length <= 14) return pseudoAddressFull(address);
  return `疑似 ${address.slice(0, 6)}…${address.slice(-4)}（架空）`;
}

/** 「表示値（raw値、decimals）」の3点セット（設計書 2.6） */
export function amountTriple(raw: bigint, decimals: number, symbol?: string): string {
  const display = formatUnits(raw, decimals);
  const withSymbol = symbol ? `${display} ${symbol}` : display;
  return `${withSymbol}（raw ${raw.toString()}、decimals ${decimals}）`;
}

/** 対応章の表示（章番号だけにしない。設計書 第6節） */
export function chapterLabel(def: ChallengeDefinition): string {
  return `第${def.chapter.bookChapter}章 ${def.chapter.bookTitle}`;
}

export function difficultyStars(difficulty: number): string {
  return "★".repeat(difficulty) + "☆".repeat(Math.max(0, 3 - difficulty));
}
