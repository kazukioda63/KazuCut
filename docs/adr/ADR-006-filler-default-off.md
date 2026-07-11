# ADR-006: フィラー削除の初期値OFF

- Status: Accepted
- Date: 2026-07-11

## Decision

フィラー削除は初期値OFF。標準プリセット（自然/ショート高速/保守的）は全てOFF。
ONを復元するのはユーザーがONで保存したカスタムプリセットのみ。

OFF時に一切実行しないこと（仕様4.2）:
Transcript有無確認 / Transcript JSON出力 / whisper.cpp初期化 / モデル読込 /
音声認識 / 辞書照合 / フィラー候補生成 / フィラー関連キャッシュ / モデル未設定警告。

## 実装上の強制

- 解析パイプラインの入口（`analysisController`）で `fillerEnabled` を分岐し、
  OFFなら transcript モジュールを **import後も一切呼ばない**。
  WorkerへのジョブリクエストJSONにも `filler` セクション自体を含めない。
- Worker側も `filler` セクション不在ならWhisper関連の初期化コードへ到達しない。
- UIはOFF時にWhisper設定を非表示、モデル警告も出さない。
- ユニットテストで「OFF時にProviderのメソッドが1度も呼ばれない」ことをspyで検証。

理由: フィラー解析はWhisperロードで数百MBのメモリと長い待ち時間を発生させる。
ユーザーの通常フローは無音処理のみであり、意図しないコストと誤削除リスクを排除する。
