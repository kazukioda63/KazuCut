# 開発用: ビルド→Plugin Folder生成→UDT起動案内
$ErrorActionPreference = "Stop"
& "$PSScriptRoot\build.ps1"
$udt = "$env:LOCALAPPDATA\Programs\Adobe UXP Developer Tools\Adobe UXP Developer Tool.exe"
if (Test-Path $udt) {
    Write-Host "UXP Developer Toolを起動します..."
    Start-Process $udt
} else {
    Write-Host "UXP Developer Toolが見つかりません。Creative Cloudからインストールしてください。" -ForegroundColor Yellow
}
Write-Host @"

手順:
1. Premiere Pro を起動し Developer Mode を有効化
2. UDT → Add Plugin → build\dist\KazuCutLocal\manifest.json
3. Load でパネルを読み込み
"@
