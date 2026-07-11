# ADR-004: Transcript Provider

- Status: Accepted（Premiere Transcript JSON Schemaの実機検証は未了）
- Date: 2026-07-11

## Decision

1. `TranscriptProvider` 抽象に対し `PremiereTranscriptProvider` と
   `WhisperCppTranscriptProvider` を実装。
2. 優先順位（フィラーON時のみ動作）:
   1. Premiere既存文字起こしで正確な単語時刻が取れる → 使用
   2. 単語時刻不足 → ローカルwhisper.cpp
   3. Whisperモデル未設定 → フィラー解析のみスキップ（無音処理は継続、日本語で通知）
3. Premiere Transcript JSONのSchemaは推測で固定しない。パーサは
   「複数の候補形状を試し、単語時刻の有無を判定する」防御的実装とし、
   実機で取得したJSONを `docs/transcript-format-notes.md` へ記録してから確定する。
4. Segment時刻しか無い場合: 文字数比率での時刻推定禁止 / Segment全削除禁止 /
   自動選択禁止。Whisperへフォールバック、不可なら参考候補（selected=false, warning付き）。
5. Whisper Timestampは絶対視せず、境界補正（エネルギー+VAD確認）を必ず通す。
6. フィラーOFF時はProviderの `isAvailable` すら呼ばない。ユニットテストで保証。
