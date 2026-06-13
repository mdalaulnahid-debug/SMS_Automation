# set-admin-key.ps1 — run this to set your admin password.
# Double-click in Explorer or run from any PowerShell window.

$authFile = Join-Path $PSScriptRoot "..\config\auth.json"

Write-Host ""
Write-Host "=== SMS Gateway — Set Admin Password ===" -ForegroundColor Cyan
Write-Host ""

$pass = Read-Host "Enter your admin password" -AsSecureString
$confirm = Read-Host "Confirm password" -AsSecureString

$plain    = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pass))
$plainCfm = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm))

if ($plain -ne $plainCfm) {
    Write-Host "Passwords do not match. Nothing saved." -ForegroundColor Red
    pause
    exit 1
}

if ($plain.Length -lt 8) {
    Write-Host "Password must be at least 8 characters." -ForegroundColor Red
    pause
    exit 1
}

$json = [ordered]@{
    adminApiKey           = $plain
    requireGatewayAuth    = $false
    denyUnknownRequesters = $false
} | ConvertTo-Json

$json | Out-File -FilePath $authFile -Encoding utf8

Write-Host ""
Write-Host "Saved to config/auth.json" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Restart the backend"
Write-Host "  2. Enter the same password in the app: Settings > Admin API Key"
Write-Host ""
pause
