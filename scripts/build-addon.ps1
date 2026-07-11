# Hybrid Addon (kazucut-native.uxpaddon) のビルド（要UXP Hybrid Plugin SDK）
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$sdkArg = @()
if ($env:ADOBE_UXP_HYBRID_SDK) { $sdkArg = @("-DUXP_HYBRID_SDK_DIR=$env:ADOBE_UXP_HYBRID_SDK") }
cmake -S "$root\addon" -B "$root\build\addon" -A x64 @sdkArg
if ($LASTEXITCODE -ne 0) {
    Write-Host "SDKが見つからない場合は SDK_SETUP_REQUIRED.md を参照してください" -ForegroundColor Yellow
    throw "CMake configureに失敗"
}
cmake --build "$root\build\addon" --config Release -j
if ($LASTEXITCODE -ne 0) { throw "Addonビルドに失敗" }
Copy-Item "$root\build\addon\Release\kazucut-native.uxpaddon" "$root\plugin\win\x64\" -Force
Write-Host "Addonビルド完了 → plugin\win\x64\kazucut-native.uxpaddon" -ForegroundColor Green
