# ADR-003: タイムライン再構築戦略

- Status: **Proposed**（API Probe結果で確定）
- Date: 2026-07-11

## Context

Razor/Split APIの存在を仮定しない（仕様19）。削除対象の逆集合 = Keep Segment を生成し、
それをタイムラインへ再配置する。候補は仕様19の戦略A/B/C。

## Decision（暫定）

**戦略A（TrackItem Clone, `isInsert=false` 固定）を第一候補**として実装する。
公式ドキュメントで `createCloneTrackItemAction`（insert/overwrite指定・
オフセット指定でトラックへ複製）の存在を確認済み（REFERENCES.md参照）。

確定前にAPI Probeで必ず確認する項目:
- Video Clone時にリンクAudioも複製されるか（二重Clone防止）
- Clone後の新規TrackItem特定方法（複製前後のTrackItem差分で特定。推測特定禁止）
- In/Out変更Action・Move Action・削除Actionの実在と挙動
- Link状態の維持、Move/In/Out変更の連動

不成立時は戦略B（Subclip + 専用Bin「KazuCut Generated」+ Overwrite配置）、
それも不成立なら戦略C（解析専用: 候補UI+Marker+JSON出力まで。
自動編集は完成と報告せず BLOCKING_REPORT.md へ記載）。

## 共通設計

- Panel側は `TimelineRebuilder` 抽象 + `cloneRebuildStrategy` / `subclipRebuildStrategy`
- 一時領域: 対象トラック末尾（シーケンス最終端+マージン）。空であることを事前検証
- 各Mutation後にDOM再取得。古い参照の再利用禁止
- 適用後: A/V同期検証（映像1フレーム未満）+ 対象外トラックSnapshot比較。
  不一致は SYNC_VALIDATION_FAILED / NON_TARGET_TRACK_CHANGED で失敗扱い
