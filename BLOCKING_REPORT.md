# BLOCKING_REPORT

現在ブロックされている作業と技術的理由。解消時に該当項目を削除・PROGRESS.mdを更新。

## ~~1. Hybrid Addonのビルド~~（解消済み 2026-07-12）

- SDKヘッダーを `addon/third_party/uxp/` へベンダリング（Adobe再配布許諾付き、
  入手経路はTHIRD_PARTY_NOTICES.md）。外部SDKダウンロードは不要になった
- mingw-w64クロスコンパイルでビルド成功。`plugin/win/x64/` へ同梱済み
- 残り: **Premiere実機でのロード確認**（下記2へ統合）

## 2. Premiere実機検証全般（Blocker: 開発環境がLinux）

- 影響:
  - 同梱バイナリ（Worker/Addon）はクロスコンパイル成功だが**Windows実行未検証**
  - API Probe未実施 → タイムライン自動編集（適用ボタン）は無効化中
  - Media Foundationデコーダ: コンパイル成功・実行未検証
  - Premiere Transcript JSONの実Schema未採取
- 理由: この開発環境はLinuxコンテナであり、Windows/Premiere Proが存在しない
- 解消手順: SDK_SETUP_REQUIRED.md（3ステップ手順）→ MANUAL_TEST_CHECKLIST.md

## 3. Whisper統合の実行経路（Blocker: 上記2）

- フィラー検出は「Premiere Transcript優先→Whisper」のTS側制御と
  Worker側のモデル検証まで実装済みだが、whisper.cpp実行本体は未統合
  （CMakeオプションKAZUCUT_ENABLE_WHISPERの骨組みのみ）
- 現在の動作: フィラーONでモデル未設定→仕様どおりスキップ（テスト済み）。
  モデル設定済みでも本ビルドではWHISPER_FAILEDを返す（未対応と明示）
- 理由: 実行検証環境がなく「未検証の完成報告」を避けた（CLAUDE.md安全条件10）

## 4. 実素材評価（Blocker: 素材未提供）

- tools/evaluate は実装済みだが、ユーザーからの未編集動画3本以上と
  正解区間JSONの提供待ち
