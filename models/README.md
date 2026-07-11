# models/

Whisperモデル（ggml形式）の置き場所。**モデルはGitへコミットしない**（.gitignore済み）。

取得（フィラー削除を使う場合のみ必要。無音処理には不要）:

```powershell
.\scripts\download-whisper-model.ps1 -Model small
```

パネルの「フィラー削除 ON → Whisperモデル → 選択...」で
`models\ggml-small.bin` を指定する。
