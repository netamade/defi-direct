// 進捗ダッシュボード S-02（設計書 第1節）
// 成長サマリー（総XP・レベル・XPバー・クリア数）、バッジ一覧、課題別進捗、
// 次におすすめの課題、データ管理（エクスポート／インポート／リセット）を表示する。
import type { LoadedData } from "../data/loader";
import {
  ProgressStore,
  defaultStorage,
  type ProgressState,
} from "../store/progressStore";
import { SimulationStore } from "../store/simulationStore";
import { levelForXp } from "../scoring/levels";
import { el, text, updateHeaderProgress } from "./dom";
import { chapterLabel } from "./format";
import { confirmDialog, showToast } from "./feedback";
import { statusLabelText } from "./pages";

export function renderDashboard(app: HTMLElement, data: LoadedData): void {
  app.replaceChildren();
  const storage = defaultStorage();
  const store = new ProgressStore(storage, () => ({ challengeXp: new Map(data.challenges.map(c => [c.id, c.xp])), badgeIds: new Set(data.badges.map(b => b.id)) }));
  const { state, recovered } = store.load();

  const root = el("div", "dashboard");
  root.append(text("h1", "進捗ダッシュボード"));
  if (recovered) {
    root.append(
      text("p", "進捗データは初期状態から表示しています。ここからまた積み上げていけます。", "note"),
    );
  }

  // 成長サマリー
  const level = levelForXp(state.totalXp);
  const summary = el("section", "card summary-card");
  summary.append(text("h2", "成長サマリー"));
  const summaryList = el("dl", "summary-list");
  const addRow = (label: string, value: string) => {
    summaryList.append(el("dt", undefined, [label]), el("dd", undefined, [value]));
  };
  addRow("総XP", `${state.totalXp} XP`);
  addRow("レベル", `Lv.${level.current.level} ${level.current.name}`);
  addRow(
    "クリア課題数",
    `${state.clearedChallengeIds.length} / ${data.challenges.length} 課題`,
  );
  summary.append(summaryList);
  if (level.next) {
    summary.append(text("p", `次のレベル（Lv.${level.next.level} ${level.next.name}）まで、あと ${level.xpToNext} XP`));
    const bar = document.createElement("progress");
    bar.className = "xp-bar";
    bar.max = 100;
    bar.value = Math.round(level.progressRatio * 100);
    bar.setAttribute("aria-label", "次のレベルまでの進み具合");
    summary.append(bar);
  } else {
    summary.append(text("p", "最上位レベルに到達しています。すごい！"));
  }
  root.append(summary);

  // バッジ一覧
  const badgeSection = el("section", "card");
  badgeSection.append(text("h2", "バッジ"));
  const grid = el("div", "badge-grid");
  for (const badge of data.badges) {
    const earned = state.badges.includes(badge.id);
    const item = el("div", earned ? "badge-item is-earned" : "badge-item is-locked");
    item.append(text("p", badge.name, "badge-name"));
    item.append(text("p", earned ? badge.description : badge.condition, "badge-desc"));
    item.append(text("p", earned ? "獲得済み" : "未獲得", "badge-state"));
    grid.append(item);
  }
  badgeSection.append(grid);
  root.append(badgeSection);

  // 課題別進捗表
  const tableSection = el("section", "card");
  tableSection.append(text("h2", "課題別進捗"));
  const table = el("table", "progress-table");
  const thead = el("thead", undefined, [
    el("tr", undefined, [
      el("th", undefined, ["課題"]),
      el("th", undefined, ["対応章"]),
      el("th", undefined, ["状態"]),
      el("th", undefined, ["XP"]),
    ]),
  ]);
  const tbody = el("tbody");
  for (const def of data.challenges) {
    const status = state.challengeStatus[def.id] ?? "未着手";
    const row = el("tr", undefined, [
      el("td", undefined, [`課題 ${def.id} ${def.title}`]),
      el("td", undefined, [chapterLabel(def)]),
      el("td", undefined, [statusLabelText(status, state.clearedChallengeIds.includes(def.id))]),
      el("td", undefined, [`${def.xp}`]),
    ]);
    tbody.append(row);
  }
  table.append(thead, tbody);
  tableSection.append(table);
  root.append(tableSection);

  // 次におすすめの課題
  const nextDef = data.challenges.find((def) => !state.clearedChallengeIds.includes(def.id));
  if (nextDef) {
    const recommend = el("section", "card");
    recommend.append(text("h2", "次におすすめの課題"));
    recommend.append(
      text("p", `課題 ${nextDef.id} ${nextDef.title}（${chapterLabel(nextDef)}）：${nextDef.goal}`),
    );
    const link = el("a", "btn btn-primary", ["挑戦する"]);
    link.href = `#/challenge/${nextDef.id}`;
    recommend.append(link);
    root.append(recommend);
  }

  // データ管理
  root.append(renderDataManagement(app, data, store, state));
  root.append(
    text("p", "XP・レベル・バッジは学習の目安であり、公式な資格・技能の証明ではありません。", "note"),
  );
  app.append(root);
}

