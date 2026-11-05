// 疑似ウォレット（設計書 第1節 S-04 / 0.5）
// - 常に「疑似ウォレット接続中（練習用）」と表示し、実ウォレットとの混同を招かない。
// - 完全にローカルな状態操作のみ。実ウォレット接続の処理は一切持たない。
import { formatEther } from "../engine/units";
import { el, text } from "./dom";
import { amountTriple, pseudoAddressFull } from "./format";
import { showToast } from "./feedback";
import type { PlaySession } from "./session";

export function renderWallet(session: PlaySession): HTMLElement {
  const state = session.state;
  const user = state.accounts[session.userAddress];
  const root = el("section", "card wallet");
  root.setAttribute("aria-label", "疑似ウォレット");

  const status = el("p", "wallet-status", [
    el("span", "wallet-dot"),
    "疑似ウォレット接続中（練習用）",
  ]);
  root.append(status);
  root.append(text("p", "ネットワーク：疑似ネットワーク（実チェーン非接続）", "wallet-note"));

  // 練習用アドレス（全文表示＋コピーボタン。コピー時は注記を出す）
  const addressRow = el("div", "wallet-address");
  addressRow.append(el("code", undefined, [pseudoAddressFull(session.userAddress)]));
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "btn btn-quiet btn-small";
  copyButton.textContent = "コピー";
  copyButton.addEventListener("click", () => {
    const done = () => showToast("コピーしました。これは練習用の架空アドレスです。");
    try {
      void navigator.clipboard?.writeText(session.userAddress).then(done, done);
    } catch {
      done();
    }
  });
  addressRow.append(copyButton);
  root.append(addressRow);

  const list = el("dl", "wallet-balances");
  const addRow = (label: string, value: string) => {
    list.append(el("dt", undefined, [label]), el("dd", undefined, [value]));
  };
  if (user) {
    addRow(
      "疑似ETH（ガス用）",
      `${formatEther(user.ethBalanceWei)} ETH（raw ${user.ethBalanceWei.toString()} wei、decimals 18）`,
    );
  }
  for (const token of Object.values(state.tokens)) {
    const balance = token.balances[session.userAddress] ?? 0n;
    addRow(`${token.symbol}（${token.name}）`, amountTriple(balance, token.decimals, token.symbol));
  }
  addRow("疑似ブロック番号", `疑似ブロック ${state.blockNumber}`);
  root.append(list);
  root.append(
    text(
      "p",
      "疑似ブロックは1トランザクションごとに進む簡易モデルです。実際のブロックは時間経過で生成され、複数のトランザクションを含みます。",
      "wallet-note",
    ),
  );
  return root;
}
