# MANUAL_TEST_CHECKLIST — Premiere実機テスト（Windows）

Mock成功は実機成功ではない。以下はすべて**Windows + Premiere Pro 26.3.0実機**での確認項目。
実施結果は各項目へ 日付/OK/NG/メモ を記入し、NGはADRまたはBLOCKING_REPORT.mdへ。

事前準備: `doctor.ps1` 全OK → `build.ps1` → `prepare-dist.ps1` →
UDTで `build\dist\KazuCutLocal\manifest.json` をLoad。

| # | 項目 | 手順 | 期待結果 | 結果 |
|---|---|---|---|---|
| 1 | Addonロード | パネルを開く | バナーに「Mockモード」が出ない。getVersionがexternal-worker | 未実施 |
| 2 | Worker起動 | 「解析する」（テストジョブ） | 進捗0→100%、UIが固まらない | 未実施 |
| 3 | Workerキャンセル | 解析中に「キャンセル」 | 3秒以内に停止、cancelled表示 | 未実施 |
| 4 | Worker強制終了 | 解析中にタスクマネージャでKazuCutWorker.exeを強制終了 | WORKER_CRASHEDが表示されPremiereは落ちない | 未実施 |
| 5 | パネル表示 | ドック/フローティング | 最小320x400で崩れない | 未実施 |
| 6 | API Probe | 「API Probe実行」 | plugin-data:/diagnostics/api-probe.json生成。結果をdocs/api-probe.mdへ転記 | 未実施 |
| 7 | V1/A1選択 | トラックドロップダウン | 実シーケンスのトラック一覧が出る | 未実施 |
| 8 | Sequence複製 | 複製実行 | 新規シーケンス1件がGUIDで特定される | 未実施 |
| 9 | 500ms削除 | 仕様14章のテスト構成で実行 | Keep Segment2件、後半左詰め | 未実施 |
| 10 | A/V同期 | 9の後に波形確認 | ずれが1フレーム未満 | 未実施 |
| 11 | BGM不変 | 9の後にA2確認 | 位置・長さ完全不変 | 未実施 |
| 12 | ガイド画像不変 | 9の後にV2確認 | 位置・長さ完全不変 | 未実施 |
| 13 | Undo | Ctrl+Z | 「KazuCut Local：Aロールを編集」が1回で戻る | 未実施 |
| 14 | 無音解析 | 実素材（MP4/AAC）で解析 | 候補が妥当、MFデコード成功 | 未実施 |
| 15 | フィラーOFF時にWhisper未起動 | OFFで解析中にプロセス監視 | Whisperモデル未ロード、メモリ増加なし | 未実施 |
| 16 | フィラーON＋Premiere Transcript | 文字起こし済みシーケンスでON | Premiere Transcriptが使われる（ログ確認） | 未実施 |
| 17 | フィラーON＋Whisper | Transcriptなし+モデル設定済み | whisper.cppで検出 | 未実施 |
| 18 | モデル未設定 | Transcriptなし+モデル未設定でON | 仕様4.3の文言でスキップ、無音解析は完了 | 未実施 |
| 19 | 長時間素材 | 30分素材 | 完走、メモリ暴走なし、進捗表示 | 未実施 |
| 20 | 設定復元 | 設定変更→パネル閉→再起動 | 設定・プリセットが復元される | 未実施 |
| 21 | 直接編集＋バックアップ | 出力=直接編集で適用 | バックアップ複製が先に作られる | 未実施 |
| 22 | Premiere終了後にWorker残らない | 解析中にPremiereを終了 | KazuCutWorker.exeがプロセス一覧から消える（Job Object） | 未実施 |

## Phase 1 アーキテクチャ検証（ADR-001確定用）

- [ ] Hybrid AddonからCreateProcessWで同梱Workerを起動できる
- [ ] インストール後のWorkerパスがAddonモジュールパスから解決できる
- [ ] Defender/SmartScreenにブロックされない（されるなら対処を記録）
- [ ] Job ObjectのKILL_ON_JOB_CLOSEが機能する
- [ ] 上記いずれかがNGの場合 → ADR-001をIn-Process Worker Threadへ更新し実装切替
