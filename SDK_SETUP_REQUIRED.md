# セットアップ手順（Windows）

**朗報: Adobe SDKのダウンロードは不要になりました。**
必要なヘッダーはリポジトリに同梱済みで（`addon/third_party/uxp/`、Adobe再配布許諾付き）、
さらに**ビルド済みのWindows用バイナリも同梱**しています:

- `plugin/win/x64/KazuCutWorker.exe`（解析エンジン）
- `plugin/win/x64/kazucut-native.uxpaddon`（ネイティブモジュール）
- `plugin/dist/main.js`（パネルUI）

つまり **何もビルドせずに、そのままPremiereで試せます。**

---

## いちばん簡単な手順（ビルド不要・3ステップ）

### 1. UXP Developer Tool を入れる

Creative Cloud Desktop を開く → 左メニュー「すべてのアプリ」→
検索で「UXP Developer Tool」→ インストール。

### 2. このリポジトリをPCに置く

GitHubの緑の「Code」ボタン → 「Download ZIP」→ 好きな場所に展開。
（Gitが使えるなら `git clone` でもOK）

### 3. Premiereに読み込む

1. Premiere Pro 26.3 を起動
2. UXP Developer Tool を起動（初回は「Developer Modeを有効にしますか?」→ はい）
3. UDTの「Add Plugin」→ 展開したフォルダの **`plugin/manifest.json`** を選ぶ
4. 一覧に出た「KazuCut Local」の「•••」→ **Load**
5. Premiereに KazuCut Local パネルが表示される

これで終わりです。パネル上部に黄色い「Mockモード」バナーが**出なければ**
ネイティブ接続成功です。出た場合は下の「うまくいかない時」へ。

> 注意: 同梱バイナリはLinux上でクロスコンパイルしたもので、
> **Windows実機での動作はまだ未検証**です。動いたか/動かなかったかを
> ぜひ報告してください（MANUAL_TEST_CHECKLIST.md の1〜4が該当）。

---

## うまくいかない時

| 症状 | 対処 |
|---|---|
| UDTに「Developer Mode」の警告 | Premiere側: 編集 → 環境設定 → 一般 →「開発モード」をON → Premiere再起動 |
| パネルに「Mockモード」バナー | Windows Defenderが `KazuCutWorker.exe` をブロックしていないか確認（Windowsセキュリティ → 保護の履歴） |
| 「解析する」でエラー | パネルのエラーメッセージ全文をコピーして報告してください |

---

## 自分でビルドしたい場合（任意・上級者向け）

同梱バイナリを使わず自分でビルドする場合のみ、以下が必要です:

- Visual Studio 2022（無料のCommunity版でOK。インストール時に
  「C++によるデスクトップ開発」にチェック）
- CMake / Node.js 20+ / Git

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\doctor.ps1     # 足りないものを教えてくれる
.\scripts\bootstrap.ps1
.\scripts\build.ps1      # UI + Worker + Addon + テスト + 配布フォルダ
```

## Whisperモデル（任意）

フィラー削除機能を使う場合だけ必要です。無音カットだけなら不要。

```powershell
.\scripts\download-whisper-model.ps1 -Model small
```
