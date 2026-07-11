# REFERENCES

一次情報の調査記録。実機Probe結果は `docs/api-probe.md` と
`plugin-data:/diagnostics/api-probe.json` に追記する。

## UXP Hybrid Plugins (Premiere Pro)

- 公式資料:
  - https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/
  - https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/build
  - https://blog.developer.adobe.com/en/publish/2026/04/uxp-hybrid-plugins-now-available-for-premiere
- 確認日: 2026-07-11
- 対応バージョン: Premiere Pro 26.2以降（本製品は26.3.0対象）
- 確認事項:
  - Hybrid Plugin SDKはAdobe Developer Consoleの専用カードからダウンロード（要Adobeアカウント）
  - SDKヘッダー: `UxpAddonTypes.h`（基本型）/ `UxpAddonShared.h`（API全面）/
    `UxpAddon.h`（`UXP_ADDON_INIT` / `UXP_ADDON_TERMINATE` マクロ）
  - Addon APIはNode-API（napi）に意図的に類似した設計
  - Windows/macOS両対応のビルドテンプレート同梱
- 不明点（実機・SDK取得後に確認）:
  - AddonからのCreateProcessW可否、CCX内EXE実行可否、パッケージ後のWorkerパス解決
  - manifest `addon` エントリの正確なスキーマ（配置パス含む）
- API Probe結果: 未実施（Windows実機必要）

## Premiere UXP API — Sequence

- 公式資料: https://developer.adobe.com/premiere-pro/uxp/ppro_reference/classes/sequence/
- 確認日: 2026-07-11 / 対応: 25.6以降（setSelectionは26.3で同期化）
- 確認済みシグネチャ:
  - `guid: Guid`（読み取り専用）/ `name: string`
  - `getVideoTrack(trackIndex: number): Promise<VideoTrack>`
  - `getAudioTrack(trackIndex: number): Promise<AudioTrack>`
  - `getVideoTrackCount(): Promise<number>` / `getAudioTrackCount(): Promise<number>`
  - `getSelection(): Promise<TrackItemSelection>` / `setSelection(sel): boolean`
  - `getPlayerPosition(): Promise<TickTime>` / `setPlayerPosition(t): Promise<boolean>`
  - `createSubsequence(ignoreTrackTargeting: boolean): Promise<Sequence>`
  - `createCloneAction(): Action`
- 注意: ドキュメント上に `createRemoveItemsAction` は見当たらない。
  TrackItem削除系のAction名は実機Probeで確認する。
- 不明点: createCloneActionが「シーケンス複製」なのか確認要。複製後のSequence特定方法。

## Premiere UXP API — TickTime

- 公式資料: https://developer.adobe.com/premiere-pro/uxp/ppro_reference/classes/ticktime/
- 確認日: 2026-07-11
- 確認済み:
  - static: `createWithTicks(ticks: string)` / `createWithSeconds(seconds)` /
    `createWithFrameAndFrameRate(frameCount, frameRate)`
  - props: `ticks: string` / `ticksNumber: number` / `seconds: number`（全て読み取り専用）
  - methods: `add` / `subtract` / `multiply` / `divide` / `alignToFrame(frameRate)` /
    `alignToNearestFrame(frameRate)` / `equals`
- 設計への反映: Premiere境界では `ticks`（文字列）を使用。`ticksNumber` は
  2^53超で精度喪失の恐れがあるため最終編集位置には使用しない。
  1 tick = 1/254016000000 秒（254,016,000,000 ticks/秒）は実機Probeで検証する。

## Premiere UXP API — VideoClipTrackItem / TrackItem

- 公式資料: https://developer.adobe.com/premiere-pro/uxp/ppro_reference/classes/videocliptrackitem/
- 確認日: 2026-07-11（ページ存在確認のみ。全メソッドは実機Probeで確認）
- 参考: https://github.com/AdobeDocs/uxp-premiere-pro-samples（公式サンプル。
  sample-panels/premiere-api に types.d.ts あり）
- 不明点: Clone時のリンクAudio挙動 / createMoveAction / In・Out変更Action /
  Speed・Reverse取得 / ProjectItem取得。全て実機Probe対象。

## Windows Media Foundation (Source Reader)

- 公式資料: https://learn.microsoft.com/en-us/windows/win32/medfound/source-reader
- 確認日: 2026-07-11（既知仕様の整理。ビルド検証はWindows実機待ち）
- 使用予定: `MFCreateSourceReaderFromURL` / `IMFSourceReader::SetCurrentMediaType`
  （PCM 16kHz mono出力指定）/ `ReadSample` / `SetCurrentPosition`（Seek、誤差あり前提）/
  `IMFSample::GetSampleTime` / `GetSampleDuration`（100ns単位）
- 注意: Seekはキーフレーム単位で不正確 → Sample Timestampで前後Crop（仕様21.3）

## whisper.cpp

- 公式: https://github.com/ggml-org/whisper.cpp（MITライセンス）
- 確認日: 2026-07-11
- 方針: CMakeオプション `KAZUCUT_ENABLE_WHISPER` で有効化、Commit固定で
  FetchContentまたはサブモジュール。CPU (AVX2) ビルド。モデルはggml形式
  （small推奨、`download-whisper-model.ps1`で取得）。
- 未検証: Windowsビルド・日本語Timestamp精度（実機評価待ち）

## UXP Manifest v6 / plugin-data

- 公式資料: https://developer.adobe.com/premiere-pro/uxp/plugins/
- 確認日: 2026-07-11
- `plugin-data:/` スキームは設定保存先として使用。実機で書込可否をProbeする。
