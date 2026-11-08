// 疑似エクスプローラー（設計書 第1節 S-05〜S-07）
// - S-05 Read Contract タブ：状態を変えない読み取り。成功したReadはcallLogに残り採点の証拠になる。
// - S-06 Write Contract タブ：送信前確認モーダル必須。forbiddenAction は block / warn のガード。
// - S-07 結果／ログパネル：結果カード、txログ（Write履歴）とcallログ（成功したRead）を区別して表示。
// 課題JSONの文字列はすべて textContent で描画する（0.5.3）。
import type { ReadFunctionName, WriteFunctionName } from "../engine/executor";
import type { Address, CallRecord, TxRecord } from "../engine/state";
import { formatUnits, MAX_UINT256 } from "../engine/units";
import {
  revertMessage,
  validateAddressInput,
  validateAmountInput,
  ZERO_ADDRESS,
  type RevertCode,
} from "../engine/validation";
import type { FunctionDefinition } from "../data/types";
import { el, text } from "./dom";
import { amountTriple, pseudoAddressShort } from "./format";
import { openModal, showToast } from "./feedback";
import type { ActionOutcome, PlaySession, WritePreview } from "./session";

const READ_FUNCTIONS: { name: ReadFunctionName; signature: string; fallbackDescription: string }[] = [
  { name: "name", signature: "name()", fallbackDescription: "トークンの名前を返す" },
  { name: "symbol", signature: "symbol()", fallbackDescription: "トークンのシンボル（略称）を返す" },
  { name: "decimals", signature: "decimals()", fallbackDescription: "小数点以下の桁数を返す" },
  { name: "totalSupply", signature: "totalSupply()", fallbackDescription: "発行総量（raw値）を返す" },
  { name: "balanceOf", signature: "balanceOf(address account)", fallbackDescription: "指定アドレスの残高（raw値）を返す" },
  {
    name: "allowance",
    signature: "allowance(address owner, address spender)",
    fallbackDescription: "ownerがspenderに承認した量（raw値）を返す",
  },
];

interface ExplorerCallbacks {
  onAction: (outcome: ActionOutcome) => void;
  onProgressChanged: () => void;
}

export class ExplorerView {
  readonly element: HTMLElement;
  private readonly session: PlaySession;
  private readonly callbacks: ExplorerCallbacks;
  private readContract: Address;
  private writeContract: Address;
  private readResults = new Map<string, string[]>();
  private logFilter: "all" | "tx" | "call" = "all";
  private logsBox: HTMLElement | null = null;
  private latestBox: HTMLElement | null = null;
  private readonly revertQuizDone = new Set<string>();

  constructor(session: PlaySession, callbacks: ExplorerCallbacks) {
    this.session = session;
    this.callbacks = callbacks;
    const first = session.def.contracts[0];
    this.readContract = first?.address ?? "";
    this.writeContract = session.def.swap?.tokenIn ?? first?.address ?? "";

    const root = el("section", "card explorer");
    root.setAttribute("aria-label", "疑似エクスプローラー");
    root.append(text("h2", "疑似エクスプローラー（練習用）", "explorer-title"));

    const tabs = el("div", "explorer-tabs");
    const readPanel = el("div", "explorer-panel");
    const writePanel = el("div", "explorer-panel");
    const readTab = document.createElement("button");
    readTab.type = "button";
    readTab.className = "tab-button is-active";
    readTab.textContent = "Read Contract";
    const writeTab = document.createElement("button");
    writeTab.type = "button";
    writeTab.className = "tab-button";
    writeTab.textContent = "Write Contract";
    const showTab = (which: "read" | "write") => {
      readTab.classList.toggle("is-active", which === "read");
      writeTab.classList.toggle("is-active", which === "write");
      readPanel.hidden = which !== "read";
      writePanel.hidden = which !== "write";
    };
    readTab.addEventListener("click", () => showTab("read"));
    writeTab.addEventListener("click", () => showTab("write"));
    tabs.append(readTab, writeTab);
    root.append(tabs);

    readPanel.append(this.buildReadPanel());
    writePanel.append(this.buildWritePanel());
    writePanel.hidden = true;
    root.append(readPanel, writePanel);

    // S-07 結果／ログ
    const resultSection = el("section", "result-panel");
    resultSection.append(text("h3", "結果とログ"));
    this.latestBox = el("div", "latest-result");
    resultSection.append(this.latestBox);
    const filterRow = el("div", "log-filters");
    const filters: { key: "all" | "tx" | "call"; label: string }[] = [
      { key: "all", label: "すべて" },
      { key: "tx", label: "Write（txログ）" },
      { key: "call", label: "Read（callログ）" },
    ];
    for (const filter of filters) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `btn btn-quiet btn-small${this.logFilter === filter.key ? " is-active" : ""}`;
      btn.textContent = filter.label;
      btn.addEventListener("click", () => {
        this.logFilter = filter.key;
        for (const other of filterRow.querySelectorAll("button")) other.classList.remove("is-active");
        btn.classList.add("is-active");
        this.refreshLogs();
      });
      filterRow.append(btn);
    }
    resultSection.append(filterRow);
    this.logsBox = el("div", "logs-box");
    resultSection.append(this.logsBox);
    resultSection.append(
      text("p", "ログは改変・削除できません（課題リセットでのみ初期化されます）。", "note"),
    );
    root.append(resultSection);

