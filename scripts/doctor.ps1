# KazuCut Local 開発環境診断
$ErrorActionPreference = "Continue"
$results = @()

function Check($name, [scriptblock]$test) {
    try {
        $value = & $test
        if ($value) { $script:results += [pscustomobject]@{ 項目=$name; 状態="OK"; 詳細=$value } }
        else { $script:results += [pscustomobject]@{ 項目=$name; 状態="NG"; 詳細="見つかりません" } }
    } catch {
        $script:results += [pscustomobject]@{ 項目=$name; 状態="NG"; 詳細=$_.Exception.Message }
    }
}

Check "Windows x64" {
    if ([Environment]::Is64BitOperatingSystem -and $env:OS -eq "Windows_NT") { "x64" } else { $null }
}
Check "Node.js" { (node --version) 2>$null }
Check "npm" { (npm --version) 2>$null }
Check "Git" { (git --version) 2>$null }
Check "CMake" { ((cmake --version) 2>$null | Select-Object -First 1) }
Check "Visual Studio 2022 (MSVC)" {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        & $vswhere -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName
    } else { $null }
}
Check "Windows SDK" {
    $kits = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Microsoft SDKs\Windows\v10.0"
    if (Test-Path $kits) { (Get-ItemProperty $kits).ProductVersion } else { $null }
}
Check "Premiere Pro 26.x" {
    $paths = @(
        "$env:ProgramFiles\Adobe\Adobe Premiere Pro 2026\Adobe Premiere Pro.exe",
        "$env:ProgramFiles\Adobe\Adobe Premiere Pro 26.0\Adobe Premiere Pro.exe"
    )
    $found = $paths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($found) { (Get-Item $found).VersionInfo.ProductVersion } else { $null }
}
Check "UXP Developer Tool" {
    $udt = "$env:LOCALAPPDATA\Programs\Adobe UXP Developer Tools\Adobe UXP Developer Tool.exe"
    if (Test-Path $udt) { "インストール済み" } else { $null }
}
Check "UXP Hybrid Plugin SDK" {
    $candidates = @(
        $env:ADOBE_UXP_HYBRID_SDK,
        "C:\Adobe\UXPHybridSDK",
        "C:\SDK\AdobeUXPHybrid",
        "$env:USERPROFILE\AdobeUXPHybridSDK"
    ) | Where-Object { $_ }
    foreach ($c in $candidates) {
        if (Test-Path $c) {
            $header = Get-ChildItem -Path $c -Recurse -Filter "UxpAddon.h" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($header) { return $c }
        }
    }
    $null
}
Check "Whisperモデル (任意)" {
    $models = Get-ChildItem -Path "$PSScriptRoot\..\models" -Filter "*.bin" -ErrorAction SilentlyContinue
    if ($models) { ($models | ForEach-Object Name) -join ", " } else { "未取得（フィラー削除を使う場合のみ必要）" }
}

$results | Format-Table -AutoSize
$ng = @($results | Where-Object { $_.状態 -eq "NG" })
if ($ng.Count -gt 0) {
    Write-Host "`nNG項目があります。SDK_SETUP_REQUIRED.md を参照してください。" -ForegroundColor Yellow
    exit 1
}
Write-Host "`nすべてOKです。" -ForegroundColor Green
