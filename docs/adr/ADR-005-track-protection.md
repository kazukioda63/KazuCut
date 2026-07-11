# ADR-005: 対象外トラック保護

- Status: Accepted
- Date: 2026-07-11

## Decision

トラックロックを安全根拠にしない。三重の防御で保証する:

1. **編集操作の限定**: タイムライン変更Actionは、UIで選択された対象V/Aトラック上の
   解決済みA/Vペアに属するTrackItemだけに発行する。対象外トラックへ触るコードパスを
   `timelineRebuilder` の外に作らない。リップルを伴うAction（`isInsert=true`等）は禁止。
2. **Snapshot比較**: 処理前に全トラックの `TrackItemSnapshot`
   （mediaType/trackIndex/projectItemId/name/start/end/in/out/speed/disabled）を取得し、
   処理後に対象外TrackItemを全項目比較。1件でも差異があれば
   `NON_TARGET_TRACK_CHANGED` として**成功扱いにしない**。
3. **出力先の隔離**: 既定は複製シーケンスへの編集。直接編集時も先にバックアップ複製を
   作成し、失敗したら開始しない（`BACKUP_SEQUENCE_FAILED`）。

比較はTick文字列の完全一致（数値化しない）。ProjectItemはID、無ければ
mediaPathHash+nameで照合。検証失敗時は元シーケンス無傷を確認し、
可能なら失敗複製シーケンスを削除する。
