// DOM生成の共通ヘルパー。
// 課題JSONなどの文字列は必ず textContent で描画する（設計書 0.5.3）。
// プログラムから style 属性は設定しない（CSP style-src 'self' を守るため、見た目はCSSクラスで表す）。
import { levelForXp } from "../scoring/levels";
import type { LoadedData } from "../data/loader";
import { ProgressStore, defaultStorage } from "../store/progressStore";

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function text(tag: "h1" | "h2" | "h3" | "h4" | "p" | "span" | "li" | "dt" | "dd", content: string, className?: string): HTMLElement {
  return el(tag, className, [content]);
}

export function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el("button", className, [label]);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

export function linkButton(label: string, href: string, className?: string): HTMLAnchorElement {
  const node = el("a", className, [label]);
  node.href = href;
  return node;
}

/** ヘッダーの進捗ミニ表示を最新化する（XP合計は index から動的算出した値を使う） */
export function updateHeaderProgress(data: LoadedData): void {
  const header = document.getElementById("header-progress");
  if (!header) return;
  try {
    const store = new ProgressStore(defaultStorage(), () => ({ challengeXp: new Map(data.challenges.map(c => [c.id, c.xp])), badgeIds: new Set(data.badges.map(b => b.id)) }));
    const { state } = store.load();
    const level = levelForXp(state.totalXp).current;
    header.textContent = `Lv.${level.level} ${level.name} ・ ${state.totalXp} XP ・ クリア ${state.clearedChallengeIds.length}/${data.challenges.length} 課題`;
  } catch {
    header.textContent = "";
  }
}
