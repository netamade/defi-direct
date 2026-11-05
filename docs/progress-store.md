# 進捗ストアのスキーマと破損時復旧ルール

（フェーズ0で決定し、以降変更しない。基本設計書 v1.1 第4.6節の形式を採用。実装は `src/store/progressStore.ts`）

## 保存先

- localStorage キー：`chokukon_progress_v1`
- シミュレーション状態は進捗とは別管理とし、課題ごとに `chokukon_sim_v1_{challengeId}`（attemptId を値に含める）へ保存する（フェーズ1以降）。

## スキーマ（version 1）

```json
{
  "version": 1,
  "totalXp": 250,
  "clearedChallengeIds": ["01", "02"],
  "challengeStatus": { "01": "QUEST_CLEAR", "02": "QUEST_CLEAR", "03": "IN PROGRESS" },
  "badges": ["first-read", "approval-master"],
  "quizAnswers": { "01": { "q01-decimals": "opt-1000-usdc" } },
  "lastPlayedAt": "2026-11-05T00:00:00.000Z"
}
```

| フィールド | 型 | 意味 |
|---|---|---|
| `version` | number（=1） | スキーマバージョン。不一致時はマイグレーションを試み、不能なら既定値へフォールバック |
| `totalXp` | number | 総XP。0以上、かつ「全課題のXP合計（動的算出）」以下にクランプする |
| `clearedChallengeIds` | string[] | クリア済み課題ID。重複なし |
| `challengeStatus` | Record<string, status> | 課題ごとの状態。status は `未着手` / `IN PROGRESS` / `QUEST CLEAR` / `RETRY` のいずれか。未登録の課題は `未着手` とみなす |
| `badges` | string[] | 獲得済みバッジID。重複なし |
| `quizAnswers` | Record<challengeId, Record<questionId, string>> | クイズ回答（選択肢IDまたは正規化前の回答文字列） |
| `lastPlayedAt` | string（ISO 8601） | 最終プレイ日時 |

## XPクランプの上限（動的算出）

- 上限はハードコードした固定値にしない。`data/challenges/index.json` の各課題 `xp` の合計から算出する（試作版では 100＋150＋200＝450）。
- 読み込み時・書き込み時の両方で、`totalXp` を `[0, 合計]` の範囲にクランプする。範囲外の値は改変の可能性があるため、クランプしたうえで検証警告（`recovered` / `warnings`）を返す。

## 破損時復旧ルール

1. 読み込みは必ず `try/catch` とスキーマ検証（型・列挙値・重複の検査）を通す。検証に失敗した場合は既定値（全課題未着手・0 XP・バッジなし）で復旧し、`recovered: true` を返す。**サイト全体をクラッシュさせない。**
2. JSONとして壊れている場合も同様に既定値で復旧する。
3. `version` が現在のバージョンと異なる場合はマイグレーション関数を通す。マイグレーション不能な場合は既定値へフォールバックする（現行は version 1 のみ）。
4. 書き込み時は、直前の正常値をメモリ上に保持する。シリアライズに失敗した場合は直前の正常値を保持し続け、壊れた値を保存しない。
5. 進捗のエクスポート／インポート（JSONファイル）を提供し、ブラウザ変更・消去時の復旧手段とする（インポート時も同じ検証・クランプを通す）。
6. 改変防止のための暗号化・署名は行わない（学習サイトであり、改変自体を罰しない）。進捗データは学習の目安であり、権威ある証明ではない旨を画面にも明記する。

## XP付与ルール

- XPは初回 QUEST CLEAR 時のみ加算する（同じ課題の再クリアでは加算しない。`clearedChallengeIds` で判定）。
- バッジも重複付与しない。
