// 課題プレイ画面 S-04（設計書 第1節）
// 左カラム：課題パネル（約35%）。右カラム：疑似ウォレット＋疑似エクスプローラー（約65%）。
// クリア時は S-08 のクリア演出モーダル、区切り時は RETRY モーダルを出す。
import type { LoadedData } from "../data/loader";
import { defaultStorage, ProgressStore } from "../store/progressStore";
import { SimulationStore } from "../store/simulationStore";
import { el, text, updateHeaderProgress } from "./dom";
import { openModal, confirmDialog } from "./feedback";
import { ExplorerView } from "./explorer";
import { renderWallet } from "./wallet";
import { renderChallengePanel, type PanelViewState } from "./challengePanel";
import { PlaySession, type ActionOutcome, type ClearEvent } from "./session";

export function renderPlay(app: HTMLElement, data: LoadedData, challengeId: string): void {
  app.replaceChildren();
  const def = data.byId.get(challengeId);
  if (!def) {
    const card = el("section", "card");
    card.append(text("h1", "課題が見つかりませんでした"));
    card.append(text("p", "課題データの読み込みに問題があります。課題一覧から選び直してみてください。"));
    const back = el("a", undefined, ["課題一覧へ"]);
    back.href = "#/challenges";
    card.append(back);
    app.append(card);
    return;
  }

  const storage = defaultStorage();
  const progressStore = new ProgressStore(storage, () => ({ challengeXp: new Map(data.challenges.map(c => [c.id, c.xp])), badgeIds: new Set(data.badges.map(b => b.id)) }));
  const simStore = new SimulationStore(storage);
  const session = new PlaySession(data, def, progressStore, simStore);
  const viewState: PanelViewState = { hintsShown: 0 };

  const layout = el("div", "play-layout");
  const left = el("div", "play-left");
  const right = el("div", "play-right");
  const walletBox = el("div");
  layout.append(left, right);
  app.append(layout);

  const refreshPanel = () => {
    left.replaceChildren(renderChallengePanel(session, viewState, panelCallbacks));
  };
  const refreshWallet = () => {
    walletBox.replaceChildren(renderWallet(session));
  };

  const handleOutcome = (outcome: ActionOutcome) => {
    explorer.refreshDynamic();
    refreshPanel();
    refreshWallet();
    updateHeaderProgress(data);
    if (outcome.clear) showClearModal(data, session, outcome.clear);
  };

  const panelCallbacks = {
    onQuizOutcome: handleOutcome,
    onRefresh: refreshPanel,
    onRequestReset: () => {
      void (async () => {
        const ok = await confirmDialog({
          title: "課題をリセットしますか？",
          message:
            "疑似残高とログ、クイズ回答が初期化されます。クリア記録・XP・バッジは消えません。",
          confirmLabel: "リセットする",
        });
        if (!ok) return;
        session.reset();
        renderPlay(app, data, challengeId);
      })();
    },
    onRequestRetry: () => {
      session.markRetry();
      refreshPanel();
      updateHeaderProgress(data);
      showRetryModal(data, session);
    },
  };

  const explorer = new ExplorerView(session, {
    onAction: handleOutcome,
    onProgressChanged: () => {
      refreshPanel();
      updateHeaderProgress(data);
    },
  });

  right.append(walletBox, explorer.element);
  refreshPanel();
  refreshWallet();
}

/** S-08 クリア演出（CSSのみの軽いアニメーション。音なし） */
function showClearModal(data: LoadedData, session: PlaySession, clear: ClearEvent): void {
  const def = session.def;
  const body = el("div", "clear-body");
  const confetti = el("div", "confetti");
  for (let i = 0; i < 12; i++) confetti.append(el("span", "confetti-piece"));
  body.append(confetti);
  body.append(text("p", def.successMessage, "clear-message"));
  if (clear.firstClear) {
    body.append(text("p", `獲得XP：+${clear.awardedXp} XP`, "clear-xp"));
  } else {
    body.append(text("p", "もう一度クリアできたね！（XPは初回のみ付与されます）", "clear-xp"));
  }
  if (clear.leveledUp) {
    body.append(text("p", `レベルアップ！ Lv.${clear.newLevel} になったよ。`, "clear-levelup"));
  }
  if (clear.newBadgeIds.length > 0) {
    const names = clear.newBadgeIds
      .map((id) => data.badges.find((b) => b.id === id)?.name ?? id)
      .join("、");
    body.append(text("p", `バッジ獲得：${names}`, "clear-badges"));
  }
  body.append(text("p", "XP・バッジは学習の目安であり、公式な証明ではありません。", "note"));

  const index = data.challenges.findIndex((c) => c.id === def.id);
  const next = data.challenges[index + 1];
  const actions = [];
  if (next) {
    actions.push({
      label: `次の課題へ（課題 ${next.id}）`,
      kind: "primary" as const,
      onClick: () => {
        window.location.hash = `#/challenge/${next.id}`;
      },
    });
  }
  actions.push({
    label: "ダッシュボードへ",
    kind: "default" as const,
    onClick: () => {
      window.location.hash = "#/dashboard";
    },
  });
  actions.push({ label: "もう一度練習する", kind: "quiet" as const });
  openModal({ title: "QUEST CLEAR！", body, actions, className: "modal-clear" });
}

/** S-08 RETRY表示（クリア演出は出さない。具体的なヒントを1件示す） */
function showRetryModal(data: LoadedData, session: PlaySession): void {
  void data;
  const body = el("div", "retry-body");
  body.append(text("p", session.def.retryMessage));
  const firstUnmet = session.evaluation.unmet[0];
  if (firstUnmet) {
    body.append(text("p", `次の一手：${firstUnmet}`, "retry-hint"));
  }
  body.append(text("p", "RETRYは区切りであって、終わりではありません。また続きから挑戦できます。", "note"));
  openModal({
    title: "一区切り、おつかれさま！",
    body,
    actions: [
      { label: "もう一度挑戦する", kind: "primary" },
      {
        label: "ダッシュボードへ",
        kind: "quiet",
        onClick: () => {
          window.location.hash = "#/dashboard";
        },
      },
    ],
  });
}
