# SDK_SETUP_REQUIRED — ユーザー作業が必要です

現在の開発環境（Linuxコンテナ）には以下が存在せず、これらを要する作業は
Windows実機での作業として保留されています。

## 1. Adobe UXP Hybrid Plugin SDK（必須・Adobeアカウント必要）

Native Addon（`kazucut-native.uxpaddon`）のビルドに必要です。

1. https://developer.adobe.com/console にログイン
2. UXP Hybrid Plugin SDK のカードからSDKをダウンロード
   （参考: https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/）
3. 展開先を次のいずれかに配置（doctor.ps1 が検索する）:
   - 環境変数 `ADOBE_UXP_HYBRID_SDK` で指定したパス
   - `C:\Adobe\UXPHybridSDK`
   - `C:\SDK\AdobeUXPHybrid`
   - `%USERPROFILE%\AdobeUXPHybridSDK`
4. SDK内に `UxpAddon.h` / `UxpAddonShared.h` / `UxpAddonTypes.h` が
   含まれることを確認
5. `.\scripts\doctor.ps1` で検出を確認 → `.\scripts\build.ps1`

SDKが無い間もAddonのソース（`addon/`）とCMakeは完成済みで、
SDK配置後に `.\scripts\build-addon.ps1` の1コマンドでビルドできます。
**SDKヘッダーの捏造・偽ヘッダーの作成は行っていません。**

## 2. Windowsビルド環境

- Windows 10/11 x64
- Visual Studio 2022 + 「C++によるデスクトップ開発」ワークロード + Windows SDK
- CMake 3.24以上 / Node.js 20以上 / npm / Git

## 3. Premiere Pro 実機

- Adobe Premiere Pro 26.3.0
- UXP Developer Tool（Creative Cloudからインストール）
- Premiere の Developer Mode 有効化
- 実機検証手順は `MANUAL_TEST_CHECKLIST.md`

## 4. Whisperモデル（フィラー削除を使う場合のみ・任意）

```powershell
.\scripts\download-whisper-model.ps1 -Model small
```
モデル未設定でも無音処理はすべて動作します。

## この環境で完了済み／完了予定の作業

- TypeScript実装とユニットテスト（Vitest）
- Worker解析コア（C++20 移植可能部）の実装とテスト（Linux g++/Catch2で検証）
- Addon/Worker のWindows専用ソースとCMake（コンパイルはWindows待ち・未検証）
- ドキュメント・スクリプト一式
