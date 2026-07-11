# UXP Developer Toolで読み込めるPlugin Folderを生成する。
# 注意: 独自ZIPでCCXは作らない。最終CCXはUXP Developer ToolのPackage機能を使用（仕様35章）。
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$dist = "$root\build\dist\KazuCutLocal"

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$dist\dist", "$dist\icons", "$dist\win\x64" | Out-Null

Copy-Item "$root\plugin\manifest.json" $dist
Copy-Item "$root\plugin\index.html" $dist
Copy-Item "$root\plugin\dist\main.js" "$dist\dist\"
Copy-Item "$root\plugin\icons\*" "$dist\icons\" -ErrorAction SilentlyContinue

# manifest検証（最低限）
$manifest = Get-Content "$dist\manifest.json" -Raw | ConvertFrom-Json
if ($manifest.manifestVersion -lt 6) { throw "manifestVersionは6以上が必要です" }
if ($manifest.id -ne "com.kazu.premiere.kazucutlocal") { throw "Plugin IDが不正です" }

# Nativeバイナリ（存在する場合のみ）
$missing = @()
foreach ($f in @("kazucut-native.uxpaddon", "KazuCutWorker.exe")) {
    $src = "$root\plugin\win\x64\$f"
    if (Test-Path $src) { Copy-Item $src "$dist\win\x64\" }
    else { $missing += $f }
}
if ($missing.Count -gt 0) {
    Write-Host "警告: Nativeバイナリ未ビルド: $($missing -join ', ')" -ForegroundColor Yellow
    Write-Host "この状態のPlugin FolderはUIのみ動作します（Mockモード）" -ForegroundColor Yellow
}

Write-Host "`nPlugin Folder: $dist" -ForegroundColor Green
Write-Host "UXP Developer Tool → Add Plugin → 上記フォルダのmanifest.jsonを指定 → Load"
