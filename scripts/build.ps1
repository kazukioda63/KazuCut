# フルビルド: UXP → Worker → Addon → テスト → 配布フォルダ
$ErrorActionPreference = "Stop"
& "$PSScriptRoot\build-uxp.ps1"
& "$PSScriptRoot\build-worker.ps1"
try {
    & "$PSScriptRoot\build-addon.ps1"
} catch {
    Write-Host "Addonビルドをスキップ（SDK未配置）: $_" -ForegroundColor Yellow
    Write-Host "SDK配置後に .\scripts\build-addon.ps1 を実行してください" -ForegroundColor Yellow
}
& "$PSScriptRoot\test.ps1"
& "$PSScriptRoot\prepare-dist.ps1"
Write-Host "`nフルビルド完了" -ForegroundColor Green
