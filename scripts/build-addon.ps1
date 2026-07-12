# Hybrid Addon (kazucut-native.uxpaddon) のビルド。
# UXP Addonヘッダーは addon/third_party/uxp/ に同梱済み（外部SDK不要）。
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
cmake -S "$root\addon" -B "$root\build\addon" -A x64
if ($LASTEXITCODE -ne 0) { throw "CMake configureに失敗" }
cmake --build "$root\build\addon" --config Release -j
if ($LASTEXITCODE -ne 0) { throw "Addonビルドに失敗" }
Copy-Item "$root\build\addon\Release\kazucut-native.uxpaddon" "$root\plugin\win\x64\" -Force
Write-Host "Addonビルド完了 → plugin\win\x64\kazucut-native.uxpaddon" -ForegroundColor Green
