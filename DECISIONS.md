# DECISIONS

意思決定の時系列ログ。詳細は `docs/adr/` の各ADRを参照。

## 2026-07-11

- **D-001**: 開発環境がLinuxコンテナ（Windows/Premiere/Hybrid SDKなし）のため、
  仕様書13章の「SDKなし」方針を全面適用。移植可能コードはLinuxで実装・テスト、
  Windows専用部はソース+CMake完成+未検証明記とする。→ PLAN.md
- **D-002**: プロセスアーキテクチャは「外部Worker（ジョブ1件=プロセス1件）」を
  第一候補として実装するが、実機検証まで**正式採用しない**。→ ADR-001（Proposed）
- **D-003**: 音声デコードはIAudioDecoder抽象 + MediaFoundationAudioDecoder(Windows) +
  WavFileDecoder(portable, テスト用)。FFmpegは初期版非必須。→ ADR-002
- **D-004**: タイムライン再構築は戦略A(TrackItem Clone, isInsert=false)を第一候補、
  B(Subclip)、C(解析専用)の順でフォールバック。採用はAPI Probe結果待ち。→ ADR-003
- **D-005**: TranscriptProviderはPremiere優先→whisper.cppフォールバック。
  Segment時刻のみの場合は自動選択しない。→ ADR-004
- **D-006**: 対象外トラック保護はSnapshot比較方式（処理前後の全TrackItem比較）。→ ADR-005
- **D-007**: フィラー削除は初期値OFF。OFF時はTranscript/Whisper関連コードパスへ
  一切入らないことをユニットテストで保証。→ ADR-006
- **D-008**: VADはWebRTC VAD互換の自己実装（エネルギー+スペクトル特徴+ハングオーバー）
  を初期版で使用。外部依存を減らしライセンスリスクを回避。性能はtools/evaluateで
  実素材評価し、不足ならWebRTC VAD(BSD-3)のベンダリングへ切替。→ ADR-002追記
- **D-009**: C++ユニットテストはCatch2 v3（単一ヘッダamalgamated版をベンダリング、
  Boost Software License 1.0）。ネットワーク非依存でビルド可能にするため。

- **D-010**: whisper.cpp実行本体は未統合とする。Windowsビルド環境がなく検証不能なため、
  「未検証の完成報告」を避け、モデル設定時はWHISPER_FAILEDで未対応を明示（BLOCKING_REPORT 3）。
- **D-011**: uxpPremiereAdapter（実DOM操作）はAPI Probe結果を得るまで実装しない。
  Clone/削除/移動Actionの実挙動を推測でコード化しないため（ADR-003）。
  Panel側はPremiereAdapter抽象+Mockで全ロジックをテスト済み。
- **D-012**: ノイズフロア推定はp10パーセンタイル+Clamp[-85,-25]dB。
  当初のmedian-2*MAD併用案は発話優勢素材でフロアを押し上げる欠陥があり
  テストで検出したため廃止（silence_detector.cpp）。
- **D-013**: Worker引数は --job <file> / --job-stdin。stdinがIPCチャネルの場合は
  stdinクローズ=親死亡とみなし自己終了（孤児防止をJob Objectと二重化）。
