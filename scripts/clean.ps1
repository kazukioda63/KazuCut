# ビルド成果物の削除（ソース・モデル・設定は削除しない）
$root = Resolve-Path "$PSScriptRoot\.."
foreach ($d in @("build", "plugin\dist")) {
    $path = Join-Path $root $d
    if (Test-Path $path) { Remove-Item $path -Recurse -Force }
}
Write-Host "クリーン完了" -ForegroundColor Green
