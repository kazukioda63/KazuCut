# ローカルのプラグインフォルダをGitHubの最新版へ更新する。
# 使い方:
#   irm https://raw.githubusercontent.com/kazukioda63/KazuCut/claude/kazucut-local-premiere-r7craw/scripts/update-local.ps1 | iex
# 注意: iexで実行されるため exit は使わない（呼び出し元のシェルが終了してしまう）
param(
    [string]$Target = ""
)
$ErrorActionPreference = "Continue"
$branch = "claude/kazucut-local-premiere-r7craw"

# すべての表示をデスクトップのログへも記録する（ウィンドウが閉じても読めるように）
$logPath = "$env:USERPROFILE\Desktop\kazucut-update.log"
try { Start-Transcript -Path $logPath -Force | Out-Null } catch { }
Write-Host "ログ: $logPath"

# raw.githubusercontent.comはブランチURLだと約5分CDNキャッシュされ、
# プッシュ直後の更新で古いファイルが落ちてくる。
# 最新コミットSHAを取得し、キャッシュと無関係な固定URLからダウンロードする。
$sha = $null
try {
    $commit = Invoke-RestMethod -Uri "https://api.github.com/repos/kazukioda63/KazuCut/commits/$([uri]::EscapeDataString($branch))" -TimeoutSec 15
    $sha = $commit.sha
} catch { }
if ($sha) {
    $base = "https://raw.githubusercontent.com/kazukioda63/KazuCut/$sha"
    Write-Host "最新コミット: $($sha.Substring(0,8))"
} else {
    $base = "https://raw.githubusercontent.com/kazukioda63/KazuCut/$branch"
    Write-Host "注意: 最新コミットを取得できず、ブランチURLを使用します（最大5分古い可能性）" -ForegroundColor Yellow
}

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
        try { Stop-Transcript | Out-Null } catch { }
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
    try { Stop-Transcript | Out-Null } catch { }
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
$lockedBinaries = @()
foreach ($f in $files) {
    try {
        New-Item -ItemType Directory -Force -Path (Split-Path $f.dest) | Out-Null
        Invoke-WebRequest -Uri $f.url -OutFile $f.dest -ErrorAction Stop
        Write-Host "更新: $($f.dest)"
    } catch {
        $isBinary = $f.dest -match "\\win\\x64\\"
        $isLocked = $_.Exception.Message -match "別のプロセス|being used by another process"
        if ($isBinary -and $isLocked) {
            # Premiere起動中はネイティブバイナリを上書きできない。
            # バイナリに変更がないリリースでは問題ないため警告扱いにする
            Write-Host "スキップ: $($f.dest)（Premiere起動中のためロック）" -ForegroundColor Yellow
            $lockedBinaries += (Split-Path $f.dest -Leaf)
        } else {
            Write-Host "失敗: $($f.dest) — $($_.Exception.Message)" -ForegroundColor Red
            $failed = $true
        }
    }
}
if ($failed) {
    Write-Host "`n一部のファイルを更新できませんでした。上の赤いメッセージを報告してください。" -ForegroundColor Red
    try { Stop-Transcript | Out-Null } catch { }
    return
}
if ($lockedBinaries.Count -gt 0) {
    Write-Host "`n注意: $($lockedBinaries -join ', ') はPremiere起動中のため更新されていません。" -ForegroundColor Yellow
    Write-Host "「バイナリも更新して」と指示された場合はPremiereを終了して再実行してください。" -ForegroundColor Yellow
}

$match = Select-String -Path "$found\plugin\dist\main.js" -Pattern '\d{8}T\d{4}' | Select-Object -First 1
if ($match) {
    Write-Host "`n完了。ビルドID: $($match.Matches[0].Value)" -ForegroundColor Green
}
Write-Host "UXP Developer Toolでプラグインを Unload → Load して反映してください。"
try { Stop-Transcript | Out-Null } catch { }
