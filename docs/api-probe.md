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

## 変更系: 実機実行済み（2026-07-12 / 2回目の実行で大半確定）

| API | 実機で確認した挙動 |
|---|---|
| sequence.createCloneAction | ✅ lockedAccess内でAction生成→executeTransactionで成功。GUID差分で複製1件を特定 |
| SequenceEditor.createCloneTrackItemAction(isInsert=false) | ✅ 新規Video 1件。**リンクAudioは複製されない**（audioAdded=0）→ V/Aは別々にClone |
| timeOffset引数 | 相対オフセット。着地位置は概ね元start+offset（微小なフレームスナップあり得る。再スキャンで実位置を取得すべき） |
| trackItem.createMoveAction | **相対オフセット**（現在位置+指定tick）。絶対位置ではない |
| trackItem.createSetInPointAction | **末尾(end)固定で先頭をトリム**: inを+Δするとstartも+Δ、endは不変 |
| SequenceEditor.createRemoveItemsAction | mediaType=undefinedは "Illegal Parameter type"。引数バリエーション探索中（Probe更新済み） |
| project.deleteSequence | ✅ true |
| 元シーケンス不変検証 | ✅ 2回とも不変 |

### 実機知見（重要）
- **trackItem.getSpeed()は倍率を返す**: 100%速度のクリップで1.0（パーセントではない）。
  Phase 3実証の初回実行で「speed=1%」誤判定として検出（uxpTimeline.tsで×100変換）
- awaitを挟んで保持したDOMオブジェクトは "The script object is no longer valid." で失効する
  → **各Mutationの直前にGUID/再スキャンで取り直す**（仕様20章の実証）
- Action生成は project.lockedAccess() 内で行う

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
