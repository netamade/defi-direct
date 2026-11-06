// S-01 トップ / S-03 課題一覧 / S-09 ヘルプ（設計書 第1節）
// 課題カードは課題JSONから自動生成する（手書きHTMLで課題を増やさない。S-03 仕様）。
import type { LoadedData } from "../data/loader";
import type { ChallengeDefinition } from "../data/types";
import { ProgressStore, defaultStorage, type ChallengeStatus } from "../store/progressStore";
import { el, text } from "./dom";
import { chapterLabel, difficultyStars } from "./format";

export function statusLabelText(status: ChallengeStatus, cleared: boolean): string {
  if (cleared) return "QUEST CLEAR";
  switch (status) {
    case "IN PROGRESS":
      return "挑戦中";
    case "RETRY":
      return "RETRY（一区切り）";
    case "QUEST CLEAR":
      return "QUEST CLEAR";
    default:
      return "未着手";
  }
}

function loadProgress(data: LoadedData) {
  const store = new ProgressStore(defaultStorage(), () => data.totalXp);
  return store.load().state;
}

export function renderChallengeCard(def: ChallengeDefinition, status: ChallengeStatus, cleared: boolean): HTMLElement {
  const card = el("article", "card challenge-card");
  card.append(text("p", `課題 ${def.id}`, "challenge-number"));
  card.append(text("h3", def.title, "challenge-card-title"));
  card.append(text("p", def.subtitle, "challenge-subtitle"));
  const meta = el("ul", "challenge-card-meta");
  meta.append(el("li", undefined, [chapterLabel(def)]));
  meta.append(el("li", undefined, [`難易度 ${difficultyStars(def.difficulty)}`]));
  meta.append(el("li", undefined, [`目安 ${def.estimatedMinutes}分`]));
  meta.append(el("li", undefined, [`獲得XP ${def.xp}`]));
  meta.append(el("li", undefined, [`状態：${statusLabelText(status, cleared)}`]));
  card.append(meta);
  card.append(text("p", def.goal, "challenge-goal"));
  const link = el("a", "btn btn-primary", ["挑戦する"]);
  link.href = `#/challenge/${def.id}`;
  card.append(link);
  return card;
}

// --- S-01 トップ／はじめに ---

export function renderTop(app: HTMLElement, data: LoadedData): void {
  app.replaceChildren();
  const progress = loadProgress(data);
  const root = el("div", "top-page");

  const hero = el("section", "card hero");
  hero.append(text("h1", "直コンを、触って練習しよう"));
  hero.append(
    text(
      "p",
      "このサイトは『DeFiの裏口』の練習用サイトです。実チェーンには接続していない疑似シミュレーターなので、安心して何度でも試せます。",
    ),
  );
  root.append(hero);

  const steps = el("section", "card");
  steps.append(text("h2", "始め方（3ステップ）"));
  const ol = el("ol", "howto-steps");
  ol.append(el("li", undefined, ["課題を選ぶ"]));
  ol.append(el("li", undefined, ["疑似エクスプローラーで読む・書く"]));
  ol.append(el("li", undefined, ["クリアしてXPをためる"]));
  steps.append(ol);
  root.append(steps);

  const promises = el("section", "card");
  promises.append(text("h2", "安全性の3つの約束"));
  const ul = el("ul", "promise-list");
  ul.append(el("li", undefined, ["ウォレット接続なし：実ウォレットを接続する機能はありません"]));
  ul.append(el("li", undefined, ["秘密鍵入力なし：秘密鍵・シードフレーズの入力欄そのものがありません"]));
  ul.append(el("li", undefined, ["実送金なし：表示されるアドレス・残高はすべて架空で、実資産は動きません"]));
  promises.append(ul);
  root.append(promises);

  const listSection = el("section");
  listSection.append(text("h2", "課題の抜粋"));
  const grid = el("div", "challenge-grid");
  for (const def of data.challenges.slice(0, 3)) {
    grid.append(
      renderChallengeCard(def, progress.challengeStatus[def.id] ?? "未着手", progress.clearedChallengeIds.includes(def.id)),
    );
  }
  listSection.append(grid);
  const allLink = el("a", "btn btn-default", ["課題一覧をすべて見る"]);
  allLink.href = "#/challenges";
  listSection.append(allLink);
  root.append(listSection);

  root.append(
    text(
      "p",
      "対象読者：ウォレットでのswapや送金は経験済みで、公式UIの裏で何が起きているかを自分で確かめたい方。前提知識：ウォレットの基本操作と、トークンの送受信の経験。",
      "note",
    ),
  );
  app.append(root);
}

// --- S-03 課題一覧 ---

