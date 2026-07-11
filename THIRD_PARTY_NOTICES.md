# THIRD_PARTY_NOTICES

## 同梱（ベンダリング済み）

### nlohmann/json 3.11.3
- 取得元: https://github.com/nlohmann/json (tag v3.11.3)
- ライセンス: MIT
- 使用目的: Worker/AddonのJSON処理（IPCメッセージ・ジョブリクエスト）
- 配布ファイル: KazuCutWorker.exe / kazucut-native.uxpaddon（静的リンク）
- ソース: `worker/third_party/nlohmann/json.hpp`

### Catch2 3.7.1
- 取得元: https://github.com/catchorg/Catch2 (tag v3.7.1, amalgamated)
- ライセンス: Boost Software License 1.0
- 使用目的: C++ユニットテスト（テストのみ。製品バイナリへ含まれない）
- ソース: `worker/third_party/catch2/`

## ビルド時取得（オプション）

### whisper.cpp v1.7.4（KAZUCUT_ENABLE_WHISPER=ON時のみ）
- 取得元: https://github.com/ggml-org/whisper.cpp (tag v1.7.4, CMake FetchContent)
- ライセンス: MIT
- 使用目的: ローカル音声認識（フィラー検出）。CPUのみ、通信なし
- 配布ファイル: 有効化ビルドのKazuCutWorker.exe
- モデル: Gitへ含めない。`scripts/download-whisper-model.ps1` でユーザーが取得

## npm devDependencies（開発時のみ・配布物へ含まれない）

| パッケージ | バージョン | ライセンス | 用途 |
|---|---|---|---|
| typescript | ^5.7.2 | Apache-2.0 | 型チェック |
| esbuild | ^0.24.0 | MIT | UXPバンドル |
| vitest | ^2.1.8 | MIT | テスト |
| eslint / typescript-eslint | ^9.17 / ^8.19 | MIT | Lint |
| @types/node | ^22 | MIT | 型定義 |

正確な解決バージョンは `package-lock.json` で固定。

## VAD
初期版は自己実装（ADR-002）のため外部依存なし。
WebRTC VAD等へ切替える場合はここへ追記すること。
