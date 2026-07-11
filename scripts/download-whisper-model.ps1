# Whisperモデル（ggml形式）の取得。プラグイン実行中の自動ダウンロードは行わない（仕様25章）。
param(
    [ValidateSet("tiny", "base", "small", "medium")]
    [string]$Model = "small"
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$dest = "$root\models\ggml-$Model.bin"
if (Test-Path $dest) {
    Write-Host "既に存在します: $dest"
    exit 0
}
$url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$Model.bin"
Write-Host "ダウンロード中: $url"
Invoke-WebRequest -Uri $url -OutFile $dest
$size = (Get-Item $dest).Length
if ($size -lt 1MB) { Remove-Item $dest; throw "ダウンロードされたファイルが小さすぎます" }
Write-Host "完了: $dest ($([math]::Round($size/1MB))MB)" -ForegroundColor Green
Write-Host "パネルの「Whisperモデル → 選択...」でこのファイルを指定してください。"
