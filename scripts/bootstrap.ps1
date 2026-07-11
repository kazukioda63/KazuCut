# 初期セットアップ: npm install / フォルダ準備 / SDK確認
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
Push-Location $root
try {
    Write-Host "== npm install =="
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm installに失敗しました" }

    Write-Host "== フォルダ準備 =="
    foreach ($d in @("build", "plugin\dist", "plugin\win\x64", "models")) {
        New-Item -ItemType Directory -Force -Path (Join-Path $root $d) | Out-Null
    }

    Write-Host "== 環境診断 =="
    & "$PSScriptRoot\doctor.ps1"
} finally {
    Pop-Location
}
