param(
  [string]$Source = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot

if (-not $Source) {
  $downloads = Join-Path $env:USERPROFILE "Downloads"
  $latest = Get-ChildItem $downloads -Filter "global-products*.json" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { throw "Downloads に global-products.json が見つかりません。-Source でパスを指定してください。" }
  $Source = $latest.FullName
}

$json = Get-Content $Source -Raw -Encoding UTF8 | ConvertFrom-Json
if ($null -eq $json.matches) { throw "$Source は global-products.json の形式ではありません。" }
$count = @($json.matches).Count
if ($count -eq 0 -and -not $Force) { throw "matches が0件です。空データで上書きしないよう中止しました(上書きするなら -Force)。" }

foreach ($dir in "public", "data") {
  Copy-Item $Source (Join-Path $repo "$dir\global-products.json") -Force
}
Write-Host "反映しました: $Source"
Write-Host "更新日時: $($json.updatedAt) / 関連付け: $count 件"
Write-Host "次は GitHub Desktop 等で public/global-products.json と data/global-products.json をコミット&Pushしてください。"
