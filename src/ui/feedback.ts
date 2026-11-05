// フィードバック部品：トーストとモーダル（設計書 第1節 S-08 / フィードバック文言ルール）
// 文言は学習者を責めない表現に統一する。revertは「コントラクトが止めてくれたサイン」として扱う。
import { el, text } from "./dom";

export function showToast(message: string): void {
  const region = document.getElementById("toast-region");
  if (!region) return;
  const toast = el("div", "toast", [message]);
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

export interface ModalAction {
  label: string;
  kind?: "primary" | "default" | "quiet";
  /** false を返すとモーダルを閉じない */
  onClick?: () => boolean | void;
}

export interface ModalHandle {
  close: () => void;
  body: HTMLElement;
}

/**
 * モーダルを開く。内容は呼び出し側が textContent ベースで組み立てる。
 * 背景クリックと Esc では、dismissible な場合だけ閉じる。
 */
export function openModal(options: {
  title: string;
  body: HTMLElement;
  actions: ModalAction[];
  dismissible?: boolean;
  className?: string;
  /** ボタン以外で閉じられた（Esc・背景クリック）ときに呼ばれる */
  onDismiss?: () => void;
}): ModalHandle {
  const dismissible = options.dismissible ?? true;
  const overlay = el("div", "modal-overlay");
  const dialog = el("div", `modal${options.className ? ` ${options.className}` : ""}`);
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const title = text("h2", options.title, "modal-title");
  dialog.setAttribute("aria-label", options.title);
  dialog.append(title, options.body);

  const actionsRow = el("div", "modal-actions");
  let closed = false;
  const handle: ModalHandle = {
    close: () => {
      if (closed) return;
      closed = true;
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown);
    },
    body: options.body,
  };
  for (const action of options.actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn ${action.kind === "primary" ? "btn-primary" : action.kind === "quiet" ? "btn-quiet" : "btn-default"}`;
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      const result = action.onClick?.();
      if (result !== false) handle.close();
    });
    actionsRow.append(btn);
  }
  dialog.append(actionsRow);
  overlay.append(dialog);

  const dismiss = () => {
    options.onDismiss?.();
    handle.close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && dismissible) dismiss();
  };
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay && dismissible) dismiss();
  });
  document.addEventListener("keydown", onKeyDown);
  document.body.append(overlay);
  const firstButton = actionsRow.querySelector("button");
  firstButton?.focus();
  return handle;
}

/** 確認ダイアログ（Promise版）。リセット等の確認に使う */
export function confirmDialog(options: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const body = el("div", undefined, [text("p", options.message)]);
    openModal({
      title: options.title,
      body,
      dismissible: true,
      onDismiss: () => settle(false),
      actions: [
        {
          label: options.cancelLabel ?? "やめておく",
          kind: "quiet",
          onClick: () => settle(false),
        },
        {
          label: options.confirmLabel,
          kind: "primary",
          onClick: () => settle(true),
        },
      ],
    });
  });
}
