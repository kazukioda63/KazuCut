# KazuCut Local 製品仕様書（正本）

本ファイルが実装仕様の正本である。矛盾がある場合は本ファイルを優先し、変更はADRへ記録する。

## 1. 製品情報

- 製品名: **KazuCut Local**
- Plugin ID: `com.kazu.premiere.kazucutlocal`
- 初期バージョン: `0.1.0`
- 対象: Windows 10/11 x64, Adobe Premiere Pro 26.3.0, 日本語UI, 個人利用
- 完全ローカル処理: クラウドAI不使用 / 音声・文字起こしの外部送信なし / テレメトリーなし / APIキーなし
- CPUのみで動作（CUDAは初期版不要）

## 2. ユーザーの編集フロー

### 2.1 対象動画
- 1人喋りの教育・解説系ショート動画（iPhone等で撮影）
- MP4 / MOV、会話音声は動画内蔵（主にAAC）
- 別録り会話音声は初期版では扱わない

### 2.2 代表的タイムライン（トラック番号は固定しない。V/AトラックはUIから選択）
```
V3: 別素材（任意）
V2: ショート動画UI安全領域のフレームガイド画像
V1: Aロール動画
A2: BGM
A1: Aロール内蔵会話音声
```

### 2.3 BGM・ガイド画像の保護
通常ロックされているが、**トラックロックを安全根拠にしない**。プラグイン側で保証:
- BGM/ガイド画像を移動・削除・短縮しない
- 対象外トラックへリップル編集しない
- Aロール短縮後にBGMが長く残る場合は情報表示のみ（例: 「BGMが17.7秒長く残っています。必要に応じてPremiere上で短くしてください。」）。自動トリミングしない。

### 2.4 使用タイミング
Aロール/BGM/ガイド配置 → KazuCut実行（無音→必要ならフィラー）→ テロップ/Bロール →
編集終盤に110%速度化 → 書き出し前にガイド削除。
**KazuCut実行時点のAロールは100%速度前提。初期版は100%以外を処理しない。**

## 3. 機能一覧

### 3.1 無音処理
ON/OFF、無音区間検出、完全削除、指定時間まで短縮、候補の事前確認、
候補ごとの選択/解除、境界の手動調整、設定変更、プリセット保存。

### 3.2 フィラー処理
ON/OFF、日本語フィラー検出、Premiere既存文字起こし利用、
必要な場合のみローカルwhisper.cpp、候補の事前確認・選択/解除、削除後に残す間の設定。

### 3.3 Premiere編集
**開いているシーケンスを直接編集する**（手動でカット+リップル削除した時と同じ結果になる）。
Aロール映像+内蔵音声のみ編集。A/V同期維持、対象外トラック不変、編集後自動検証。
カットした各位置にはシーケンスマーカーを打ち、どこが切られたか一目で分かるようにする。
戻す手段はPremiere標準のUndo（Ctrl+Z）。
（2026-07-12 オーナー決定D-020: 当初の「複製シーケンスへ編集」方式は
「結果がどこにあるか分からない」ため廃止。バックアップ複製も作らない）

## 4. フィラー機能の詳細

### 4.1 初期値: **OFF**（すべての標準プリセットでOFF）

### 4.2 OFF時に一切実行しないこと
Premiere Transcript有無確認 / Transcript JSON出力 / whisper.cpp初期化 / モデル読込 /
音声認識 / 辞書照合 / フィラー候補生成 / フィラー関連キャッシュ / モデル未設定警告。
OFF時は無音解析のみ実行し、Whisper関連のCPU・メモリ・待ち時間を発生させない。

### 4.3 ON時の優先順位
1. Premiere既存文字起こしに正確な単語時刻があれば使用
2. 単語時刻不足ならローカルwhisper.cpp
3. Whisperモデル未設定ならフィラー解析のみスキップ（無音処理は継続）

スキップ時の表示例:
```
フィラー解析をスキップしました。
Premiereの文字起こしに必要な単語時刻がなく、
ローカルWhisperモデルも設定されていません。
無音解析は正常に完了しました。
```

### 4.4 プリセットとの関係
フィラーON/OFFはプリセットごとに保存。標準プリセットは全てOFF。
ユーザーがONで保存したカスタムプリセットだけONを復元。

## 5. 優先順位（上位ほど重要）

1. 元シーケンスを壊さない
2. BGM・ガイド画像を動かさない
3. 対象外トラックを動かさない
4. Aロール映像と内蔵音声の同期を崩さない
5. Premiere本体をクラッシュさせない
6. 誤削除を防ぐ
7. Premiere 26.3.0で実際に動作する
8. 適用前に候補を確認できる
9. UIから設定を変更できる
10. 無音検出を自然にする
11. フィラー検出を安全にする
12. 処理速度
13. UI品質

