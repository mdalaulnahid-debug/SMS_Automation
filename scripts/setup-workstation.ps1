Param()

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$configDir = Join-Path $root 'config'
$dataDir = Join-Path $root 'data'

function Ensure-Dir($path) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Path $path | Out-Null
    Write-Host "Created $path"
  }
}

function Ensure-ConfigFile($name) {
  $target = Join-Path $configDir $name
  $example = Join-Path $configDir ($name -replace '\.json$', '.example.json')
  if (Test-Path -LiteralPath $target) {
    Write-Host "$name present"
    return
  }
  if (Test-Path -LiteralPath $example) {
    Copy-Item -LiteralPath $example -Destination $target
    Write-Host "Created $name from example"
    return
  }
  Write-Warning "Missing both $name and its example template"
}

Write-Host ""
Write-Host "SMS Automation workstation bootstrap"
Write-Host "=================================="
Write-Host ""

Ensure-Dir $configDir
Ensure-Dir $dataDir

Ensure-ConfigFile 'gateways.json'
Ensure-ConfigFile 'auth.json'
Ensure-ConfigFile 'telegram.json'

Write-Host ""
Write-Host "Bootstrap complete."
Write-Host "Review private values in config\\auth.json, config\\gateways.json, and config\\telegram.json before production use."
Write-Host ""
