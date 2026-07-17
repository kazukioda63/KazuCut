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

## 2026-07-12

- **D-014**: UXP AddonヘッダーをリポジトリへベンダリングしSDKダウンロード手順を撤廃。
  Adobe自身がヘッダー冒頭で再配布を許諾しており、npm bolt-uxp@1.3.10が公開再配布して
  いる実物を取得（THIRD_PARTY_NOTICES.md）。addon_main.cppを実API
  （addon_apis構造体 / UXP_ADDON_INIT(cb)）へ書き換え。
- **D-015**: mingw-w64クロスコンパイルでWindows x64バイナリ（Worker/Addon）を生成し
  plugin/win/x64/へコミット。ユーザーのセットアップを「UXP Developer Toolで読み込むだけ」に短縮する
  ため。公式ビルドはMSVC（build-*.ps1）を推奨とし、mingwビルドは検証用と明記。
  実機動作は未検証のためMANUAL_TEST_CHECKLIST 1〜4の報告を待つ。
- **D-016**: bolt-uxp module.cppがAddon内からCreateProcess+パイプの子プロセス起動を
  製品機能として同梱している事実を確認 → ADR-001外部Worker方式の公開前例として
  REFERENCES.mdへ記録（実機ゲートは維持）。
- **D-017**（2026-07-12 実機Probe確定）: TrackItem CloneでリンクAudioは複製されない
  → 再構築はV/A各トラックを独立にClone（二重Clone防止不要）。Moveは相対オフセット
  （移動量=目的地−現在地で計算）。SetInPointは末尾固定の先頭トリム（start可変）
  → Clone→SetIn/Out→Moveで位置補正の順序を採用。DOM参照は毎回取り直し必須、
  Action生成はlockedAccess内。→ docs/api-probe.md
- **D-018**（2026-07-12 実機）: Hybrid Addonロードは非同期（await require）。
  mingw静的リンク版kazucut-native.uxpaddonがPremiere 26.3.0実機でロード成功、
  Workerパス解決成功（「ネイティブ接続OK」）。ADR-001の実機ゲート前半クリア。
  残り: Worker実起動/キャンセル/Job Object（チェックリスト2-4,22）。
- **D-019**（2026-07-12 実機）: **Phase 3完了**。500ms削除実証がPremiere 26.3.0実機で
  全9ステップ成功（A/V同期0tick・合計時間=元-500ms・対象外/元シーケンス不変）。
  ADR-003を戦略AでAcceptedへ更新。検出・修正したバグ2件: getSpeed倍率単位、
  一時領域間隔不足によるClone上書き破壊。
- **D-020**（2026-07-12 オーナー決定・仕様改定）: 出力方式を**直接編集のみ**へ変更。
  複製シーケンス方式は「結果の場所が分からない」ため廃止、バックアップ複製も作らない
  （Ctrl+Zで戻す。オーナーが明示選択）。カットした各位置へシーケンスマーカー
  「KazuCut」を打つ（Markers.createAddMarkerAction、公式Doc確認済み）。
  PRODUCT_SPEC 3.3/17/27/32章とCLAUDE.md安全条件1を改定。
- **D-021**（2026-07-17）: カット境界の**フレーム量子化**を導入。無音境界はミリ秒由来で
  フレーム境界に揃わず、Premiereはコマの途中の編集点も受理するため、適用結果に
  1コマ分の空白（黒フレーム）が見えることがあった（オーナー報告）。対策として適用時に
  削除区間をクリップIn基準のフレーム境界へ安全側（開始切り上げ・終了切り下げ=カット縮小）
  に丸める（frameQuantizer.ts / keepSegmentPlanner）。1フレームのTick長は
  Sequence.getTimebase()（第一候補）→getSettings().videoFrameRate（第二候補）で取得
  （frameGrid.ts。**両APIとも実機未検証**）。取得失敗時は丸めなしの従来動作へ
  フォールバックし、apply-result.jsonのnoteに生値を残して診断可能にする。
