# FINAL_REPORT（0.1.0 開発スナップショット / 2026-07-11）

開発環境がLinuxコンテナ（Windows・Premiere・Hybrid SDKなし）だったため、
仕様書13章の「SDKなし」方針で**移植可能な部分を実装・テスト完了**し、
Windows専用部分はソース完成+未検証と明記する。**問題は隠していない。**

## 実装済み・この環境で検証済み（テストが実際に通っている）

| 領域 | 内容 | 検証 |
|---|---|---|
| Tick演算 | BigInt非依存10進文字列演算（2^53超対応） | Vitest 8件 |
| プリセット | 標準3種（仕様値どおり・全てフィラーOFF）+検証 | Vitest 7件 |
| 候補統合 | 無音/フィラーUnion・二重削除防止・近接統合 | Vitest 7件 |
| Keep Segment | 中央500ms削除計画・前40/後60分配・左詰め | Vitest 7件 |
| Edit Plan | 複数クリップ累積シフト・ギャップ維持 | Vitest 3件 |
| Snapshot保護 | 対象外トラック完全比較（移動/短縮/削除/追加検出） | Vitest 8件 |
| A/Vペア解決 | 厳密一致・曖昧時中止・非対応素材検査 | Vitest 13件 |
| 日本語正規化 | NFKC/かな統一/長音/波ダッシュ/重複母音 | Vitest 8件 |
| フィラー照合 | 安全語自動選択・文脈依存語非自動・「あの本」除外 | Vitest 9件 |
| Transcriptパーサ | Schema非固定・単語/Segment判別・不正拒否 | Vitest 6件 |
| 設定保存 | SchemaVersion・壊れたJSON安全・カスタムプリセットのみフィラーON復元 | Vitest 8件 |
| キャッシュキー | 仕様キー全項目・OFF時フィラー非寄与 | Vitest 5件 |
| JobPoller | 進捗/キャンセル/タイムアウト/不正JSON | Vitest 6件 |
| **フィラーOFF保証** | OFF時Provider未呼出（spy）・リクエストにfillerセクション不在 | Vitest 5件 |
| 適用パイプライン | 複製特定/Clone戦略/検証/バックアップ（**Mock**） | Vitest 10件 |
| 無音検出エンジン | C++。しきい値/ヒステリシス/VAD/小声保護/島統合/余白 | Catch2 12件 |
| WAVデコーダ | リサンプル/ch選択/範囲/日本語パス/キャンセル | Catch2 7件 |
| Workerプロトコル | test/analyzeジョブ・モデル未存在・Tick変換 | Catch2 6件 |
| **Workerプロセス** | 実バイナリ起動・JSON Lines・キャンセル・stdinクローズ自己終了・不正JSON | Vitest統合 8件 |
| UXPバンドル | esbuildでplugin/dist/main.js生成 | ビルド成功 |

- TypeScript型エラー: 0 / ESLint重大エラー: 0
- Vitest: **119件 全成功** / Catch2: **25ケース(57 assertions) 全成功**（Linux g++ 13, C++20）

## 実装済み・未検証（コンパイルまたは実行環境がない）

| 領域 | 状態 | 理由 |
|---|---|---|
| MediaFoundationAudioDecoder | mingw-w64クロスコンパイル**成功**・実行未検証 | Premiere/Windows実機なし |
| Hybrid Addon（JobManager+バインディング） | 実SDKヘッダー（同梱）でクロスコンパイル**成功**、uxp_addon_init/terminateエクスポート確認・Premiereロード未検証 | Premiere実機なし |
| 同梱バイナリ（plugin/win/x64/） | KazuCutWorker.exe / kazucut-native.uxpaddon をコミット済み | mingwビルド。実機動作報告待ち。公式ビルドはMSVC推奨 |
| UXPパネルのPremiere実機表示 | manifest v6+UI完成 | Premiere実機なし |
| uxpPremiereAdapter（実DOM操作） | **未実装**（抽象+Mockのみ） | API Probe結果なしに実装しない方針（ADR-003） |
| whisper.cpp実行統合 | CMakeオプションの骨組みのみ | 検証環境なし。モデル設定時は「未対応」を明示エラー |

## Mockのみの機能（実機成功と主張しない）

- シーケンス複製・TrackItem Clone・タイムライン再構築・適用後検証
  （ロジックはMockで検証済み。実機挙動はMANUAL_TEST_CHECKLIST 8〜13で確認要）

## 採用アーキテクチャ

- ADR-001（**Proposed**）: 外部Workerプロセス（ジョブ1件=プロセス1件、
  CreateProcessW+Job Object+stdio JSON Lines）。**実機検証まで正式採用しない。**
  Workerプロセス側の挙動（起動/IPC/キャンセル/孤児防止）はLinuxで実証済み。
- Timeline Strategy: 戦略A（TrackItem Clone, isInsert=false）を第一候補（ADR-003 Proposed）

## API Probe

- 実装済み（`plugin/src/premiere/apiProbe.ts`、読み取り系11項目+変更系10項目定義、
  パネルの「API Probe実行」ボタンから実行・plugin-dataへ保存）
- **実行は未実施**（Premiere実機必要）

## フィラーOFF検証

- OFF時: TranscriptProvider未呼出（spyテスト）、ジョブリクエストにfillerセクション不在、
  Worker側もfillerセクション不在ならWhisperコードパスへ不到達、
  キャッシュキーへフィラー設定が寄与しない — すべて自動テストで保証

## Known Issues

1. 同梱バイナリはmingwクロスコンパイル産で実機未検証。ロード失敗時はMockモードバナーが出る（実機報告待ち）
2. `ticksToApproxMs`は表示専用（2^53超では概算）。編集位置には未使用
3. VADは自己実装（エネルギー+ZCR）。実素材でRecall不足ならWebRTC VADへ切替（ADR-002）
4. 1秒=254,016,000,000 ticksは実機未確認の仮定値（API ProbeのTickTime項目で検証する）

## 残りの手動作業（ユーザー）

1. **ビルド不要**: UDTで `plugin/manifest.json` を読み込むだけ（SDK_SETUP_REQUIRED.md 3ステップ手順）
2. （自分でビルドする場合のみ）`doctor.ps1` → `bootstrap.ps1` → `build.ps1`
3. または UDTで `build\dist\KazuCutLocal` を読み込み
4. MANUAL_TEST_CHECKLIST.mdの実機テスト（特にAPI Probe → 結果を共有）
5. 実素材3本以上+正解区間JSONの提供（tools/evaluate）

## 次に実行するコマンド

```powershell
# Windows実機で:
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\doctor.ps1
.\scripts\bootstrap.ps1
.\scripts\build.ps1
.\scripts\prepare-dist.ps1
```

```bash
# Linux/macOS（解析コアの再検証）:
npm test && cmake --build build/worker -j && build/worker/worker_tests
```