    this.element = root;
    this.refreshDynamic();
  }

  /** 操作後に結果カードとログを最新化する */
  refreshDynamic(): void {
    this.refreshLatest();
    this.refreshLogs();
  }

  // --- S-05 Read ---

  private contractOptions(): { value: Address; label: string }[] {
    return this.session.def.contracts.map((c) => ({
      value: c.address,
      label: `${c.label}（${c.symbol}）`,
    }));
  }

  private addressOptions(includeZero: boolean): { value: string; label: string }[] {
    const options: { value: string; label: string }[] = [
      { value: this.session.userAddress, label: "あなたの練習用ウォレット" },
    ];
    for (const [key, address] of Object.entries(this.session.def.initialState.spenderAddresses)) {
      options.push({
        value: address,
        label: key === "dex" ? "練習用DEX（疑似）" : "練習用スペンダー",
      });
    }
    for (const contract of this.session.def.contracts) {
      options.push({ value: contract.address, label: `${contract.label}のコントラクト` });
    }
    if (includeZero) options.push({ value: ZERO_ADDRESS, label: "ゼロアドレス（revertの体験用）" });
    return options;
  }

  private addressSelect(
    options: { value: string; label: string }[],
    defaultValue: string,
  ): HTMLSelectElement {
    const select = document.createElement("select");
    select.className = "input-select";
    for (const option of options) {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = `${option.label}：${pseudoAddressShort(option.value)}`;
      select.append(node);
    }
    select.value = defaultValue;
    return select;
  }

  private buildReadPanel(): HTMLElement {
    const panel = el("div");
    panel.append(text("h3", "Read Contract（読み取り）"));
    panel.append(
      text(
        "p",
        "Readは状態を変えず、ガスもトランザクションも発生しません。成功したReadはcallログに記録され、採点の証拠になります。",
        "note",
      ),
    );

    // コントラクト選択とヘッダー
    const header = el("div", "contract-header");
    const options = this.contractOptions();
    if (options.length > 1) {
      const label = el("label", "field-label", ["対象コントラクト"]);
      const select = this.addressSelect(
        options.map((o) => ({ value: o.value, label: o.label })),
        this.readContract,
      );
      select.addEventListener("change", () => {
        this.readContract = select.value;
        headerInfo.replaceChildren(...this.contractHeaderNodes());
        for (const container of panel.querySelectorAll<HTMLElement>(".read-results")) {
          const key = container.dataset["key"] ?? "";
          container.replaceChildren(...this.resultLines(key));
        }
      });
      label.append(select);
      panel.append(label);
    }
    const headerInfo = el("div");
    headerInfo.append(...this.contractHeaderNodes());
    header.append(headerInfo);
    panel.append(header);

    // 関数一覧（アコーディオン）
    const list = el("div", "function-list");
    READ_FUNCTIONS.forEach((fn, index) => {
      list.append(this.buildReadFunction(fn, index === 2));
    });
    panel.append(list);
    return panel;
  }

  private contractHeaderNodes(): Node[] {
    const contract = this.session.def.contracts.find((c) => c.address === this.readContract);
    if (!contract) return [text("p", "コントラクトが見つかりません")];
    return [
      text("p", `練習用コントラクト：${contract.name}（${contract.symbol}）`, "contract-name"),
      el("p", undefined, [el("code", undefined, [`疑似 ${contract.address}（架空）`])]),
    ];
  }

  private resultLines(key: string): Node[] {
    const lines = this.readResults.get(key) ?? [];
    if (lines.length === 0) return [text("p", "まだ結果がありません", "note")];
    return lines.map((line) => text("p", line, "read-result-line"));
  }

  private buildReadFunction(
    fn: (typeof READ_FUNCTIONS)[number],
    expandedByDefault: boolean,
  ): HTMLElement {
    const defFn = this.session.def.functions.find((f) => f.name === fn.name && f.kind === "read");
    const item = el("div", "function-item");
    const headerButton = document.createElement("button");
    headerButton.type = "button";
    headerButton.className = "function-header";
    headerButton.textContent = fn.signature;
    const body = el("div", "function-body");
    body.hidden = !expandedByDefault;
    headerButton.addEventListener("click", () => {
      body.hidden = !body.hidden;
    });
    item.append(headerButton);

    body.append(text("p", defFn?.description ?? fn.fallbackDescription, "function-desc"));

    const selects = new Map<string, HTMLSelectElement>();
    if (fn.name === "balanceOf") {
      const label = el("label", "field-label", ["account（残高を調べるアドレス）"]);
      const select = this.addressSelect(this.addressOptions(false), this.session.userAddress);
      selects.set("account", select);
      label.append(select);
      body.append(label);
    }
    if (fn.name === "allowance") {
      const spenders = Object.values(this.session.def.initialState.spenderAddresses);
      const ownerLabel = el("label", "field-label", ["owner（承認した人）"]);
      const ownerSelect = this.addressSelect(this.addressOptions(false), this.session.userAddress);
      selects.set("owner", ownerSelect);
      ownerLabel.append(ownerSelect);
      const spenderLabel = el("label", "field-label", ["spender（承認された相手）"]);
      const spenderSelect = this.addressSelect(
        this.addressOptions(false),
        spenders[0] ?? this.session.userAddress,
      );
      selects.set("spender", spenderSelect);
      spenderLabel.append(spenderSelect);
      body.append(ownerLabel, spenderLabel);
    }

    const resultsBox = el("div", "read-results");
    resultsBox.dataset["key"] = fn.name;
    resultsBox.append(...this.resultLines(fn.name));

    const queryButton = document.createElement("button");
    queryButton.type = "button";
    queryButton.className = "btn btn-primary";
    queryButton.textContent = "Query（読み取る）";
    queryButton.addEventListener("click", () => {
      const args: Record<string, string> = {};
      for (const [key, select] of selects) args[key] = select.value;
      const { result, ...outcome } = this.session.doRead(fn.name, this.readContract, args);
      if (result.ok) {
        const line = this.formatReadResult(fn.name, result.valueDisplay, result.record);
        const lines = this.readResults.get(fn.name) ?? [];
        lines.unshift(line);
        this.readResults.set(fn.name, lines.slice(0, 5));
        resultsBox.replaceChildren(...this.resultLines(fn.name));
      } else {
        showToast(`${result.message}。入力を確かめてみよう。`);
      }
      this.refreshDynamic();
      this.callbacks.onAction(outcome);
    });
    body.append(queryButton, resultsBox);
    item.append(body);
    return item;
  }

  private formatReadResult(functionName: string, valueDisplay: string, record: CallRecord): string {
    const token = this.session.state.tokens[record.contract];
    if (!token) return `${functionName} → ${valueDisplay}`;
    if (functionName === "name" || functionName === "symbol" || functionName === "decimals") {
      return `${functionName} → ${valueDisplay}`;
    }
    return `${functionName} → ${amountTriple(BigInt(record.returnValueRaw || "0"), token.decimals, token.symbol)}`;
  }

  // --- S-06 Write ---

  private buildWritePanel(): HTMLElement {
    const panel = el("div");
    panel.append(text("h3", "Write Contract（書き込み）"));
    panel.append(
      text("p", "疑似ウォレットは常に接続済みです（練習用）。送信前には必ず確認モーダルが出ます。", "note"),
    );
    const writeFns = this.session.def.functions.filter((f) => f.kind === "write");
    if (writeFns.length === 0) {
      panel.append(text("p", "この課題では書き込み（Write）は使いません。Readで読み解く課題だよ。"));
      return panel;
    }
    if (this.session.def.contracts.length > 1) {
      const label = el("label", "field-label", ["approve / transfer の対象コントラクト"]);
      const select = this.addressSelect(
        this.contractOptions().map((o) => ({ value: o.value, label: o.label })),
        this.writeContract,
      );
      select.addEventListener("change", () => {
        this.writeContract = select.value;
      });
      label.append(select);
      panel.append(label);
    }
    for (const fn of writeFns) panel.append(this.buildWriteFunction(fn));
    return panel;
  }

  private buildWriteFunction(fn: FunctionDefinition): HTMLElement {
    const item = el("div", "function-item");
    const title = el("h4", "function-name", [`${fn.name}（${fn.inputs.map((i) => `${i.type} ${i.name}`).join(", ")}）`]);
    item.append(title);
    item.append(text("p", fn.description, "function-desc"));
    if (fn.revertReasons && fn.revertReasons.length > 0) {
      const reasons = el("ul", "revert-reasons");
      for (const reason of fn.revertReasons) {
        reasons.append(el("li", undefined, [`止まる場合：${reason.message}`]));
      }
      item.append(reasons);
    }

    const errorBox = el("p", "form-error");
    errorBox.hidden = true;
    const isSwap = fn.name === "swapExactUSDCForTKN";
    // 対象コントラクトの切替に追従するため、decimals / symbol は都度引く
    const amountSpec = (): { decimals: number; symbol: string } => {
      const address = isSwap ? (this.session.def.swap?.tokenIn ?? "") : this.writeContract;
      const token = this.session.state.tokens[address];
      return { decimals: token?.decimals ?? 18, symbol: token?.symbol ?? "" };
    };

    const addressSelects = new Map<string, HTMLSelectElement>();
    for (const input of fn.inputs) {
      if (input.type === "address") {
        const label = el("label", "field-label", [`${input.name}（${input.description}）`]);
        const options = this.addressOptions(true);
        const spenders = Object.values(this.session.def.initialState.spenderAddresses);
        const defaultValue =
          input.name === "spender" ? (spenders[0] ?? this.session.userAddress) : this.session.userAddress;
        const select = this.addressSelect(options, defaultValue);
        addressSelects.set(input.name, select);
        label.append(select);
        item.append(label);
      }
    }

    let amountInput: HTMLInputElement | null = null;
    let previewLine: HTMLElement | null = null;
    const amountArg = fn.inputs.find((i) => i.type === "uint256");
    if (amountArg) {
      const label = el("label", "field-label", [
        `${amountArg.name}（${amountArg.description}）`,
      ]);
      amountInput = document.createElement("input");
      amountInput.type = "text";
      amountInput.inputMode = "decimal";
      amountInput.className = "input-text";
      amountInput.placeholder = "例：10";
      label.append(amountInput);
      item.append(label);
      previewLine = text("p", "数量を入れると、raw値への換算プレビューが出ます。", "note");
      item.append(previewLine);
      const updatePreview = () => {
        if (!amountInput || !previewLine) return;
        const { decimals, symbol } = amountSpec();
        const value = amountInput.value.trim();
        if (value === "") {
          previewLine.textContent = "数量を入れると、raw値への換算プレビューが出ます。";
          return;
        }
        const checked = validateAmountInput(value, decimals);
        previewLine.textContent = checked.ok
          ? `換算プレビュー：${value} ${symbol} ＝ raw ${checked.value.toString()}（decimals ${decimals}）`
          : checked.message;
      };
      amountInput.addEventListener("input", updatePreview);
      if (fn.name === "approve") {
        const maxButton = document.createElement("button");
        maxButton.type = "button";
        maxButton.className = "btn btn-quiet btn-small";
        maxButton.textContent = "実験：無制限の量を入力してみる（注意）";
        maxButton.addEventListener("click", () => {
          if (amountInput) {
            amountInput.value = formatUnits(MAX_UINT256, amountSpec().decimals);
            updatePreview();
          }
        });
        item.append(maxButton);
      }
    }

    const writeButton = document.createElement("button");
    writeButton.type = "button";
    writeButton.className = "btn btn-primary";
    writeButton.textContent = "Write（送信前の確認へ）";
    writeButton.addEventListener("click", () => {
      errorBox.hidden = true;
      this.startWrite(fn, addressSelects, amountInput, errorBox);
    });
    item.append(writeButton, errorBox);
    return item;
  }

  private startWrite(
    fn: FunctionDefinition,
    addressSelects: Map<string, HTMLSelectElement>,
    amountInput: HTMLInputElement | null,
    errorBox: HTMLElement,
  ): void {
    const showError = (message: string) => {
      errorBox.textContent = message;
      errorBox.hidden = false;
    };
    const isSwap = fn.name === "swapExactUSDCForTKN";
    const amountDecimals = isSwap
      ? (this.session.state.tokens[this.session.def.swap?.tokenIn ?? ""]?.decimals ?? 18)
      : (this.session.state.tokens[this.writeContract]?.decimals ?? 18);
    const args: Record<string, string> = {};
    let contract: Address = this.writeContract;

    for (const input of fn.inputs) {
      if (input.type === "address") {
        const select = addressSelects.get(input.name);
        const checked = validateAddressInput(select?.value ?? "");
        if (!checked.ok) {
          showError(checked.message);
          return;
        }
        args[input.name] = checked.value;
      }
    }
    const amountArg = fn.inputs.find((i) => i.type === "uint256");
    if (amountArg) {
      const checked = validateAmountInput(amountInput?.value ?? "", amountDecimals);
      if (!checked.ok) {
        showError(checked.message);
        return;
      }
      args[`${amountArg.name}Raw`] = checked.value.toString();
    }
    if (isSwap) {
      contract = this.session.engine.config.swap?.dexAddress ?? contract;
    }

    const engineName = fn.name as WriteFunctionName;
    const request = this.session.requestWrite(engineName, contract, args);
    if (request.kind === "blocked") {
      openModal({
        title: "この操作は送信できません",
        body: el("div", undefined, [
          text("p", request.action.description),
          text("p", "別の数量や宛先で試してみよう。"),
        ]),
        actions: [{ label: "とじる", kind: "primary" }],
      });
      return;
    }
    const preview = request.preview;
    const body = this.previewBody(fn, args, preview);
    if (request.kind === "warn") {
      openModal({
        title: "ちょっと待って、確認してね",
        body: el("div", undefined, [
          text("p", request.action.description, "warn-text"),
          text("p", "このまま送信すると、この試行では合格できなくなるよ。リセットすれば、もう一度挑戦できるよ。"),
          body,
        ]),
        actions: [
          { label: "やめておく", kind: "quiet" },
          {
            label: "それでも送信する",
            kind: "primary",
            onClick: () => this.executeWrite(engineName, contract, args),
          },
        ],
      });
      return;
    }
    openModal({
      title: "送信前の確認（疑似）",
      body,
      actions: [
        { label: "キャンセル", kind: "quiet" },
        {
          label: "送信する（疑似）",
          kind: "primary",
          onClick: () => this.executeWrite(engineName, contract, args),
        },
      ],
    });
  }

  private previewBody(fn: FunctionDefinition, args: Record<string, string>, preview: WritePreview): HTMLElement {
    const body = el("div", "preview-body");
    const list = el("dl", "preview-list");
    const add = (label: string, value: string) => {
      list.append(el("dt", undefined, [label]), el("dd", undefined, [value]));
    };
    add("関数", fn.name);
    for (const [key, value] of Object.entries(args)) {
      add(key, value.length === 42 && value.startsWith("0x") ? pseudoAddressShort(value) : value);
    }
    add("想定ガス（疑似値）", `${preview.gasUsed.toLocaleString()} × ${preview.gasPriceGwei} Gwei ＝ ${preview.gasFeeEth} ETH`);
    body.append(list);
    if (preview.diffs.length > 0) {
      body.append(text("h4", "状態変化の予測"));
      const diffList = el("ul", "diff-list");
      for (const diff of preview.diffs) {
        diffList.append(el("li", undefined, [`${diff.label}：${diff.before} → ${diff.after}`]));
      }
      body.append(diffList);
    }
    body.append(text("p", "これは疑似環境の送信です。実チェーンには送信されません。", "note"));
    return body;
  }

  private executeWrite(functionName: WriteFunctionName, contract: Address, args: Record<string, string>): void {
    const { result, ...outcome } = this.session.executeWrite(functionName, contract, args);
    if (result.kind === "preflight-failure") {
      showToast(result.message);
    }
    this.refreshDynamic();
    this.callbacks.onAction(outcome);
  }

  // --- S-07 結果とログ ---

  private refreshLatest(): void {
    if (!this.latestBox) return;
    const state = this.session.state;
    const box = this.latestBox;
    box.replaceChildren();
    const entries: { sequence: number; tx?: TxRecord; call?: CallRecord }[] = [
      ...state.txLog
        .filter((r) => r.attemptId === state.attemptId)
        .map((r) => ({ sequence: r.sequence, tx: r })),
      ...state.callLog
        .filter((r) => r.attemptId === state.attemptId)
        .map((r) => ({ sequence: r.sequence, call: r })),
    ].sort((a, b) => b.sequence - a.sequence);
    const latest = entries[0];
    if (!latest) {
      box.append(text("p", "まだ操作がありません。Readから始めてみよう。", "note"));
      return;
    }
    if (latest.call) {
      const record = latest.call;
      const token = state.tokens[record.contract];
      box.append(text("h4", `Read結果：${record.functionName}`));
      box.append(
        text(
          "p",
          token && record.functionName !== "name" && record.functionName !== "symbol" && record.functionName !== "decimals"
            ? amountTriple(BigInt(record.returnValueRaw || "0"), token.decimals, token.symbol)
            : `返却値：${record.returnValueDisplay}`,
        ),
      );
      return;
    }
    const record = latest.tx as TxRecord;
    const card = el("div", `result-card ${record.status === 1 ? "is-success" : "is-revert"}`);
    card.append(
      text(
        "h4",
        record.status === 1
          ? `成功（status=1）：${record.functionName}`
          : `revert（status=0）：${record.functionName} ― コントラクトが止めてくれたサイン`,
      ),
    );
    const list = el("dl", "preview-list");
    const add = (label: string, value: string) => {
      list.append(el("dt", undefined, [label]), el("dd", undefined, [value]));
    };
    add("疑似ハッシュ", `${record.pseudoHash}（疑似ハッシュ・実ハッシュではありません）`);
    add("疑似ブロック", `疑似ブロック ${record.blockNumber}`);
    add("ガス使用量（疑似値）", `${record.gasUsed.toLocaleString()}（手数料 ${formatUnits(BigInt(record.gasFeeWei), 18)} ETH）`);
    card.append(list);
    if (record.status === 0 && record.revertReason) {
      const message = this.revertMessageFor(record.functionName, record.revertReason);
      card.append(text("p", `理由：${message}`, "revert-reason"));
      card.append(text("p", `理由コード（原文・疑似）：${record.revertReason}`, "note"));
      card.append(...this.revertQuizNodes(record));
    }
    if (record.stateDiff.length > 0) {
      const diffList = el("ul", "diff-list");
      for (const diff of record.stateDiff) {
        diffList.append(el("li", undefined, [this.describeDiff(diff)]));
      }
      card.append(text("h4", "状態の変化"), diffList);
    }
    box.append(card);
  }

  private describeDiff(diff: TxRecord["stateDiff"][number]): string {
    const state = this.session.state;
    if (diff.kind === "eth") {
      return `疑似ETH：${formatUnits(BigInt(diff.beforeRaw), 18)} ETH → ${formatUnits(BigInt(diff.afterRaw), 18)} ETH（ガス代）`;
    }
    const token = diff.token ? state.tokens[diff.token] : undefined;
    if (!token) return `${diff.beforeRaw} → ${diff.afterRaw}`;
    if (diff.kind === "allowance") {
      return `allowance（${token.symbol}）：${amountTriple(BigInt(diff.beforeRaw), token.decimals, token.symbol)} → ${amountTriple(BigInt(diff.afterRaw), token.decimals, token.symbol)}`;
    }
    const who = diff.account === this.session.userAddress ? "あなた" : pseudoAddressShort(diff.account ?? "");
    return `${token.symbol}残高（${who}）：${amountTriple(BigInt(diff.beforeRaw), token.decimals, token.symbol)} → ${amountTriple(BigInt(diff.afterRaw), token.decimals, token.symbol)}`;
  }

  private revertMessageFor(functionName: string, code: string): string {
    const defFn = this.session.def.functions.find((f) => f.name === functionName);
    const fromDef = defFn?.revertReasons?.find((r) => r.code === code)?.message;
    if (fromDef) return fromDef;
    return revertMessage(code as RevertCode);
  }

  private revertQuizNodes(record: TxRecord): Node[] {
    const defFn = this.session.def.functions.find((f) => f.name === record.functionName);
    const reasons = defFn?.revertReasons ?? [];
    if (reasons.length === 0) return [];
    const key = `${record.attemptId}:${record.functionName}:${record.id}`;
    if (this.revertQuizDone.has(key)) {
      return [text("p", "理由の読み解きはバッチリだね！", "quiz-ok")];
    }
    const wrap = el("div", "revert-quiz");
    wrap.append(text("p", "どうして止まったと思う？理由を選んでみよう。"));
    const feedback = el("p", "quiz-feedback");
    feedback.hidden = true;
    for (const reason of reasons) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-default btn-small";
      btn.textContent = `${reason.code}：${reason.message}`;
      btn.addEventListener("click", () => {
        const answer = this.session.answerRevertQuiz(record.functionName, reason.code);
        feedback.hidden = false;
        if (answer.correct) {
          this.revertQuizDone.add(key);
          feedback.textContent = answer.awardedBadge
            ? "そのとおり！バッジ「リバート読み解き」を獲得したよ！"
            : "そのとおり！理由を読み解けたね。";
          feedback.className = "quiz-feedback quiz-ok";
          this.callbacks.onProgressChanged();
          this.refreshLatest();
        } else {
          feedback.textContent = "おしい！理由の表示をもう一度読んでみよう。";
          feedback.className = "quiz-feedback quiz-ng";
        }
      });
      wrap.append(btn);
    }
    wrap.append(feedback);
    return [wrap];
  }

  private refreshLogs(): void {
    if (!this.logsBox) return;
    const state = this.session.state;
    const box = this.logsBox;
    box.replaceChildren();
    type Row = { sequence: number; node: HTMLElement };
    const rows: Row[] = [];
    if (this.logFilter !== "call") {
      for (const record of state.txLog.filter((r) => r.attemptId === state.attemptId)) {
        rows.push({
          sequence: record.sequence,
          node: el("li", "log-row", [
            el("code", undefined, [`${record.id}（疑似ハッシュ）`]),
            ` ${record.functionName} `,
            el("span", record.status === 1 ? "log-status ok" : "log-status revert", [
              record.status === 1 ? "成功" : "revert",
            ]),
            ` 疑似ブロック ${record.blockNumber} ・ ガス ${record.gasUsed.toLocaleString()}（疑似値）`,
          ]),
        });
      }
    }
    if (this.logFilter !== "tx") {
      for (const record of state.callLog.filter((r) => r.attemptId === state.attemptId)) {
        rows.push({
          sequence: record.sequence,
          node: el("li", "log-row", [
            el("code", undefined, [record.id]),
            ` ${record.functionName} → ${record.returnValueDisplay}`,
          ]),
        });
      }
    }
    rows.sort((a, b) => b.sequence - a.sequence);
    if (rows.length === 0) {
      box.append(text("p", "まだログがありません", "note"));
      return;
    }
    const list = el("ul", "logs-list");
    for (const row of rows) list.append(row.node);
    box.append(list);
  }
}
