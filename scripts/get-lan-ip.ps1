$ips = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254*' -and
        $_.InterfaceAlias -notlike '*Loopback*'
    }

$wifi = $ips |
    Where-Object {
        $_.InterfaceAlias -like '*Wi-Fi*' -and
        $_.IPAddress -like '192.168.*'
    } |
    Select-Object -First 1

if ($wifi) {
    Write-Output $wifi.IPAddress
    exit 0
}

$lan = $ips |
    Where-Object {
        $_.IPAddress -like '192.168.*' -and
        $_.InterfaceAlias -notlike '*Nord*' -and
        $_.InterfaceAlias -notlike '*Tailscale*' -and
        $_.InterfaceAlias -notlike '*OpenVPN*'
    } |
    Select-Object -First 1 -ExpandProperty IPAddress

if ($lan) {
    Write-Output $lan
    exit 0
}

Write-Output 'YOUR_PC_IP'
