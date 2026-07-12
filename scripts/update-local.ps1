# ローカルのプラグインフォルダをGitHubの最新版へ更新する。
# 使い方（管理者PowerShell推奨。Program Files配下の場合は必須）:
#   irm https://raw.githubusercontent.com/kazukioda63/KazuCut/claude/kazucut-local-premiere-r7craw/scripts/update-local.ps1 | iex
# 別の場所に置いている場合:
#   & .\update-local.ps1 -Target "D:\KazuCut"
param(
    [string]$Target = "C:\Program Files\KazuCut\KazuCut-claude-kazucut-local-premiere-r7craw"
)
$ErrorActionPreference = "Stop"
$base = "https://raw.githubusercontent.com/kazukioda63/KazuCut/claude/kazucut-local-premiere-r7craw"

if (-not (Test-Path "$Target\plugin")) {
    Write-Host "エラー: $Target\plugin が見つかりません。-Target で場所を指定してください。" -ForegroundColor Red
    exit 1
}

$files = @(
    @{ url = "$base/plugin/index.html";                    dest = "$Target\plugin\index.html" },
    @{ url = "$base/plugin/dist/main.js";                  dest = "$Target\plugin\dist\main.js" },
    @{ url = "$base/plugin/manifest.json";                 dest = "$Target\plugin\manifest.json" },
    @{ url = "$base/plugin/win/x64/kazucut-native.uxpaddon"; dest = "$Target\plugin\win\x64\kazucut-native.uxpaddon" },
    @{ url = "$base/plugin/win/x64/KazuCutWorker.exe";     dest = "$Target\plugin\win\x64\KazuCutWorker.exe" }
)
foreach ($f in $files) {
    New-Item -ItemType Directory -Force -Path (Split-Path $f.dest) | Out-Null
    Invoke-WebRequest -Uri $f.url -OutFile $f.dest
    Write-Host "更新: $($f.dest)"
}

$buildId = Select-String -Path "$Target\plugin\dist\main.js" -Pattern '__KAZUCUT_BUILD__|build \d{8}T\d{4}' -Quiet
$match = Select-String -Path "$Target\plugin\dist\main.js" -Pattern '\d{8}T\d{4}' | Select-Object -First 1
if ($match) {
    Write-Host "`n完了。ビルドID: $($match.Matches[0].Value)" -ForegroundColor Green
} else {
    Write-Host "`n完了（ビルドID不明）" -ForegroundColor Yellow
}
Write-Host "UXP Developer Toolでプラグインを Unload → Load して反映してください。"