**Whisperや高度なUIより先に「Aロール中央500ms削除の最小実証」を完成させる。**

## 6. アーキテクチャ

### 6.1 優先方式
```
Premiere UXP Panel → UXP Hybrid Addon → KazuCutWorker.exe
```
- **UXP Panel**: Premiere DOM操作 / UI / トラック・クリップ取得 / シーケンス複製 /
  候補表示 / 設定保存 / タイムライン編集 / 編集後検証 / Workerジョブ監視
- **Hybrid Addon**: UXP⇔Worker橋渡し / Worker起動・監視 / IPC / キャンセル / 異常終了検出。
  重い解析をAddon内で行わない。
- **KazuCutWorker.exe**: MF音声デコード / リサンプリング / 無音解析 / VAD /
  whisper.cpp / フィラー境界補正 / 解析キャッシュ

### 6.2 検証ゲート（Phase 1・実機）
以下を推測で決めない:
Hybrid Addonから外部EXE起動可否 / CCX内EXEの実行可否 / パッケージ後のWorkerパス /
Defender・権限制限 / Adobe配布要件との互換性。

### 6.3 フォールバック（外部Worker不成立時）
`UXP Panel → Hybrid Addon内の非同期Native Worker Thread`
条件: 重い処理をJSスレッドで実行しない / Addon関数内で同期完了させない /
C++ Worker Thread使用 / Promiseまたはジョブポーリング / Worker ThreadからPremiere DOM操作禁止 /
例外でPremiereを落とさない / 選択理由をADRへ。
**両方式を中途半端に実装せず、Phase 1の実証結果で1つを正式採用。**

## 7. Workerプロセス方式

- 常駐デーモンにしない。**解析ジョブ1件 = Workerプロセス1件**
  （孤児プロセス削減 / 状態管理単純化 / モデルメモリ解放 / クラッシュ回復 / Premiere終了後に残らない）
- フィラーOFF時はWhisperモデルを読み込まない

### 7.1 起動
`CreateProcessW`。Shell/cmd.exe/PowerShell経由禁止。`lpApplicationName`へ絶対パス。
スペース・日本語パス対応。EXEパスにユーザー入力不使用。同梱固定Workerのみ起動。
巨大JSONをコマンドラインへ渡さない。音声内容を環境変数へ渡さない。

### 7.2 IPC
優先: 1) 名前付きパイプ 2) 継承stdin/stdout。JSON Lines形式:
```json
{"type":"started","jobId":"..."}
{"type":"progress","jobId":"...","progress":0.42,"stage":"silence"}
{"type":"result","jobId":"...","result":{}}
{"type":"error","jobId":"...","error":{}}
{"type":"cancelled","jobId":"..."}
```
処理必須: 不正JSON / 途中切断 / 強制終了 / タイムアウト / jobId重複 /
過大メッセージ / キャンセル / Addon終了。

### 7.3 終了
Windows Job Object（可能なら `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）。
キャンセル: 協調キャンセル通知 → 待機 → 無応答なら強制終了 → 理由をログ。
Premiere終了後にWorkerを残さない。

## 8. 開発フェーズ

| Phase | 内容 |
|---|---|
| 0 | 環境確認 / 公式仕様確認 / 仕様ファイル / ADR / ビルド基盤 |
| 1 | Hybrid Addonロード / Worker起動実証 / IPC / キャンセル / 異常終了 / アーキテクチャ決定 |
| 2 | Premiere API Probe |
| 3 | Aロール中央500ms削除の最小実証 |
| 4 | Media Foundation音声デコード |
| 5 | 無音検出 |
| 6 | 候補確認UI |
| 7 | 本番タイムライン適用 |
| 8 | Premiere文字起こしProvider |
| 9 | ローカルwhisper.cpp |
| 10 | プリセット / キャッシュ / ログ / エラー処理 |
| 11 | 実機試験 / 配布 / README / 最終報告 |

各Phase終了時: テスト → ビルド → PROGRESS.md → DECISIONS.md → 安定ならcommit → 次へ。

## 9. 公式情報

一次情報優先: Adobe公式Doc → SDKヘッダー → Adobe公式サンプル → Microsoft Learn →
whisper.cpp公式 → 各ライブラリ公式。調査結果は `docs/REFERENCES.md` へ
（公式資料 / 確認日 / 対応バージョン / 使用した型・関数 / 不明点 / API Probe結果）。
公式情報と実機挙動が異なる場合は実機結果をADRへ。

## 10. UXP Hybrid Plugin

### 10.1 Manifest（v6以上）
概念例（実物はPremiere 26.3.0公式SchemaとHybrid SDKサンプルで確認）:
```json
{
  "manifestVersion": 6,
  "id": "com.kazu.premiere.kazucutlocal",
  "name": "KazuCut Local",
  "version": "0.1.0",
  "main": "index.html",
  "host": { "app": "premierepro", "minVersion": "26.3.0" },
  "addon": { "name": "kazucut-native.uxpaddon" },
  "requiredPermissions": { "enableAddon": true, "localFileSystem": "request" },
  "entrypoints": [{
    "type": "panel", "id": "kazucutPanel",
    "label": { "default": "KazuCut Local" },
    "minimumSize": { "width": 320, "height": 400 },
    "preferredDockedSize": { "width": 420, "height": 720 },
    "preferredFloatingSize": { "width": 540, "height": 820 }
  }]
}
```
不要権限禁止。初期状態で network / webview / fullAccess を追加しない。
Shell API不使用なら `launchProcess` を推測で追加しない。

### 10.2 配置
```
plugin-root/
├─ manifest.json
├─ index.html
├─ dist/
├─ icons/
└─ win/x64/
   ├─ kazucut-native.uxpaddon
   ├─ KazuCutWorker.exe
   └─ 必要なDLL