function renderDataManagement(
  app: HTMLElement,
  data: LoadedData,
  store: ProgressStore,
  state: ProgressState,
): HTMLElement {
  const section = el("section", "card");
  section.append(text("h2", "データ管理"));
  section.append(
    text("p", "進捗はこのブラウザに保存されています。引っ越しや復旧にはエクスポート／インポートが使えます。", "note"),
  );
  const row = el("div", "data-actions");

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "btn btn-default";
  exportButton.textContent = "進捗をエクスポート（JSON）";
  exportButton.addEventListener("click", () => {
    const json = store.exportJson(state);
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "chokukon-progress.json";
      anchor.click();
      URL.revokeObjectURL(url);
      showToast("進捗を書き出しました。");
    } catch {
      showToast("書き出しに失敗しました。もう一度試してみてください。");
    }
  });
  row.append(exportButton);

  const importLabel = el("label", "btn btn-default import-label", ["進捗をインポート"]);
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "application/json";
  fileInput.hidden = true;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void file.text().then((content) => {
      const imported = store.importJson(content);
      if (imported) {
        store.save(imported);
        showToast("進捗を読み込みました。");
        renderDashboard(app, data);
        updateHeaderProgress(data);
      } else {
        showToast("そのファイルは読み込めませんでした。エクスポートしたJSONか確かめてみてください。");
      }
    });
  });
  importLabel.append(fileInput);
  row.append(importLabel);

  const progressReset = document.createElement("button");
  progressReset.type = "button";
  progressReset.className = "btn btn-quiet";
  progressReset.textContent = "進捗リセット";
  progressReset.addEventListener("click", () => {
    void (async () => {
      const ok = await confirmDialog({
        title: "進捗をリセットしますか？",
        message: "XP・バッジ・クリア記録が消えます。プレイ中の課題の状態（疑似残高など）は残ります。",
        confirmLabel: "進捗をリセットする",
      });
      if (!ok) return;
      store.reset();
      renderDashboard(app, data);
      updateHeaderProgress(data);
      showToast("進捗をリセットしました。");
    })();
  });
  row.append(progressReset);

  const allReset = document.createElement("button");
  allReset.type = "button";
  allReset.className = "btn btn-quiet";
  allReset.textContent = "全リセット";
  allReset.addEventListener("click", () => {
    void (async () => {
      const ok = await confirmDialog({
        title: "すべてリセットしますか？",
        message: "進捗も、すべての課題のプレイ状態（疑似残高・ログ）も初期化されます。",
        confirmLabel: "全リセットする",
      });
      if (!ok) return;
      store.reset();
      new SimulationStore(defaultStorage()).clearAll(data.challenges.map((c) => c.id));
      renderDashboard(app, data);
      updateHeaderProgress(data);
      showToast("すべてリセットしました。");
    })();
  });
  row.append(allReset);
  section.append(row);
  return section;
}
