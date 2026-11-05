// 直コン練習サイト エントリーポイント
//
// 画面遷移はハッシュ遷移（#/challenge/01 等）に統一する（GitHub Pages の404問題回避、
// 設計書 5.3 フェーズ0 決定事項）。動的テキストは textContent で描画し、
// 課題JSON等を innerHTML で描画しない（設計書 0.5.3）。
// 課題データは data/ のJSONをビルド時に取り込み、ローダーで検証してから使う。
import "../styles/main.css";
import { getLoadedData } from "./data/bundled";
import { updateHeaderProgress } from "./ui/dom";
import { renderTop, renderChallenges, renderHelp } from "./ui/pages";
import { renderDashboard } from "./ui/dashboard";
import { renderPlay } from "./ui/play";

interface Route {
  view: "top" | "dashboard" | "challenges" | "challenge" | "help";
  challengeId?: string;
}

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  const challengeMatch = path.match(/^\/challenge\/([0-9]+)$/);
  if (challengeMatch) {
    return { view: "challenge", challengeId: challengeMatch[1] };
  }
  switch (path) {
    case "/dashboard":
      return { view: "dashboard" };
    case "/challenges":
      return { view: "challenges" };
    case "/help":
      return { view: "help" };
    default:
      return { view: "top" };
  }
}

function render(route: Route): void {
  const app = document.getElementById("app");
  if (!app) return;
  const data = getLoadedData();
  switch (route.view) {
    case "top":
      renderTop(app, data);
      break;
    case "dashboard":
      renderDashboard(app, data);
      break;
    case "challenges":
      renderChallenges(app, data);
      break;
    case "challenge":
      renderPlay(app, data, route.challengeId ?? "");
      break;
    case "help":
      renderHelp(app);
      break;
  }
  updateHeaderProgress(data);
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function onRouteChange(): void {
  render(parseRoute(window.location.hash));
}

window.addEventListener("hashchange", onRouteChange);
onRouteChange();
