# 直コン練習サイト（疑似シミュレーター）

『直コン徹底解説本（仮題）』（KDP）連動の練習サイトです。ブロックエクスプローラーからスマートコントラクトを直接読む・書く操作を、**実チェーンに一切接続しない**疑似環境で練習できます。

設計の正本は `~/workspace/goals/goal-14/files/基本設計-練習サイト試作-v1.1-Claude.md`（基本設計書 v1.1）です。

## 開発

```sh
npm install
npm run dev      # 開発サーバー
npm test         # Vitest 単体テスト
npm run build    # 型チェック + 本番ビルド（dist/）
```

公開は GitHub Pages です。`main` ブランチへ push すると GitHub Actions（`.github/workflows/deploy.yml`）がテスト→ビルド→デプロイを自動実行します。画面遷移はハッシュ遷移（`#/challenge/01` 等）です。

## 絶対に守ること（設計書 0.5.1 禁止リスト）

- 実ウォレット接続を実装しない（`window.ethereum` の検出・参照・接続要求を含む一切の処理を書かない）
- 秘密鍵・ニーモニック・パスワードの入力欄を設けない
- 実RPCへの接続をしない。疑似エンジンはローカルの状態操作のみ
- 実アドレスへの送金につながる導線を作らない
- 外部スクリプト・外部フォント・外部アナリティクスを読み込まない（外部通信は自サイトの静的資産のみ）
- ethers 等の実チェーン接続ライブラリを依存関係に入れない
- 課題JSONのテキストは `textContent` で描画する（`innerHTML` / `eval` 禁止）

## 構成

| パス | 内容 |
|---|---|
| `index.html` | 骨格（CSP・共通ヘッダー・安全バナー・フッター） |
| `styles/main.css` | CSSテーマ（カスタムプロパティ） |
| `src/main.ts` | ハッシュルーター骨格と画面の仮描画 |
| `src/engine/` | 疑似実行エンジン（状態モデル・換算・実行・入力検証） |
| `src/store/` | 進捗ストア（localStorage）。スキーマと復旧ルールは `docs/progress-store.md` |
| `data/challenges/` | 課題JSON（01〜03）と一覧 `index.json`、バッジ定義 `badges.json` |
| `tests/` | Vitest 単体テスト |
