// 課題パネル（設計書 第1節 S-04 左カラム）
// 目的・シナリオ・手順チェックリスト（自動チェック）・段階式ヒント・確認クイズ・注意事項を表示する。
// ヒントは答えそのものを漏らさない範囲に留める（課題JSONの文言をそのまま使う）。
import { el, text } from "./dom";
import { chapterLabel, difficultyStars } from "./format";
import type { ActionOutcome, PlaySession } from "./session";
import type { ChallengeStatus } from "../store/progressStore";

export interface PanelViewState {
  hintsShown: number;
}

export interface PanelCallbacks {
  onQuizOutcome: (outcome: ActionOutcome) => void;
  onRefresh: () => void;
  onRequestReset: () => void;
  onRequestRetry: () => void;
}

const STATUS_LABEL: Record<ChallengeStatus, string> = {
  "未着手": "未着手",
  "IN PROGRESS": "挑戦中",
  "QUEST CLEAR": "QUEST CLEAR",
  "RETRY": "RETRY（一区切り）",
};

export function statusLabel(session: PlaySession): string {
  if (session.alreadyCleared()) {
    return session.evaluation.passed ? "QUEST CLEAR" : "クリア済み（再練習中）";
  }
  return STATUS_LABEL[session.status()];
}

export function renderChallengePanel(
  session: PlaySession,
  viewState: PanelViewState,
  callbacks: PanelCallbacks,
): HTMLElement {
  const def = session.def;
  const root = el("section", "card challenge-panel");
  root.setAttribute("aria-label", "課題パネル");

  root.append(text("p", `課題 ${def.id}`, "challenge-number"));
  root.append(text("h1", def.title, "challenge-title"));
  root.append(text("p", def.subtitle, "challenge-subtitle"));
  const meta = el("p", "challenge-meta", [
    `${chapterLabel(def)} ・ 難易度 ${difficultyStars(def.difficulty)} ・ 目安 ${def.estimatedMinutes}分 ・ 獲得XP ${def.xp}`,
  ]);
  root.append(meta);
  root.append(el("p", "status-line", [`状態：`, el("span", "status-badge", [statusLabel(session)])]));

  if (session.evaluation.warnings.length > 0) {
    root.append(
      text("p", "この課題の判定条件に問題があるため、現在クリア判定ができません。", "warn-text"),
    );
  }
  if (session.evaluation.gate.blocked) {
    root.append(
      text(
        "p",
        "この試行では、しないはずの操作が含まれているよ。リセットすれば、もう一度挑戦できるよ。",
        "warn-text",
      ),
    );
  }

  root.append(text("h2", "目的"));
  root.append(text("p", def.goal));
  root.append(text("h2", "シナリオ"));
  root.append(text("p", def.scenario));

  // 手順チェックリスト（自動チェック）
  root.append(text("h2", "手順チェックリスト"));
  const list = el("ul", "checklist");
  for (const item of session.checklist()) {
    list.append(
      el("li", item.done ? "checklist-item is-done" : "checklist-item", [
        el("span", "checklist-mark", [item.done ? "✓" : "…"]),
        item.text,
      ]),
    );
  }
  root.append(list);

  // あと少しのヒント（未達成理由をヒントとして表示。答えそのものは出さない）
  if (!session.evaluation.passed && session.evaluation.unmet.length > 0 && session.status() !== "未着手") {
    root.append(text("h2", "あと少しのところ"));
    const unmet = el("ul", "unmet-list");
    for (const reason of session.evaluation.unmet.slice(0, 3)) {
      unmet.append(el("li", undefined, [reason]));
    }
    root.append(unmet);
  }

  // 段階式ヒント
  root.append(text("h2", "ヒント"));
  const shown = def.hints.slice(0, viewState.hintsShown);
  if (shown.length === 0) {
    root.append(text("p", "困ったら、段階式ヒントを少しずつ開いてみよう。", "note"));
  } else {
    const hintList = el("ol", "hint-list");
    for (const hint of shown) hintList.append(el("li", undefined, [hint]));
    root.append(hintList);
  }
  if (viewState.hintsShown < def.hints.length) {
    const next = document.createElement("button");
    next.type = "button";
    next.className = "btn btn-default btn-small";
    next.textContent = `ヒントを見る（${viewState.hintsShown + 1} / ${def.hints.length}）`;
    next.addEventListener("click", () => {
      viewState.hintsShown += 1;
      callbacks.onRefresh();
    });
    root.append(next);
  }

  // 確認クイズ
  if (def.questions && def.questions.length > 0) {
    root.append(text("h2", "確認クイズ"));
    for (const question of def.questions) {
      root.append(renderQuestion(session, question.questionId, callbacks));
    }
  }

  root.append(text("h2", "注意事項"));
  root.append(
    text(
      "p",
      "この課題は疑似シミュレーターで完結します。実チェーンには接続しません。分からなければ署名しない、が直コンの安全原則です（このサイトの送信もすべて疑似です）。",
      "note",
    ),
  );

  const actions = el("div", "panel-actions");
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "btn btn-default";
  resetButton.textContent = "課題をリセット";
  resetButton.addEventListener("click", callbacks.onRequestReset);
  actions.append(resetButton);
  if (!session.alreadyCleared() && session.status() === "IN PROGRESS") {
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.className = "btn btn-quiet";
    retryButton.textContent = "ここで一区切りつける";
    retryButton.addEventListener("click", callbacks.onRequestRetry);
    actions.append(retryButton);
  }
  root.append(actions);
  root.append(
    text("p", "リセットでは疑似残高とログ、クイズ回答が初期化されます。クリア記録・XP・バッジは消えません。", "note"),
  );
  return root;
}

function renderQuestion(
  session: PlaySession,
  questionId: string,
  callbacks: PanelCallbacks,
): HTMLElement {
  const question = session.def.questions?.find((q) => q.questionId === questionId);
  const wrap = el("div", "quiz-item");
  if (!question) return wrap;
  wrap.append(text("p", question.prompt, "quiz-prompt"));
  const answered = session.quizAnswers()[questionId];
  const correct = session.isQuizCorrect(questionId);

  if (question.kind === "choice") {
    const options = el("div", "quiz-options");
    for (const option of question.options ?? []) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `btn btn-small ${answered === option.optionId ? "btn-primary" : "btn-default"}`;
      btn.textContent = option.label;
      btn.addEventListener("click", () => {
        const outcome = session.answerQuiz(questionId, option.optionId);
        callbacks.onQuizOutcome(outcome);
      });
      options.append(btn);
    }
    wrap.append(options);
  } else {
    const row = el("div", "quiz-numeric");
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.className = "input-text";
    input.value = answered ?? "";
    input.setAttribute("aria-label", "数値で回答");
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "btn btn-primary btn-small";
    submit.textContent = "回答する";
    submit.addEventListener("click", () => {
      const outcome = session.answerQuiz(questionId, input.value);
      callbacks.onQuizOutcome(outcome);
    });
    row.append(input, submit);
    wrap.append(row);
  }

  if (answered !== undefined) {
    wrap.append(
      text(
        "p",
        correct ? "正解！よく読み解けたね。" : "おしい！あと一歩だよ。Readの結果をもう一度確かめてみよう。",
        correct ? "quiz-feedback quiz-ok" : "quiz-feedback quiz-ng",
      ),
    );
  }
  return wrap;
}
