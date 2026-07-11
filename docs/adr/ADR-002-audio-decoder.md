# ADR-002: 音声デコーダとVAD

- Status: Accepted（MF実装の実機検証は未了）
- Date: 2026-07-11

## Decision

1. デコーダは `IAudioDecoder` 抽象（`decode(request, stop_token)`）。
2. 本番実装は `MediaFoundationAudioDecoder`（Windows専用、Source Reader使用、
   RAIIで CoInitializeEx/MFStartup/MFShutdown/CoUninitialize、HRESULT全検査）。
3. テスト・開発用に `WavFileDecoder`（移植可能、PCM WAVのみ）を実装し、
   解析エンジンのユニットテストをLinuxでも実行可能にする。
4. FFmpegは初期版で必須にしない（将来 `FFmpegAudioDecoder` 追加余地のみ確保）。
5. 出力: 16kHz mono。VAD用s16 / 音量解析用f32。チャンクストリーミング
   （コールバック渡し）で巨大PCM一括展開を禁止。
6. Seekは不正確前提: Sample Timestamp/Durationで前後Crop、誤差をログ。

## VAD

WebRTC VADのベンダリングは初期版では行わず、**自己実装のエネルギーベースVAD**
（短時間エネルギー + ゼロ交差率 + ハングオーバー、感度0〜3）を使用する。

理由: 依存最小化・全プラットフォームでテスト可能・本製品の主判定は
dBFSしきい値+ヒステリシスでありVADは発話保護の補助である。
音量とVADが矛盾する場合は発話保護優先（仕様22）。

リスク: WebRTC VAD (GMMベース) より小声・ノイズ環境での精度が劣る可能性。
→ tools/evaluate の実素材評価でRecallが不足する場合、WebRTC VAD
(BSD-3-Clause, libfvadなど) のベンダリングへ切替える。この判断は評価後に本ADRを更新。
