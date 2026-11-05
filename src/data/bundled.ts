// ビルド時に同梱される課題データの入口。
// data/ 配下のJSONは Vite が静的資産として取り込む（実行時の外部通信は発生しない。設計書 0.5.3）。
// 課題の追加は「data/challenges/ にJSONを1件追加し、index.json に載せる」だけでよい。
import { buildLoadedData, reportLoadedDataProblems, type LoadedData } from "./loader";

const challengeModules = import.meta.glob("../../data/challenges/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const indexModule = import.meta.glob("../../data/challenges/index.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const badgesModule = import.meta.glob("../../data/badges.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

function fileNameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

let cached: LoadedData | null = null;

export function getLoadedData(): LoadedData {
  if (cached) return cached;
  const challengeFiles: Record<string, unknown> = {};
  let indexRaw: unknown;
  for (const [path, value] of Object.entries(challengeModules)) {
    const name = fileNameOf(path);
    if (name === "index.json") {
      indexRaw = value;
    } else {
      challengeFiles[name] = value;
    }
  }
  if (indexRaw === undefined) {
    for (const value of Object.values(indexModule)) indexRaw = value;
  }
  let badgesRaw: unknown;
  for (const value of Object.values(badgesModule)) badgesRaw = value;

  cached = buildLoadedData({ challengeFiles, indexRaw, badgesRaw });
  reportLoadedDataProblems(cached);
  return cached;
}
