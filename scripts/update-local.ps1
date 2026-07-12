# ローカルのプラグインフォルダをGitHubの最新版へ更新する。
# 使い方:
#   irm https://raw.githubusercontent.com/kazukioda63/KazuCut/claude/kazucut-local-premiere-r7craw/scripts/update-local.ps1 | iex
# 注意: iexで実行されるため exit は使わない（呼び出し元のシェルが終了してしまう）
param(
    [string]$Target = ""
)
$ErrorActionPreference = "Continue"
$base = "https://raw.githubusercontent.com/kazukioda63/KazuCut/claude/kazucut-local-premiere-r7craw"

# --- プラグインフォルダの自動探索 ---
$candidates = @()
if ($Target) { $candidates += $Target }
$candidates += @(
    "C:\Program Files\KazuCut\KazuCut-claude-kazucut-local-premiere-r7craw",
    "$env:USERPROFILE\KazuCut",
    "$env:USERPROFILE\KazuCut-claude-kazucut-local-premiere-r7craw",
    "$env:USERPROFILE\Desktop\KazuCut",
    "$env:USERPROFILE\Desktop\KazuCut-claude-kazucut-local-premiere-r7craw",
    "$env:USERPROFILE\Downloads\KazuCut-claude-kazucut-local-premiere-r7craw",
    "$env:USERPROFILE\Documents\KazuCut"
)
$found = $null
foreach ($c in $candidates) {
    if ($c -and (Test-Path "$c\plugin\manifest.json")) { $found = $c; break }
}
if (-not $found) {
    Write-Host "プラグインフォルダが自動で見つかりませんでした。" -ForegroundColor Yellow
    Write-Host "（探した場所: $($candidates -join ' / ')）"
    $manual = Read-Host "KazuCutフォルダのパスを入力してください（中にpluginフォルダがある場所）"
    if ($manual -and (Test-Path "$manual\plugin\manifest.json")) {
        $found = $manual
    } else {
        Write-Host "そこにも plugin\manifest.json がありません。中断します。" -ForegroundColor Red
        return
    }
}
Write-Host "更新対象: $found" -ForegroundColor Cyan

# --- 書き込み権限チェック（Program Files配下で非管理者だとここで分かる） ---
try {
    $probe = "$found\plugin\.write-test"
    Set-Content -Path $probe -Value "test" -ErrorAction Stop
    Remove-Item $probe -ErrorAction SilentlyContinue
} catch {
    Write-Host "このフォルダへ書き込めません（アクセス拒否）。" -ForegroundColor Red
    Write-Host "PowerShellを右クリック→「管理者として実行」で開き直すか、" -ForegroundColor Yellow
    Write-Host "フォルダを $env:USERPROFILE\KazuCut など書き込める場所へ移動してください。" -ForegroundColor Yellow
    return
}

# --- ダウンロード ---
$files = @(
    @{ url = "$base/plugin/index.html";                      dest = "$found\plugin\index.html" },
    @{ url = "$base/plugin/dist/main.js";                    dest = "$found\plugin\dist\main.js" },
    @{ url = "$base/plugin/manifest.json";                   dest = "$found\plugin\manifest.json" },
    @{ url = "$base/plugin/win/x64/kazucut-native.uxpaddon"; dest = "$found\plugin\win\x64\kazucut-native.uxpaddon" },
    @{ url = "$base/plugin/win/x64/KazuCutWorker.exe";       dest = "$found\plugin\win\x64\KazuCutWorker.exe" }
)
$failed = $false
foreach ($f in $files) {
    try {
        New-Item -ItemType Directory -Force -Path (Split-Path $f.dest) | Out-Null
        Invoke-WebRequest -Uri $f.url -OutFile $f.dest -ErrorAction Stop
        Write-Host "更新: $($f.dest)"
    } catch {
        Write-Host "失敗: $($f.dest) — $($_.Exception.Message)" -ForegroundColor Red
        $failed = $true
    }
}
if ($failed) {
    Write-Host "`n一部のファイルを更新できませんでした。上の赤いメッセージを報告してください。" -ForegroundColor Red
    return
}

$match = Select-String -Path "$found\plugin\dist\main.js" -Pattern '\d{8}T\d{4}' | Select-Object -First 1
if ($match) {
    Write-Host "`n完了。ビルドID: $($match.Matches[0].Value)" -ForegroundColor Green
}
Write-Host "UXP Developer Toolでプラグインを Unload → Load して反映してください。"
