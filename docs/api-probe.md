# API Probe結果

**未実施**（Premiere 26.3.0実機が必要。パネルの「API Probe実行」で実行し、
`plugin-data:/diagnostics/api-probe.json` の内容をここへ転記する）。

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
