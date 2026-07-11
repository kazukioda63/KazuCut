# Worker (KazuCutWorker.exe) のビルド + テスト
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
cmake -S "$root\worker" -B "$root\build\worker" -A x64 -DCMAKE_BUILD_TYPE=Release
if ($LASTEXITCODE -ne 0) { throw "CMake configureに失敗" }
cmake --build "$root\build\worker" --config Release -j
if ($LASTEXITCODE -ne 0) { throw "Workerビルドに失敗" }
& "$root\build\worker\Release\worker_tests.exe"
if ($LASTEXITCODE -ne 0) { throw "Workerテストに失敗" }
Copy-Item "$root\build\worker\Release\KazuCutWorker.exe" "$root\plugin\win\x64\" -Force
Write-Host "Workerビルド完了 → plugin\win\x64\KazuCutWorker.exe" -ForegroundColor Green
