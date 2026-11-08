# 手順チェックリストの定義と確認

手順の表示は課題JSONの `steps` と、それに1対1で対応する `stepChecks` で定義する。
全12課題に設定済み。文章中の関数名、先頭の未完了手順、課題全体のクリア状態からは推測しない。

`stepChecks` の各要素には `condition` と、任意の `optional: true`（発展手順）がある。
`condition` は次のいずれか。

- `actionSequence`：`sequence` に指定した操作が現在の試行のログに順に存在すること。
  各操作は `functionName`、`kind`、`contract`、`args`、`status`、`returnRaw`、`revertCode` で絞れる。
  `status` 省略時は成功（1）。`revertCode` は失敗Write（0）だけに指定する。
  `user` や `spenderAddresses` のキーは既存の象徴名解決を使う。
- `quizCorrect`：`questionId` で指定したそのクイズに正解していること。
- `op: and / or`：`conditions` を組み合わせる。複数の残高Readを要求するなら `and` を使う。

送信後のReadには、対象Write→Readの `actionSequence` を使う。
複数のReadを順不同にしたい場合は、それぞれのWrite→Readを `and` で束ねる。
これにより、初回のallowance 0を「解除後のallowance 0」の確認として扱わない。
同じ操作でも数量・宛先・revert理由が異なれば別の証跡として扱う。

`stepChecks` の欠落、`steps` との件数不一致、未知の条件・キー、不正な型はローダーで拒否する。
チェック状態は保存ログから毎回導出し、リロードで復元、課題リセットで初期化する。
合否判定の `passCondition`、XP付与、禁止操作ゲート、保存状態のスキーマは変更していない。
そのため、既存の合格条件を満たしても、まだ行っていないReadは未チェックのままになる。

## 課題11の回帰確認

`npm run build` → `npm run preview` で本番ビルドを開く。
進捗のないブラウザで課題一覧から課題11へ進み、以下を実行する。

| 操作直後 | 手順1 | 手順2 | 手順3 | 手順4 | 手順5 |
| --- | --- | --- | --- | --- | --- |
| 初期状態 | — | — | — | — | — |
| allowance：owner＝友人、spender＝あなた、結果100 | ✓ | — | — | — | — |
| transferFrom：友人→あなた、101 USDC、承認不足revert | ✓ | ✓ | — | — | — |
| 同じ宛先で80 USDC、残高不足revert | ✓ | ✓ | ✓ | — | — |
| 同じ宛先で20 USDC、成功 | ✓ | ✓ | ✓ | ✓ | — |
| 同じallowanceをRead、結果80 | ✓ | ✓ | ✓ | ✓ | — |
| あなたのbalanceOfをRead、結果20 | ✓ | ✓ | ✓ | ✓ | — |
| 友人のbalanceOfをRead、結果40 | ✓ | ✓ | ✓ | ✓ | ✓ |

最後の3つのReadの順序は任意。
既存の合否判定はallowanceの最終Read時点でクリアするが、手順5には両者の残高Readも必要。
別の新規セッションで20 USDCの成功だけを実行した場合は手順4だけにチェックが付く。

101・80 USDCの送信確認モーダルには、トークン残高・allowanceが変わらずガス代のみ消費する旨を表示する。
友人 −41 USDC、allowance −1 USDCのような成功を仮定した予測は表示しない。
20 USDCの成功予測は従来どおり友人40、あなた20、allowance80を表示する。

## 検証結果

- `npm test`：既存131件＋新規26件、計157件成功。
- `npm run build`：TypeScript検証・本番ビルド成功。
- Chromium + Playwrightで本番ビルドを操作し、上記の全タイミングを確認。
  101・80のモーダル、成功のみの別セッション、リロード後のチェック復元も確認。実行時エラーなし。
