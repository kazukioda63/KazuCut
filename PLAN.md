# PLAN

## 開発環境の制約（重要）

現在の開発環境は **Linuxコンテナ**（Claude Code リモート実行環境）である。
- Windows / Visual Studio 2022 / Windows SDK: **なし**
- Adobe Premiere Pro 26.3.0 / UXP Developer Tool: **なし**
- Adobe UXP Hybrid Plugin SDK: **なし**（捏造しない。`SDK_SETUP_REQUIRED.md` 参照）

したがって本計画は仕様書13章「Hybrid SDKがない場合」の方針を全面適用する:
1. 移植可能なコードはLinux上で実装・ビルド・テストまで完了させる
2. Windows専用コード（Media Foundation / Addon / Job Object / CreateProcessW）は
   ソースとCMakeを完成させ、Windows上で1コマンドビルド可能にする（未検証と明記）
3. Premiere実機検証項目は `MANUAL_TEST_CHECKLIST.md` に手順化する

## レイヤー分割とテスト戦略

| レイヤー | 実装言語 | Linuxで検証可能か |
|---|---|---|
| UXP Panel ロジック（解析計画・候補統合・Tick演算・正規化・プリセット等） | TS | ✅ Vitest |
| Premiere Adapter（DOM操作） | TS | Mockのみ（実機はProbe待ち） |
| Native Bridge（Addon呼び出し） | TS | Mock Adapterで✅ |
| Worker コア（無音解析・VAD・プロトコル・フィラー照合） | C++20 (portable) | ✅ g++ + Catch2 |
| Worker WAVデコーダ（テスト用） | C++20 (portable) | ✅ |
| Worker MFデコーダ / whisper.cpp統合 | C++20 (Windows) | ❌ ソース+CMakeのみ |
| Addon（UXP Hybrid, CreateProcessW, Job Object, IPC） | C++20 (Windows) | ❌ ソース+CMakeのみ |

## フェーズ計画

- **Phase 0**: 仕様固定 / ADR / ビルド基盤（npm, CMake, scripts）→ この環境で完了可能
- **Phase 1**: Worker実行ファイルの起動・IPC・キャンセルは、Linuxでは
  Workerプロセス自体（stdin/stdout JSON Lines版）をビルドして統合テストする。
  Addonロード・CreateProcessW・Job ObjectはWindows実機タスクとして手順化。
- **Phase 2**: API Probe実装（TS）。実行はPremiere実機タスク。
- **Phase 3**: 500ms削除実証のロジック（Snapshot / Keep Segment / Rebuild / Validator）を
  Premiere Mockで検証。実機実行は手動タスク。
- **Phase 4**: IAudioDecoder抽象 + WavFileDecoder（portable, テスト付き）+
  MediaFoundationAudioDecoderソース。
- **Phase 5**: 無音検出エンジン（C++ portable、合成音声fixtureでテスト）。
- **Phase 6**: 候補確認UI（index.html + TS、Mock Bridgeで動作）。
- **Phase 7**: 本番適用パイプライン（Mock検証）。
- **Phase 8**: PremiereTranscriptProvider（Schema非固定パーサ、fixtureテスト）。
- **Phase 9**: whisper.cpp統合（CMakeオプション、Commit固定、Windowsビルド手順）。
- **Phase 10**: プリセット / キャッシュ / ログ / エラー処理。
- **Phase 11**: 配布フォルダ生成 / README / MANUAL_TEST_CHECKLIST / FINAL_REPORT。

## Windows実機で必要な作業（ユーザー作業含む）

1. Hybrid Plugin SDKの取得・配置（Adobeアカウント必要）→ `SDK_SETUP_REQUIRED.md`
2. `scripts/doctor.ps1` → `bootstrap.ps1` → `build.ps1` → `prepare-dist.ps1`
3. UXP Developer ToolでPlugin Folder読み込み
4. `MANUAL_TEST_CHECKLIST.md` の実機テスト（API Probe / 500ms削除 / 実素材）
