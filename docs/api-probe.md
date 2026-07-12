# API Probe結果

## 読み取り系: 実機実行済み（2026-07-12 / Premiere Pro 26.3.0 実機）

全11項目成功。重要な確定事項:

| 項目 | 実測結果 |
|---|---|
| TickTime.createWithSeconds(1).ticks | **"254016000000"** → 仮定分解能が実機一致（constants.ts確定） |
| sequence.getPlayerPosition().ticks | 文字列で返る（例: "2890202515200"） |
| BigInt | 正常動作（9007199254740994） |
| project.lockedAccess / executeTransaction | 存在（function） |
| Project/Sequence/Track/Selection取得 | すべて成功 |

## 変更系: パネルの「変更系Probe」で複製シーケンス上にて実行（結果待ち）

観察対象: createCloneTrackItemActionのリンクAudio挙動 / createMoveActionの
絶対・相対セマンティクス / createRemoveItemsActionのripple=false挙動 /
シーケンス複製のGUID差分特定 / deleteSequence / メディアパス取得。

Probe定義: `plugin/src/premiere/apiProbe.ts`
（読み取り系11項目は自動実行、変更系10項目は専用テストシーケンスで手動実行）。

## 確定待ちの重要事項

| 項目 | 依存する実装判断 |
|---|---|
| TickTime.createWithSeconds(1).ticks の実測値 | constants.ts の仮定分解能254016000000 |
| BigInt演算の正しさ | ticks.ts のBigInt移行可否（現状は10進文字列演算で非依存） |
| createCloneAction がシーケンス複製か | sequenceCloner |
| createCloneTrackItemAction のリンクAudio挙動 | 二重Clone防止（timelineRebuilder） |
| In/Out変更・Move・削除Actionのリップル有無 | 戦略Aの成立可否（ADR-003） |
| Transcript.exportToJSON の実Schema | transcriptParser / transcript-format-notes.md |
| plugin-data:/ への書込可否 | settingsStore / ログ |

## 転記フォーマット

```json
{ "apiName": "...", "available": true, "succeeded": true,
  "observedReturnType": "...", "notes": ["..."], "error": null }
```
