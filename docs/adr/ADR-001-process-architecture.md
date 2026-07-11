# ADR-001: プロセスアーキテクチャ

- Status: **Proposed**（実機検証まで正式採用しない — 仕様7.2の検証ゲート）
- Date: 2026-07-11

## Context

重い解析（MFデコード / 無音解析 / VAD / whisper.cpp）をUXPのJSスレッドや
Addon関数内の同期処理で行うことは禁止（仕様6.1, 37）。候補は:

- **A. 外部Workerプロセス**: Addonが `CreateProcessW` で同梱 `KazuCutWorker.exe` を
  ジョブごとに起動、JSON Lines IPC、Job Objectで生存管理
- **B. Addon内Native Worker Thread**: C++スレッドで解析、ジョブポーリングで結果取得

## Decision（暫定）

**Aを第一候補として実装する。** ただし以下が実機で確認できるまで正式採用しない:
1. Hybrid AddonからのCreateProcessW可否（サンドボックス制約）
2. インストール後のWorker絶対パス解決（plugin root配下 `win/x64/KazuCutWorker.exe`）
3. Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) によるPremiere終了時の道連れ終了
4. Defender/SmartScreenによる起動ブロックの有無

コードはA/B両対応できるよう、Panel側は `NativeBridge` 抽象（ジョブポーリング型）だけに
依存し、`executionMode: "external-worker" | "in-process-worker"` で判別する。
解析エンジン本体（worker/src/analysis）はプロセス形態に依存しないライブラリとして実装し、
Bへ切替える場合もAddonから同一コードをリンクする。**両方式のプロセス管理層を
中途半端に二重実装しない**（Bのプロセス管理層はA不成立が確定してから実装する）。

## Aの設計

- ジョブ1件 = プロセス1件（常駐なし）。フィラーOFF時はWhisper未ロード。
- 起動: `CreateProcessW`、`lpApplicationName`=絶対パス、Shell経由禁止、
  引数は `--job <一時リクエストファイルパス>` のみ（巨大JSONをコマンドラインへ渡さない）
- IPC: 継承stdin/stdout上のJSON Lines（第一候補の名前付きパイプは、
  stdio継承がHybrid Addonで問題になった場合に昇格）
- キャンセル: stdinへ `{"type":"cancel"}` → 3秒待機 → `TerminateProcess` → 理由ログ
- 生存管理: Addon起動時にJob Object作成、KILL_ON_JOB_CLOSE設定、Worker割当

## Consequences

- Linux開発環境ではWorker本体（stdin/stdout JSON Lines、解析コア）を
  ビルド・統合テスト可能。Addon側プロセス管理はWindows実機まで未検証。
- 実機検証結果（MANUAL_TEST_CHECKLIST 1〜4, 22）でこのADRをAccepted/Rejectedへ更新する。