export function renderChallenges(app: HTMLElement, data: LoadedData): void {
  app.replaceChildren();
  const progress = loadProgress(data);
  const root = el("div", "challenges-page");
  root.append(text("h1", "課題一覧"));
  if (data.invalid.length > 0 || data.problems.length > 0) {
    root.append(text("p", "一部の課題データの読み込みに問題があります。表示されている課題はそのまま遊べます。", "warn-text"));
  }

  const chapters = [...new Set(data.challenges.map((d) => d.chapter.bookChapter))].sort((a, b) => a - b);
  const filters = el("div", "challenge-filters");
  const makeSelect = (labelText: string, values: { value: string; label: string }[]): HTMLSelectElement => {
    const label = el("label", "field-label inline", [labelText]);
    const select = document.createElement("select");
    select.className = "input-select";
    for (const v of values) {
      const option = document.createElement("option");
      option.value = v.value;
      option.textContent = v.label;
      select.append(option);
    }
    label.append(select);
    filters.append(label);
    return select;
  };
  const chapterSelect = makeSelect("章", [
    { value: "", label: "すべての章" },
    ...chapters.map((c) => {
      const def = data.challenges.find((d) => d.chapter.bookChapter === c);
      return { value: String(c), label: def ? chapterLabel(def) : `第${c}章` };
    }),
  ]);
  const statusSelect = makeSelect("状態", [
    { value: "", label: "すべての状態" },
    { value: "未着手", label: "未着手" },
    { value: "IN PROGRESS", label: "挑戦中" },
    { value: "QUEST CLEAR", label: "QUEST CLEAR" },
    { value: "RETRY", label: "RETRY（一区切り）" },
  ]);
  const difficultySelect = makeSelect("難易度", [
    { value: "", label: "すべての難易度" },
    { value: "1", label: "★1" },
    { value: "2", label: "★2" },
    { value: "3", label: "★3" },
  ]);
  root.append(filters);

  const grid = el("div", "challenge-grid");
  const renderGrid = () => {
    grid.replaceChildren();
    const filtered = data.challenges.filter((def) => {
      if (chapterSelect.value !== "" && def.chapter.bookChapter !== Number(chapterSelect.value)) return false;
      if (difficultySelect.value !== "" && def.difficulty !== Number(difficultySelect.value)) return false;
      if (statusSelect.value !== "") {
        const cleared = progress.clearedChallengeIds.includes(def.id);
        const effective = cleared ? "QUEST CLEAR" : (progress.challengeStatus[def.id] ?? "未着手");
        if (effective !== statusSelect.value) return false;
      }
      return true;
    });
    if (filtered.length === 0) {
      grid.append(text("p", "条件に合う課題がありません。フィルターを変えてみてください。", "note"));
      return;
    }
    for (const def of filtered) {
      grid.append(
        renderChallengeCard(
          def,
          progress.challengeStatus[def.id] ?? "未着手",
          progress.clearedChallengeIds.includes(def.id),
        ),
      );
    }
  };
  for (const select of [chapterSelect, statusSelect, difficultySelect]) {
    select.addEventListener("change", renderGrid);
  }
  renderGrid();
  root.append(grid);
  app.append(root);
}

// --- S-09 ヘルプ／用語・安全ガイド ---

const GLOSSARY: { term: string; body: string }[] = [
  { term: "decimals", body: "トークンの小数点以下の桁数。raw値をこの桁数で割ると表示値になります。トークンごとに違うので、必ずそのトークンのdecimalsを確認します。" },
  { term: "raw値（最小単位）", body: "コントラクトが扱う最小単位の整数。表示値に10のdecimals乗をかけたものがraw値です。" },
  { term: "allowance", body: "あるアドレス（spender）が、持ち主の代わりに使えるトークンの残りの量。approveで設定します。" },
  { term: "approve", body: "spenderへトークンの使用許可を与える操作。加算ではなく上書きです。0をapproveすると解除（revoke）になります。" },
  { term: "revert", body: "コントラクトが処理を止めて、状態の変更を取り消すこと。このサイトでは「コントラクトが止めてくれたサイン」として学びます。ガス代だけはかかります（疑似環境でも同じです）。" },
  { term: "ガス", body: "トランザクションの手数料。このサイトのガス数値はすべて疑似値で、疑似ETHから支払われます。" },
  { term: "疑似ブロック", body: "このサイトの簡易モデルでは、Writeがブロックに含まれるたびに1つ進みます。実際のブロックは時間経過で生成され、複数のトランザクションを含みます。" },
  { term: "無制限承認", body: "allowanceを最大値（type(uint256).max相当）にするapprove。便利な反面、許可が残り続けるため、このサイトの課題では「しない操作」として扱います。" },
];

export function renderHelp(app: HTMLElement): void {
  app.replaceChildren();
  const root = el("div", "help-page");
  root.append(text("h1", "ヘルプ／用語・安全ガイド"));

  const safety = el("section", "card");
  safety.append(text("h2", "安全ガイド"));
  const ul = el("ul", "promise-list");
  ul.append(el("li", undefined, ["このサイトは練習用の疑似シミュレーターです。実チェーンには接続していません。"]));
  ul.append(el("li", undefined, ["秘密鍵・シードフレーズは絶対に入力しないでください。このサイトに入力欄はありません。もし本物のサイトで求められたら、それは危険信号です。"]));
  ul.append(el("li", undefined, ["本番の原則：シミュレーターで同じ操作を成功させてから、少額で試し、確認してから進みます。分からなければ署名しない。"]));
  ul.append(el("li", undefined, ["表示されるアドレスには「疑似」を付けています。実在のアドレスと混同しないでください。"]));
  safety.append(ul);
  root.append(safety);

  const glossary = el("section", "card");
  glossary.append(text("h2", "用語集"));
  const dl = el("dl", "glossary");
  for (const entry of GLOSSARY) {
    dl.append(el("dt", undefined, [entry.term]), el("dd", undefined, [entry.body]));
  }
  glossary.append(dl);
  root.append(glossary);
  app.append(root);
}
