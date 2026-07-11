# BLOCKING_REPORT

現在ブロックされている作業と技術的理由。解消時に該当項目を削除・PROGRESS.mdを更新。

## 1. Hybrid Addonのビルド（Blocker: SDK未取得）

- 影響: `kazucut-native.uxpaddon` が未ビルド。パネルはMockモードで動作
- 理由: UXP Hybrid Plugin SDKはAdobe Developer Consoleからの手動ダウンロードが必要
  （Adobeアカウントログインが必要で自動化不可）
- ソース・CMakeは完成済み。SDK配置後 `.\scripts\build-addon.ps1` 1コマンドでビルド可能
- 解消手順: SDK_SETUP_REQUIRED.md

## 2. Premiere実機検証全般（Blocker: 開発環境がLinux）

- 影響:
  - API Probe未実施 → タイムライン自動編集（適用ボタン）は無効化中
  - Media Foundationデコーダ未コンパイル・未検証
  - Addonのプロセス起動可否（ADR-001の確定）未検証
  - Premiere Transcript JSONの実Schema未採取
- 理由: この開発環境はLinuxコンテナであり、Windows/Premiere Pro/Visual Studioが存在しない
- 解消手順: MANUAL_TEST_CHECKLIST.md（実機での実施項目22件+Phase 1検証5件）

## 3. Whisper統合の実行経路（Blocker: 上記1・2）

- 影響: フィラー検出は「Premiere Transcript優先→Whisper」のTS側制御と
  Worker側のモデル検証まで実装済みだが、whisper.cpp実行本体は未統合
  （CMakeオプションKAZUCUT_ENABLE_WHISPERの骨組みのみ）
- 現在の動作: フィラーONでモデル未設定→仕様どおりスキップ（テスト済み）。
  モデル設定済みでも本ビルドではWHISPER_FAILEDを返す（未対応と明示）
- 理由: Windowsビルド環境がなく、統合しても一切検証できないため
  「未検証の完成報告」を避けた（CLAUDE.md安全条件10）

## 4. 実素材評価（Blocker: 素材未提供）

- tools/evaluate は実装済みだが、ユーザーからの未編集動画3本以上と
  正解区間JSONの提供待ち
