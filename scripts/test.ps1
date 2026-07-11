# 全テスト実行（TS Unit/Integration + C++ Worker）
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
Push-Location $root
try {
    npm test; if ($LASTEXITCODE -ne 0) { throw "Vitestに失敗" }
} finally { Pop-Location }
$workerTests = "$root\build\worker\Release\worker_tests.exe"
if (Test-Path $workerTests) {
    & $workerTests
    if ($LASTEXITCODE -ne 0) { throw "Workerテストに失敗" }
} else {
    Write-Host "Workerテスト未ビルド（build-worker.ps1を先に実行）" -ForegroundColor Yellow
}
Write-Host "全テスト成功" -ForegroundColor Green
