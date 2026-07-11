# UXPパネルのビルド（型チェック + Lint + esbuild）
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
Push-Location $root
try {
    npm run typecheck; if ($LASTEXITCODE -ne 0) { throw "型チェックに失敗" }
    npm run lint;      if ($LASTEXITCODE -ne 0) { throw "ESLintに失敗" }
    npm run build:uxp; if ($LASTEXITCODE -ne 0) { throw "esbuildに失敗" }
} finally { Pop-Location }
Write-Host "UXPビルド完了 → plugin\dist\main.js" -ForegroundColor Green
