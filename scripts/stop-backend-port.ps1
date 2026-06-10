param(
    [int]$Port = 3000
)

function Get-ListenerPids {
    param([int]$TargetPort)

    $pids = @()
    try {
        $pids = @(Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique)
    } catch {
        $pids = @()
    }

    if ($pids.Count -gt 0) {
        return $pids
    }

    $matches = netstat -ano | Select-String "LISTENING" | Select-String ":$TargetPort\s"
    foreach ($line in $matches) {
        $parts = ($line -split '\s+') | Where-Object { $_ -ne '' }
        $pidText = $parts[-1]
        if ($pidText -match '^\d+$') {
            $pids += [int]$pidText
        }
    }

    return @($pids | Select-Object -Unique)
}

$pids = Get-ListenerPids -TargetPort $Port
if (-not $pids -or $pids.Count -eq 0) {
    Write-Output "NONE"
    exit 0
}

$stopped = 0
foreach ($procId in $pids) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.ProcessName } else { "pid$procId" }
    try {
        Stop-Process -Id $procId -Force -ErrorAction Stop
        Write-Output "STOPPED $procId $name"
        $stopped++
    } catch {
        Write-Output "FAILED $procId $name"
    }
}

if ($stopped -eq 0) { exit 1 }
exit 0
