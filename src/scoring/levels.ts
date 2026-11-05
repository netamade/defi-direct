// レベル定義（設計書 第1節 S-02 のレベル設計）
// Lv.1 見習いエクスプローラー（0XP〜）／Lv.2 読み手（100XP〜）／Lv.3 承認マスター見習い（250XP〜）
// Lv.4 スワップ挑戦者（450XP〜）／Lv.5 直コン入門修了（700XP〜）
// 設計書では「閾値はJSONで変更可能」とされるが、試作版では badges.json の形式を変えないため
// 定数として持つ（公開後の調整は本ファイルの差し替えで行う）。

export interface LevelDefinition {
  level: number;
  name: string;
  minXp: number;
}

export const LEVELS: LevelDefinition[] = [
  { level: 1, name: "見習いエクスプローラー", minXp: 0 },
  { level: 2, name: "読み手", minXp: 100 },
  { level: 3, name: "承認マスター見習い", minXp: 250 },
  { level: 4, name: "スワップ挑戦者", minXp: 450 },
  { level: 5, name: "直コン入門修了", minXp: 700 },
];

export interface LevelStatus {
  current: LevelDefinition;
  next: LevelDefinition | null;
  /** 次レベルまでの残りXP（最上位レベルでは 0） */
  xpToNext: number;
  /** 現在レベル区間内の進み具合（0〜1）。バーの表示用 */
  progressRatio: number;
}

export function levelForXp(totalXp: number): LevelStatus {
  let current: LevelDefinition = LEVELS[0] as LevelDefinition;
  let next: LevelDefinition | null = null;
  for (let i = 0; i < LEVELS.length; i++) {
    const def = LEVELS[i] as LevelDefinition;
    if (totalXp >= def.minXp) {
      current = def;
      next = LEVELS[i + 1] ?? null;
    }
  }
  if (!next) {
    return { current, next: null, xpToNext: 0, progressRatio: 1 };
  }
  const span = next.minXp - current.minXp;
  const into = totalXp - current.minXp;
  return {
    current,
    next,
    xpToNext: next.minXp - totalXp,
    progressRatio: span > 0 ? Math.min(1, Math.max(0, into / span)) : 1,
  };
}
