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
  hero.append(text("h1", "スマートコントラクト直接操作 疑似シミュレーター"));
  hero.append(
    text(
      "p",
      "本サイトは、書籍『直コン徹底解説本』と連動した練習用の疑似シミュレーターです。実チェーンや実際の暗号資産（仮想通貨）とは一切接続されていない安全な環境で、エクスプローラーからの直接コントラクト操作（直コン）を何度でも体験・学習できます。",
    ),
  );
  root.append(hero);

  const steps = el("section", "card");
  steps.append(text("h2", "シミュレーターの進め方"));
  const ol = el("ol", "howto-steps");
  ol.append(el("li", undefined, ["課題を選択する：一覧から現在の学習フェーズに合った課題を選びます。"]));
  ol.append(el("li", undefined, ["疑似環境で操作する：疑似エクスプローラー画面を用いて、コントラクトのRead（照会）やWrite（書き込み）を行います。"]));
  ol.append(el("li", undefined, ["条件を達成する：指定された操作手順を完了し、実践的な知識を身につけましょう。"]));
  steps.append(ol);
  root.append(steps);

  const promises = el("section", "card");
  promises.append(text("h2", "安全に学習いただくための3つの約束"));
  const ul = el("ul", "promise-list");
  ul.append(el("li", undefined, ["ウォレット接続不要：MetaMask等の実ウォレットを接続する機能は一切存在しません。"]));
  ul.append(el("li", undefined, ["秘密鍵・シードフレーズの入力禁止：これらを入力する画面や項目は設けていません。"]));
  ul.append(el("li", undefined, ["架空の資産とアドレス：表示されるトークン、アドレス、残高はすべて疑似データです。実資産が失われることはありません。"]));
  promises.append(ul);
  root.append(promises);

  const listSection = el("section");
  listSection.append(text("h2", "課題一覧（抜粋）"));
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
      "対象読者：ウォレットを用いたswapや送金の経験があり、フロントエンドの裏側でブロックチェーンがどのように動いているかを直接確かめたい方。前提知識：ウォレットの基本的な操作方法およびトークン送受信の仕組み。",
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
  { term: "decimals", body: "トークンの小数点以下の桁数を示します。コントラクト上のraw値を10のdecimals乗で割ることで、普段私たちが目にする表示値となります。トークンごとに設定値が異なるため、操作前に必ず確認が必要です。" },
  { term: "raw値", body: "スマートコントラクト内で実際に扱われている、小数点を含まない最小単位の整数値です。表示値に対して10のdecimals乗を掛けた値となります。" },
  { term: "allowance", body: "トークンの所有者が、特定のアドレス（spender）に対して引き出しを許可している残りのトークン量です。" },
  { term: "approve", body: "第三者（DEXなどのコントラクト）に対して、自身のトークンを移動させる権限を与える操作です。指定した数量で上書きされる仕様であり、0を指定することで承認状態を解除（リボーク）できます。" },
  { term: "revert", body: "エラーなどの理由により、トランザクションの処理が中断され、状態の変更がすべて取り消される（巻き戻る）仕組みです。ただし、トランザクション実行にかかったガス代（手数料）は消費されます。" },
  { term: "ガス（Gas）", body: "ブロックチェーン上でトランザクションを実行する際に発生するネットワーク手数料です。本シミュレーターでは疑似的なETHを用いて計算されます。" },
  { term: "疑似ブロック", body: "本サイト独自の簡易的なブロック生成モデルです。Write操作（書き込み）が実行されるたびにブロックが1つ進む仕様となっています。実際のブロックチェーンとは異なります。" },
  { term: "無制限承認", body: "allowanceに事実上の無限大（type(uint256).max）を設定するapprove操作です。利便性は高い反面、悪意あるコントラクトに無限の引き出し権限を与えたままになるリスクがあるため、本サイトの課題では推奨しない操作として扱います。" },
];

export function renderHelp(app: HTMLElement): void {
  app.replaceChildren();
  const root = el("div", "help-page");
  root.append(text("h1", "ヘルプ／用語・安全ガイド"));

  const safety = el("section", "card");
  safety.append(text("h2", "安全ガイド"));
  const ul = el("ul", "promise-list");
  ul.append(el("li", undefined, ["本サイトは学習用の疑似シミュレーターであり、実際のブロックチェーンネットワークには接続されていません。"]));
  ul.append(el("li", undefined, ["実ウォレットの秘密鍵やシードフレーズを入力することは絶対に避けてください。本サイトにはそれらを入力する機能は存在しません。"]));
  ul.append(el("li", undefined, ["実践における原則：本環境で操作手順と仕組みを十分に理解した上で、実際のチェーンではまず少額でのテスト実行を徹底してください。内容が理解できないトランザクションには絶対に署名しないでください。"]));
  ul.append(el("li", undefined, ["サイト内に表示されるアドレスやトークン名はすべて架空（疑似データ）です。実在のプロジェクトや資産とは一切関係ありません。"]));
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
