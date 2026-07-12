# Progress

## Current phase
**Phase 4-7統合が実機で動作**（実素材34候補の解析成功・適用成功）。
D-020により直接編集方式へ改定済み。設定永続化・候補ジャンプ・一括選択まで実装

## Completed
- Phase 0: 仕様固定（PRODUCT_SPEC）/ ADR-001〜006 / REFERENCES / ビルド基盤（npm+CMake+PS1）
- TSコア: Tick演算 / プリセット / 候補統合 / Keep Segment / Edit Plan / Snapshot保護 /
  A/Vペア / 正規化 / フィラー照合 / Transcriptパーサ / 設定保存 / キャッシュキー / JobPoller
- フィラーOFF保証（spy検証・ジョブリクエストにfillerセクション不在）
- Worker: 無音検出エンジン / WAVデコーダ / JSON Lines IPC / 協調キャンセル /
  stdinクローズ自己終了（Linuxでビルド+実プロセス統合テスト済み）
- MFデコーダ / Hybrid Addon: 実SDKヘッダー同梱 + mingw-w64クロスコンパイル成功、
  uxp_addon_init/terminateエクスポート確認。バイナリをplugin/win/x64/へ同梱（実機動作は未検証）
- 適用パイプライン（複製特定→Clone再構築→A/V・対象外検証→バックアップ）: Mock検証済み
- UXPパネル（manifest v6 / 日本語UI / esbuildバンドル成功）
- API Probe実装（実行は実機待ち）
- スクリプト一式 / README / MANUAL_TEST_CHECKLIST / THIRD_PARTY_NOTICES /
  BLOCKING_REPORT / FINAL_REPORT / tools/evaluate

## In progress
- なし（この環境で実行可能な作業は完了）

## 実機検証済み（2026-07-12）
- Addonロード成功（ネイティブ接続OK/Worker検出）/ API Probe読取系+変更系 /
  **500ms削除実証 全9ステップ成功（A/V同期0tick）** → ADR-003 Accepted

## Blocked（BLOCKING_REPORT.md参照）
- Worker実起動テスト（解析ボタン）とキャンセル・強制終了・Premiere終了時挙動（チェックリスト2-4,22）
- whisper.cpp実行統合（検証環境なしのため未統合と明示）
- 実素材評価（素材提供待ち）

## Next
1. 実機: 直接編集+マーカーの動作確認（build 20260712T1326）・キャンセル動作（チェックリスト3）
2. 「Aロールトラック全体」（複数クリップ）対応 ※ユーザーの編集スタイル確認待ち
3. プリセット実感チューニング（ユーザーの視聴フィードバック待ち）
4. フィラー削除: Premiere Transcript経由を先行実装 → whisper.cpp統合（Phase 8-9）
5. キャッシュ（Phase 10）/ CCXパッケージ化（Phase 11）

## Verification status
- Build: TS(typecheck/lint/esbuild) 成功 / Worker(Linux g++ + mingw-w64 Win x64) 成功 /
  Addon(mingw-w64 Win x64) 成功
- Unit tests: Vitest 119件成功 / Catch2 25ケース成功
- Premiere実機: 未実施（この環境では実行不可）
