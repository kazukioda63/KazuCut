# KazuCut Local

## 1. KazuCut Localとは

Adobe Premiere Pro 26.3.0（Windows）用のUXP Hybrid Pluginです。
1人喋りショート動画のAロールから**無音区間**（と、任意で**日本語フィラー**）を検出し、
候補を確認してから安全にタイムラインへ適用します。
処理はすべてローカルで完結します（クラウドAI・テレメトリー・APIキーなし）。

> **現在の状態（0.1.0開発中）**: 解析エンジンは実装・テスト済み、
> Windows用バイナリ（Addon/Worker）もビルド・同梱済みですが、
> **Premiere実機での動作は未検証**です。
> 詳細は `FINAL_REPORT.md` と `BLOCKING_REPORT.md` を参照してください。

## 2. 対応環境

- Windows 10 / 11（x64）
- Adobe Premiere Pro 26.3.0
- CPUのみで動作（CUDA不要）

## 3. 使用タイミング

1. Aロール・BGM・ガイド画像をタイムラインへ配置（Aロールは100%速度のまま）
2. KazuCut Localを実行して無音を処理
3. 必要な動画だけフィラーを処理
4. テロップ・Bロール追加 → 編集終盤に110%速度化 → 書き出し前にガイド削除

## 4. 対応素材

通常のVideoClip/AudioClipTrackItem / ローカルファイル / 動画内蔵音声（MP4・MOV、AAC等）/
正方向・100%速度 / モノラル・ステレオ。

## 5. 非対応素材

別録り会話音声 / Merged Clip / マルチカメラ / ネスト / 逆再生 / 可変速度・タイムリマップ /
100%以外の速度 / オフラインメディア / A/Vペアが曖昧なタイムライン /
複雑なトランジション・キーフレーム。非対応の場合は理由を日本語で表示し、処理しません。

## 6. BGM・ガイド画像

移動・削除・短縮は**一切行いません**（トラックロックに依存せず、処理後にSnapshot比較で
不変を検証します）。Aロール短縮後にBGMが長く残る場合は情報表示のみ行います。

## 7. Hybrid SDK

**外部SDKのダウンロードは不要です。** 必要なUXP Addonヘッダーはリポジトリに
同梱済み（`addon/third_party/uxp/`、Adobe再配布許諾付き）で、さらにビルド済み
バイナリも `plugin/win/x64/` に同梱しています。手順は `SDK_SETUP_REQUIRED.md`。

## 8. UXP Developer Tool

Creative CloudからUXP Developer Toolをインストールしてください。
プラグインの読み込み・最終CCXパッケージはUXP Developer Toolで行います。

## 9. Developer Mode

Premiere Pro の環境設定でDeveloper Modeを有効にしてください（UXP Developer Toolからの読み込みに必要）。

## 10. セットアップ

```powershell
Set-ExecutionPolicy -Scope Process Bypass

.\scripts\doctor.ps1      # 環境診断
.\scripts\bootstrap.ps1   # npm install等
```

## 11. ビルド

```powershell
.\scripts\build.ps1        # 型チェック/Lint/UXP/Worker/Addon/テスト/配布フォルダ
.\scripts\prepare-dist.ps1 # Plugin Folderのみ再生成
```

Linux/macOSでの部分ビルド（解析コアのみ）:

```bash
npm install && npm run typecheck && npm run lint && npm test
cmake -S worker -B build/worker && cmake --build build/worker -j && build/worker/worker_tests
```

## 12. Premiereへの読み込み

1. `.\scripts\prepare-dist.ps1` で `build\dist\KazuCutLocal` を生成
2. UXP Developer Tool → Add Plugin → `build\dist\KazuCutLocal\manifest.json`
3. Load → PremiereにKazuCut Localパネルが表示される

## 13. 無音処理

- ON/OFF（初期値ON）、完全削除 or 指定時間まで短縮（前40%/後60%で残す）
- 自動しきい値（ノイズフロア+マージン）/ 手動しきい値、ヒステリシス、VAD、小声保護
- 検出候補は適用前にリストで確認し、個別に選択/解除できます

## 14. フィラーON/OFF

初期値は**OFF**です。OFFの間は文字起こし・Whisperを一切実行しません
（CPU・メモリ・待ち時間ゼロ）。ONにするとPremiere既存文字起こしを優先し、
単語時刻が無い場合のみローカルWhisperを使います。

## 15. Whisperモデル

```powershell
.\scripts\download-whisper-model.ps1 -Model small
```

パネルの「Whisperモデル → 選択...」で指定。モデル未設定でも無音処理は全機能動作します。

## 16. プリセット

標準: 自然 / ショート高速 / 保守的（すべてフィラーOFF）。
すべての値を変更してカスタムプリセットとして保存できます。

## 17. 直接編集

既定は「複製シーケンスで編集」です。「元シーケンスを直接編集」（上級者向け）を選んだ
場合も、必ず先にバックアップ複製を作成し、失敗したら編集を開始しません。

## 18. エラー対処

エラーは日本語で表示されます。代表例:
- 「解析プログラムを起動できませんでした」→ セキュリティソフトの除外設定を確認
- 「対応する音声クリップを一意に特定できませんでした」→ A1に内蔵音声があるか確認
- 「メディアがオフラインです」→ 再リンク後に再実行

## 19. ログ

`plugin-data:/logs/`（1ファイル5MB・最大5世代、ユーザー名はマスク）。

## 20. キャッシュ

解析結果はメディアパス・サイズ・更新日時・設定ハッシュ等をキーにキャッシュします。
フィラーOFF時はフィラー関連キャッシュを作成しません。

## 21. アンインストール

UXP Developer ToolでUnload → プラグインフォルダ削除 → `plugin-data:/` の設定・ログ・キャッシュを削除。

## 22. 既知の制限

- **Premiere実機は未検証**。同梱バイナリ（Addon/Worker/MFデコーダ）は
  クロスコンパイル成功済みだがWindows実機での動作報告待ち（BLOCKING_REPORT.md）
- タイムライン自動適用はAPI Probe（実機）完了まで無効
- whisper.cpp実行本体は未統合（フィラーONでモデル設定時はエラーを明示）
- WAV以外のデコードはWindows（Media Foundation）でのみ動作予定

## 23. プライバシー

音声・文字起こし・メディアを外部へ送信しません。テレメトリーなし。APIキー不要。
ネットワークを使うのはユーザーが明示実行する `download-whisper-model.ps1` のみです。

## 24. 第三者ライセンス

`THIRD_PARTY_NOTICES.md` を参照してください。
