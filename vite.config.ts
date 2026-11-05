/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

// GitHub Pages（プロジェクトサイト）でもパスが壊れないよう、相対ベースを使う。
// 画面遷移はハッシュ遷移（#/challenge/01 等）のため、SPAフォールバック設定は不要。
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
