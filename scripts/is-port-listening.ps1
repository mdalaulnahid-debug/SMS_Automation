param(
    [int]$Port = 3000
)

try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($conn) {
        Write-Output $conn.OwningProcess
        exit 0
    }
} catch {}

$match = netstat -ano | Select-String "LISTENING" | Select-String ":$Port\s" | Select-Object -First 1
if ($match) {
    $parts = ($match -split '\s+') | Where-Object { $_ -ne '' }
    Write-Output $parts[-1]
    exit 0
}

exit 1