```
`plugin-root/addons/win/x64/` へは配置しない。

## 11. Phase 1: Addon/Worker最小実証

最初に実装するインターフェース:
```typescript
interface NativeVersionInfo {
  addonVersion: string;
  workerVersion: string;
  architecture: string;
  workerAvailable: boolean;
  executionMode: "external-worker" | "in-process-worker";
}
interface NativeBridge {
  getVersion(): NativeVersionInfo;
  healthCheck(): string;
  startJob(requestJson: string): string;
  getJobStatus(jobId: string): string;
  getJobResult(jobId: string): string;
  cancelJob(jobId: string): boolean;
  disposeJob(jobId: string): boolean;
}
```
テストジョブ: 3秒かけて進捗0→100%を返し、最後に入力文字列を返す。

確認項目: Addonロード / Worker起動 / UI非固化 / 進捗 / キャンセル / 強制終了検知 /
不正JSON / 日本語パス / スペースパス / Premiere終了時にWorker残留なし /
複数ジョブ競合防止 / Addon終了時の安全停止。
採用方式を `docs/adr/ADR-001-process-architecture.md` へ記録。

## 12. Premiere API Probe（Phase 2・実機）

検証対象: Active Project / Active Sequence / Sequence一覧・GUID・複製・複製後特定・Active変更 /
Selection取得・設定 / Video・AudioTrack列挙 / TrackItem列挙・ProjectItem・Start・End・In・Out・
Speed・Reverse・Disabled・Component Chain / TrackItem Clone・Clone時リンクAudio挙動・Move・
In/Out変更・削除 / Subclip作成 / `lockedAccess` / `executeTransaction` / メディアパス /
Transcript存在確認・JSON出力 / 再生ヘッド / Marker / Sequence削除 / BigInt可否。

```typescript
interface ProbeResult {
  apiName: string;
  available: boolean;
  succeeded: boolean;
  observedReturnType?: string;
  notes: string[];
  error?: string;
}
```
保存先: `plugin-data:/diagnostics/api-probe.json`
本番シーケンスを直接変更しない（複製または専用テストシーケンス）。
DOM変更後は変更前のDOMオブジェクトを再利用せず、GUID・再スキャンで再取得。

## 13. 時間表現

- 最終編集位置をJS浮動小数点秒だけで扱わない
- `type TickString = string;` Premiere境界はTick文字列
- Native側は100ns単位64bit整数、JSONでは文字列
- 候補API: TickTime / .ticks / createWithTicks() / add() / subtract() /
  alignToFrame() / alignToNearestFrame()
- BigIntのUXP安定性をAPI Probeで確認。不安定ならTickTime APIまたは10進文字列演算。

## 14. 500ms削除の最小実証（Phase 3）

テスト構成: V2ガイド / V1 Aロール / A2 BGM / A1 内蔵音声。
手順:
1. 元シーケンス全TrackItemをSnapshot
2. 元シーケンス複製
3. 複製前後のGUID差分取得、新規Sequenceが1件だけと確認
4. 複製をActive化しDOM再取得
5. Aロール中央500msを削除対象化
6. Aロール映像+内蔵音声のみ再構築、後半を左詰め
7. BGM・ガイド不変、対象外TrackItem比較、元シーケンス不変確認
8. A/V同期差検証
9. Undoまたは複製削除で復帰可能と確認

**成功するまで自動編集機能を完成扱いにしない。**

## 15. 対象モード

### 選択クリップ
タイムラインで選択したAロール動画と対応内蔵音声を処理。
選択クリップより後ろの同トラックAロールクリップは、短縮分だけ左へ詰める
（手動リップル削除と同じ。対象外トラックは不動）。対応音声条件:
UI指定の会話音声トラック / 同じProjectItem / Sequence Start・End一致(許容差内) /
Source In・Out一致(許容差内) / 100%速度 / 正方向 / 時間重なり。
一意特定不可なら自動編集せず、候補表示しユーザー選択。

### Aロールトラック全体
UI名称は「Aロールトラック全体」（「シーケンス全体」と表示しない）。
複数クリップ: クリップごとにA/Vペア解決 / 意図的なクリップ間ギャップ維持 /
クリップ内部候補のみ処理 / 累積短縮分だけ後続Aロールを左移動 / 対象外トラック不動。

## 16. 対応・非対応素材

**対応**: 通常のVideoClip/AudioClipTrackItem / ローカル / オンライン / 動画内蔵音声 /
正方向 / 100%速度 / タイムリマップなし / MP4 / MOV / モノラル・ステレオ /
テロップ・Bロール追加前 / 複雑なトランジション・エフェクトなし

**非対応**: 別録り会話音声 / Merged Clip / マルチカメラ / ネスト / 逆再生 / 可変速度 /
タイムリマップ / 100%以外 / オフラインメディア / A/Vペア曖昧 / 複雑なトランジション /
複雑なキーフレーム / 完成済みに近いタイムライン

非対応素材は処理せず、理由を日本語で表示。

## 17. 出力方式（2026-07-12 D-020で改定）

**直接編集のみ。** 開いているシーケンスをその場でカットして左詰めする
（手動のカット+リップル削除と同じ見た目・同じ場所に結果が出る）。

- 複製シーケンス方式・バックアップ複製は**作らない**（オーナー決定。プロジェクトを散らかさない）
- 復元手段はUndo（Ctrl+Z。KazuCutの操作は数個のTransactionとして履歴に積まれる）
- 適用後、カットした各位置へシーケンスマーカー（名前「KazuCut」）を打つ
- 適用前検証（A/Vペア・非対応素材）と適用後検証（配置・A/V同期・対象外トラック不変）は必須のまま
- 適用対象は「解析した時のシーケンス」と一致していること（不一致なら中止し再解析を促す）

## 18. 対象外トラック保護

処理前Snapshot:
```typescript
interface TrackItemSnapshot {
  mediaType: "video" | "audio" | "caption";
  trackIndex: number;
  projectItemId?: string;
  mediaPathHash?: string;
  name: string;
  startTicks: string;
  endTicks: string;
  inTicks?: string;
  outTicks?: string;
  speed?: number;
  disabled?: boolean;
}
```
処理後比較: TrackItem数 / Track Index / ProjectItem / Start / End / In / Out / Speed / Disabled。
対象外TrackItemが変化していたら成功扱いにしない。

## 19. タイムライン再構築

Razor/Split APIを想定しない。削除対象の逆集合 = Keep Segment:
```typescript
interface KeepSegment {
  id: string;
  sourceInTicks: string;
  sourceOutTicks: string;
  originalSequenceStartTicks: string;
  destinationStartTicks: string;
  durationTicks: string;
}
```

### 戦略A: TrackItem Clone
1. 対象V/A TrackItem記録 → 2. 対象トラック末尾に一時領域確保 → 3. 一時領域が空と確認 →
4. Keep Segmentごとに複製（**`isInsert`は必ず`false`**）→ 5. 複製前後差分で新規TrackItem特定 →
6. In/Out変更 → 7. 一時領域配置 → 8. DOM再取得 → 9. 複製結果検証 → 10. 元Aロール削除 →
11. Keep Segmentを目的位置へ移動 → 12. A/V同期検証 → 13. 対象外トラック検証。
`isInsert=true`へ自動フォールバック禁止。新規TrackItem特定不能なら中止。

Clone時リンク挙動をAPI Probeで確認: Video Clone時にAudioもCloneされるか /
Audio別途Cloneで二重になるか / Link維持 / Move連動 / In/Out連動。
Observed Behaviorで戦略決定。

### 戦略B: Subclip（Aが不成立時）
Keep SegmentごとにSubclip → 専用Bin「KazuCut Generated」→ 作成前後差分でProjectItem特定 →
対象V/AトラックへOverwrite配置 → 元TrackItem削除 → 対象外トラック検証。

### 戦略C: 解析専用（A・B両方不成立時）
無音解析 / フィラー解析 / 候補UI / 再生ヘッド移動 / Marker / JSON出力まで完成。
自動編集完成とは報告せず `BLOCKING_REPORT.md` へ理由記載。

## 20. Mutation と Transaction

- Action生成時は必要に応じ `project.lockedAccess()`、適用は `project.executeTransaction()`
- Mutation後はDOM再取得、古いTrackItem参照を再利用しない
- 複数Transactionを無理に1つへまとめない
- 失敗時は元シーケンスへ戻る / 失敗した複製シーケンスは削除可能なら削除 / 元シーケンス無傷を検証
- Undo名: `KazuCut Local：Aロールを編集`

## 21. 音声デコード（Worker内, Media Foundation）

```cpp
class IAudioDecoder {
public:
    virtual DecodeResult decode(const DecodeRequest& request, std::stop_token stopToken) = 0;
    virtual ~IAudioDecoder() = default;
};
```
初期実装 `MediaFoundationAudioDecoder`、将来 `FFmpegAudioDecoder`（初期版でFFmpeg必須にしない）。

### 21.1 初期化
`CoInitializeEx` / `MFStartup` / RAII / 終了時 `MFShutdown`・`CoUninitialize` /
HRESULT全検査 / エラーを構造化JSONへ。

### 21.2 解析形式
16,000Hz モノラル。VAD用: s16 PCM / 音量解析用: f32 PCM。
巨大PCM一括展開禁止、チャンク処理。

### 21.3 Seek誤差
Seek位置を正確と仮定しない: Sample Timestamp・Duration取得 / 開始前除外 /
Sample途中Crop / 終了後除外 / 100ns Timestamp基準 / Stream Tick処理 /
NULL Sample処理 / Seek誤差ログ。

### 21.4 チャンネル
UI: 自動（初期値）/ 左 / 右 / 平均ミックス / 最大エネルギーチャンネル。
別トラックのBGMは解析しない。

## 22. 無音検出

- フレーム長20ms / ホップ長10ms
- 算出: RMS / dBFS / Peak / VAD / 短時間エネルギー
- ノイズフロア: パーセンタイル / 中央値 / MAD / 外れ値除外 / 上下限Clamp
- 自動しきい値 = ノイズフロア + ノイズマージン。手動しきい値も対応
- ヒステリシス: 無音へ入る=thresholdDb / 発話へ戻る=thresholdDb+hysteresisDb
- VAD: WebRTC VADまたはライセンス・性能確認済み同等実装。感度0(緩)〜3(厳)、初期値2。
  音量とVADが矛盾する場合、標準では発話保護優先
- 後処理: 最小無音時間未満除外 / 短発話島統合 / 近接無音統合 / 小声保護 / 語頭・語尾保護 /
  前後余白 / 最小発話長 / 最小生成クリップ長 / 先頭・末尾無音 / 重複統合 / フレーム境界スナップ

## 23. 無音UI設定

- 無音処理 ON/OFF（初期値ON）
- 処理方法: 完全削除 / 指定時間まで短縮（例: 1,200ms→残90ms=削除1,110ms）
- 残す無音の前後比率: 前40% / 後60%
- 段階処理例: 280ms未満=処理しない / 280〜700ms=110msへ短縮 / 700ms以上=90msへ短縮

## 24. 標準プリセット（全てフィラー削除OFF、全項目変更・保存可能）

| 項目 | 自然 | ショート高速 | 保守的 |
|---|---|---|---|
| 無音処理 | ON | ON | ON |
| フィラー削除 | OFF | OFF | OFF |
| 自動しきい値 | ON | ON | ON |
| ノイズマージン | 6dB | 7dB | 5dB |
| ヒステリシス | 3dB | 3dB | 4dB |
| 最小無音時間 | 450ms | 280ms | 650ms |
| 残す無音 | 160ms | 90ms | 220ms |
| 前余白 | 55ms | 35ms | 80ms |
| 後余白 | 90ms | 60ms | 120ms |
| 近接結合 | 70ms | 55ms | 100ms |
| 最小発話長 | 120ms | 100ms | 150ms |
| VAD | ON | ON | ON |
| VAD感度 | 2 | 2 | 1 |
| 小声保護 | ON | ON | ON |

## 25. フィラー検出

### Provider
```typescript
interface TranscriptProvider {
  readonly id: string;
  readonly displayName: string;
  isAvailable(context: TranscriptContext): Promise<boolean>;
  transcribe(context: TranscriptContext, signal?: AbortSignal): Promise<TranscriptResult>;
}
```
実装: PremiereTranscriptProvider / WhisperCppTranscriptProvider。

### Premiere Transcript
候補API: `Transcript.hasTranscript()` / `Transcript.exportToJSON()`。
JSON Schemaを推測で固定しない。自動適用条件: 単語/Token開始時刻 + 終了時刻 + 元テキスト +
Source時間へ変換可能。Segment時刻のみの場合: 文字数比率推定禁止 / Segment全削除禁止 /
自動選択禁止 / Whisperへフォールバックまたは参考候補表示。

### whisper.cpp
完全ローカル / CPU / CUDA不要 / 通信なし / モデルをGitへ含めない /
モデル未設定でも無音処理可能 / ファイルピッカーでモデル選択 / Persistent Tokenで保存 /
実行時Native Path解決 / モデル存在・サイズ・読込可否検証。
取得: `.\scripts\download-whisper-model.ps1 -Model small`（プラグイン実行中の自動DL禁止）。

### フィラー辞書
- 安全語: えー / ええと / えっと / あー / あのー / うーん / んー
- 文脈依存語（初期状態で自動選択しない）: あの / その / まあ / なんか / こう / やっぱ
- 削除しない例: あの本 / その方法 / まあまあ良い / 何回

### 正規化
Unicode NFKC / 全角半角 / ひらがなカタカナ / 長音 / 波ダッシュ / 句読点 / 空白 /
小書き文字 / 重複母音 / えー=えぇ=ええー / あのー=あの〜。

### 境界補正（Whisper Timestampを絶対視しない）
1. Token正規化 → 2. 複数Token結合 → 3. 辞書照合 → 4. 粗い時刻取得 →
5. 前後音声エネルギー確認 → 6. VAD確認 → 7. 境界補正 → 8. 内容語との密着確認 →
9. 低信頼度なら自動選択しない。
フィラー削除後に残す間: 初期値80ms（UI変更可能）。

## 26. 候補統合

無音とフィラーが重なる場合: 二重削除しない / Unionを計算 / フィラー後の残し間を考慮 /
隣接候補を設定値内で統合 / 極端に短い発話片を残さない / 元Candidate IDをmetadataへ保持。

```typescript
type CandidateReason = "silence" | "filler" | "manual";
interface CutCandidate {
  id: string;
  reason: CandidateReason;
  clipId: string;
  sourceStartTicks: string;
  sourceEndTicks: string;
  sequenceStartTicks: string;
  sequenceEndTicks: string;
  originalDurationMs: number;
  retainedDurationMs: number;
  removalDurationMs: number;
  detectedText?: string;
  confidence?: number;
  selected: boolean;
  warnings: string[];
  metadata: Record<string, string | number | boolean | null>;
}
```

## 27. UI

### メイン画面
```
KazuCut Local
対象: ●選択クリップ ○Aロールトラック全体
映像トラック [V1▼] / 会話音声トラック [A1▼]
プリセット [ショート高速▼]
無音処理 [ON] / 無音の扱い [90msまで短縮▼]
フィラー削除 [OFF]
出力 [複製シーケンスで編集▼]
[解析する]
```
フィラーOFF時: Whisper設定を隠す / モデル警告なし / Transcript未確認。
フィラーON時のみ表示: 文字起こし方式[自動：Premiere優先▼] / ローカルWhisperモデル[未設定/設定済み]。

### 詳細設定（折りたたみ「▶ 詳細設定」）
自動しきい値 / 手動dB / ノイズマージン / ヒステリシス / 最小無音時間 / 残す時間 /
前側余白 / 後側余白 / 近接結合 / 最小発話長 / VAD / VAD感度 / 小声保護 / チャンネル /
先頭無音 / 末尾無音 / 段階処理 / フィラー削除後の間 / フィラー辞書 / CPUスレッド数。

### 進捗
「音声を解析中 42% 現在：無音区間を検出しています [キャンセル]」。UIを停止させない。

### 解析結果（カード/リスト、横長テーブル禁止）
```
14件を検出 / 推定短縮：9.8秒 / 完成予測：44.2秒
☑ 00:02.140 無音 0.61秒 → 0.09秒
☑ 00:06.320 フィラー「えっと」 0.48秒 → 0.08秒
☐ 00:11.730 無音 0.31秒 → 0.09秒
```
候補ごと: 選択ON/OFF / 再生ヘッドを候補開始へ / 候補直前へ / 候補直後へ / 除外 /
開始・終了位置調整（10ms/50msステップ）/ 今回だけ残す時間変更 / 警告表示。
適用時はフレーム境界へスナップし、スナップ後位置を表示。
全体操作: 全選択 / 全解除 / 無音だけ選択 / フィラーだけ選択 / 低信頼度フィラー解除 /
短い候補解除 / 再解析 / 結果破棄。
公式自動再生APIがなければ再生ヘッド移動のみ実装。

### 適用前確認
```
対象：V1 / A1 / 候補：14件 / 推定短縮：9.8秒
このシーケンスを直接カットします（戻す場合はCtrl+Z）
対象外トラック：変更しません
[選択した候補を適用]
```
連打防止。実行中は設定変更禁止。

## 28. 実行後検証

- Aロール: Keep Segment数 / Start / End / In / Out / Duration / Speed / ProjectItem /
  A/V同期差 / 推定短縮時間との差
- 対象外: TrackItem数 / Start / End / In / Out / Track Index / ProjectItem / Speed / Disabled
- 映像同期誤差は原則1フレーム未満。音声はサンプル境界考慮。許容超過は成功扱いにしない。

## 29. 設定保存

保存先 `plugin-data:/`。対象: 現在設定 / プリセット / 無音ON/OFF / フィラーON/OFF /
フィラー辞書 / WhisperモデルPersistent Token / UI状態 / Runtime Capability /
API Probe結果 / 最後のV/Aトラック。Schema Version必須。壊れたJSONでクラッシュしない。

## 30. キャッシュ

キー: mediaPath / fileSize / lastModified / sourceIn / sourceOut / audioStream /
channelMode / decoderVersion / analysisVersion / settingsHash / transcriptProvider / modelHash。
保存候補: 音声特徴量 / ノイズフロア / VAD結果 / Transcript / Candidate。
フィラーOFF時はTranscript・Whisper・フィラー候補キャッシュを作らない。
巨大PCMを無期限保存しない。

## 31. ログ

DEBUG/INFO/WARN/ERROR。記録: Plugin起動 / Premiere・Addon・Workerバージョン /
Worker起動終了 / 実行アーキテクチャ / API Probe / MF / 解析設定 / フィラーON/OFF /
Candidate数 / Cache Hit / Timeline Strategy / Transaction / Validation / キャンセル /
Workerクラッシュ / 処理時間 / Whisper RTF。
ユーザー名マスク（`C:\Users\<USER>\...`）。ローテーション: 1ファイル5MB・最大5世代。

## 32. エラー

```typescript
interface KazuCutError {
  code: string;
  userMessage: string;       // 日本語で具体的に
  developerMessage: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
}
```
コード: NO_ACTIVE_PROJECT / NO_ACTIVE_SEQUENCE / NO_TARGET_VIDEO_TRACK /
NO_TARGET_AUDIO_TRACK / NO_SELECTED_CLIP / AMBIGUOUS_AUDIO_PAIR / MEDIA_OFFLINE /
MEDIA_NOT_FOUND / UNSUPPORTED_SPEED / UNSUPPORTED_REVERSE / UNSUPPORTED_TIME_REMAP /
UNSUPPORTED_NEST / UNSUPPORTED_MULTICAM / UNSUPPORTED_MERGED_CLIP /
UNSUPPORTED_EFFECTED_CLIP / NATIVE_ADDON_NOT_LOADED / WORKER_NOT_FOUND /
WORKER_START_FAILED / WORKER_CRASHED / WORKER_PROTOCOL_ERROR / WORKER_TIMEOUT /
AUDIO_STREAM_NOT_FOUND / AUDIO_DECODE_FAILED / AUDIO_SEEK_FAILED / TRANSCRIPT_NOT_FOUND /
TRANSCRIPT_SCHEMA_UNSUPPORTED / TRANSCRIPT_HAS_NO_WORD_TIMINGS / WHISPER_MODEL_NOT_FOUND /
WHISPER_FAILED / SEQUENCE_CLONE_FAILED / CLONED_SEQUENCE_NOT_IDENTIFIED /
TRACK_ITEM_CLONE_FAILED / TRACK_ITEM_MAPPING_FAILED / TIMELINE_REBUILD_FAILED /
NON_TARGET_TRACK_CHANGED / SYNC_VALIDATION_FAILED / BACKUP_SEQUENCE_FAILED / CANCELLED。

## 33. テスト範囲

- **TS**: フィラー初期値OFF / OFF時Provider未呼出 / 設定検証 / プリセット / Tick処理 /
  Candidate統合 / 無音フィラー重複 / Edit Plan / Keep Segment / A/V Pair Resolver /
  Snapshot比較 / Transcript Parser / 日本語正規化 / Cache Key / Job Polling /
  Worker Error / キャンセル
- **Addon**: Workerパス / 起動 / 任意EXE不起動 / 日本語・スペースパス / IPC / 不正JSON /
  Worker途中終了 / Job Object / Premiere終了時Worker終了 / 多重ジョブ / キャンセル /
  dispose / フォールバック方式
- **Worker**: MF初期化 / WAV / MP3 / MP4 AAC / MOV AAC / Seek誤差 / Timestamp Crop /
  16kHzリサンプル / モノラル / 左右ch / 完全無音 / 一定ノイズ / 小声 / 500ms無音 /
  100ms無音 / ヒステリシス / VAD / クリッピング / キャンセル / Whisperモデルなし /
  不正モデル / フィラー検出
- **Premiere Mock**: Projectなし / Sequenceなし / Selectionなし / V1A1正常 / A2 BGM /
  V2ガイド / 音声候補複数 / Offline / Speed変更 / Reverse / Nest / Multicam / Clone失敗 /
  Transaction失敗 / 対象外Track変化 / A/V同期誤差 / Audio二重Clone防止 /
  直接編集バックアップ失敗

Mock成功だけで実機成功としない。手動実機テストは `MANUAL_TEST_CHECKLIST.md`。

## 34. 実素材評価（tools/evaluate/）

入力: 動画 / 正解区間JSON / KazuCut結果JSON / Premiere標準機能の結果JSON。
出力: Precision / Recall / F1 / 誤検出 / 見逃し / 境界誤差 / 総短縮時間 /
フィラーPrecision・Recall / 処理時間 / RTF / プリセット比較。CSVとHTML生成。

## 35. スクリプト

- `doctor.ps1`: Windows x64 / Premiere 26.3.0 / UXP Developer Tool / Developer Mode / Node / npm / Git /
  CMake / VS2022 / MSVC / Windows SDK / Hybrid SDK / whisper.cpp / モデル確認
- `bootstrap.ps1`: npm install / CMake準備 / フォルダ / Hybrid SDK確認 / whisper.cpp準備 / 初期設定
- `build.ps1`: TS型チェック / ESLint / UXP Build / Worker Build / Addon Build /
  Unit・Integration Test / Manifest検証 / 配布フォルダ
- `prepare-dist.ps1`: UXP Developer Toolで読み込めるPlugin Folder生成。独自ZIPでCCXを作らない。
  最終CCXはUXP Developer ToolのPackage機能。

## 36. ライセンス

依存のバージョン/Commit固定: whisper.cpp / VAD / JSONライブラリ / Catch2 or GoogleTest /
TypeScript / Vitest / ESLint。`THIRD_PARTY_NOTICES.md` へ
バージョン / Commit Hash / ライセンス / 使用目的 / 配布ファイル / ビルド方法を記録。

## 37. 禁止事項

ExtendScript主方式 / CEP / Manifest v5 / `addons/win/x64`配置 /
Worker実証前の外部プロセス方式確定 / JSスレッドで重い処理 / Addon関数内長時間同期 /
WorkerからPremiere DOM操作 / 任意ユーザーEXE起動 / Shell経由Worker起動 / Seek絶対視 /
TickをNumberだけで扱う / Sequence名前特定 / Clone TrackItem推測特定 / `isInsert=true` /
対象外トラックRipple / BGM・ガイド移動 / トラックロック依存 / バックアップなし直接編集 /
100%以外の黙認処理 / 曖昧A/Vペア処理 / フィラーOFF時Whisper初期化 / 文字数比率時刻推定 /
Whisper Timestamp絶対視 / 文脈依存フィラー無確認削除 / クラウド送信 / テレメトリー /
APIキー / `eval` / 空catch / 巨大PCM一括展開 / モデルGit格納 / ユーザーメディア書換 /
未動作機能を実装済みと記載 / 不正CCX / 不要サブエージェント大量起動。

## 38. 完成条件

- **Plugin**: Premiere 26.3.0でパネル表示 / 日本語UI / Addonロード / 採用方式動作 /
  UI停止なし / キャンセル可能 / Native異常でPremiere不落 / Premiere終了後Worker残留なし
- **Premiere連携**: Active Sequence取得 / V/A選択 / 選択クリップ解析 / トラック全体解析 /
  複製 / Clone特定 / A/V同期 / BGM・ガイド不変 / Candidate適用 / 適用後検証 /
  直接編集バックアップ / 失敗時安全停止
- **無音**: ON/OFF / 自動・手動しきい値 / ノイズフロア / ヒステリシス / VAD / 小声保護 /
  完全削除 / 短縮 / 前後余白 / 候補確認 / 個別選択
- **フィラー**: 初期値OFF / OFF時未実行 / Premiere Transcript優先 / Word Timing検証 /
  日本語正規化 / 安全語 / 文脈依存語 / 個別選択 / whisper.cpp CPU / モデル未設定安全 / 削除後の間
- **品質**: TS型エラー0 / ESLint重大エラー0 / Worker・Addonコンパイル成功 /
  Unit・Integration Test成功 / API Probe完成 / README・THIRD_PARTY_NOTICES完成 /
  未処理例外なし / 重大TODOなし

**Premiere実機またはHybrid SDKが利用できない項目は未検証と明記する。**

## 39. 最終報告（FINAL_REPORT.md）

実装済み / 未実装 / 実機検証済み / Mockのみ / ビルド結果 / テスト結果 / API Probe結果 /
採用アーキテクチャ / 採用Timeline Strategy / MF検証 / Transcript JSON検証 /
フィラーOFF検証 / Worker・Native Thread検証 / Known Issues / 手動作業 / Plugin Folder /
UXP Developer Tool読み込み手順 / 次に実行するコマンド。問題を隠さず技術的理由を記載。
