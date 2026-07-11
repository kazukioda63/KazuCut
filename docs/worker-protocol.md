# Worker Protocol

Addon ⇔ KazuCutWorker.exe のIPC仕様（実装: worker/src/main.cpp, addon/src/job_manager.cpp）。

## 起動

```
KazuCutWorker.exe --job-stdin        # Addonからの標準起動（stdin先頭行=リクエスト）
KazuCutWorker.exe --job <file>       # ファイル経由（CLI/テスト用。--watch-stdinで監視追加）
KazuCutWorker.exe --version
```

- CreateProcessW / lpApplicationName=絶対パス / Shell経由禁止
- リクエストは改行なし1行のUTF-8 JSON（上限8MB）

## リクエスト

```json
{"type":"test","jobId":"...","durationMs":3000,"payload":"..."}
{"type":"analyze","jobId":"...","mediaPath":"C:\\...\\a.mp4",
 "sourceInTicks":"0","sourceOutTicks":"2540160000000","audioStreamIndex":0,
 "silence":{ ...SilenceSettings... },
 "filler":{ "modelPath":"...", ... }   ← フィラーON時のみ存在（ADR-006）
}
```

## 応答（stdout, JSON Lines）

```json
{"type":"started","jobId":"..."}
{"type":"progress","jobId":"...","progress":0.42,"stage":"silence"}
{"type":"result","jobId":"...","result":{"silence":{"intervals":[{"startMs":1035,"endMs":1440}],
  "noiseFloorDb":-48.9,"thresholdDb":-41.9,"totalDurationMs":2500},
  "seekErrorHns":0,"fillerAnalyzed":false}}
{"type":"error","jobId":"...","error":{"code":"...","developerMessage":"..."}}
{"type":"cancelled","jobId":"..."}
```

stage: starting | decode | silence | transcript | filler | finalize

## キャンセル・生存管理

- Addon→Worker: stdinへ `{"type":"cancel"}` → 3秒待機 → TerminateProcess
- stdinクローズ（親死亡）→ Workerは自己終了（終了コード2）
- Addon側Job Object（KILL_ON_JOB_CLOSE）で二重に孤児防止

## 終了コード

0=正常 / 1=エラー / 2=キャンセル

## エラー処理義務（双方）

不正JSON / 途中切断 / 強制終了 / タイムアウト / jobId重複 / 過大メッセージ。
検証済み: Worker側はLinuxで実プロセステスト済み。Addon側はWindows実機待ち。
