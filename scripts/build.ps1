<#
打包抖音视频屏蔽扩展为可分发的 zip。

用法：
  powershell -ExecutionPolicy Bypass -File scripts\build.ps1
#>
param(
  [string]$Source = (Join-Path $PSScriptRoot "..\extension"),
  [string]$Output = (Join-Path $PSScriptRoot "..\output\douyin-feed-filter.zip")
)

$ErrorActionPreference = "Stop"

$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$manifestPath = Join-Path $sourcePath "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "没有找到 manifest.json，$sourcePath 不是一个扩展目录。"
}

# Windows PowerShell 5.1 显式按 UTF-8 读取，打包前校验版本。
$manifestText = [System.IO.File]::ReadAllText($manifestPath, (New-Object System.Text.UTF8Encoding($false)))
$manifest = $manifestText | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+\.\d+\.\d+$') {
  throw "扩展版本号必须由三段数字组成。"
}

$outputPath = [System.IO.Path]::GetFullPath($Output)
$outputDir = Split-Path -Parent $outputPath
if ($outputDir -eq $sourcePath -or $outputDir.StartsWith($sourcePath + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "导出目录不能位于扩展源码目录中。"
}
if (-not (Test-Path -LiteralPath $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}

if (Test-Path -LiteralPath $outputPath) {
  Remove-Item -LiteralPath $outputPath -Force
}

# 取目录内容而不是目录本身，保证解压后直接是 manifest.json 同级结构
$targets = Get-ChildItem -LiteralPath $sourcePath -Force | Select-Object -ExpandProperty FullName
Copy-Item -LiteralPath $targets -Destination $outputDir -Recurse -Force
Compress-Archive -Path $targets -DestinationPath $outputPath -CompressionLevel Optimal

$size = [math]::Round((Get-Item -LiteralPath $outputPath).Length / 1KB, 1)
Write-Host ("打包完成：{0}" -f $outputPath)
Write-Host ("可直接加载的扩展目录：{0}" -f $outputDir)
Write-Host ("名称：{0}  版本：{1}  大小：{2} KB" -f $manifest.name, $manifest.version, $size)
