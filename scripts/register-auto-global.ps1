# Registers a daily Task Scheduler job that runs auto-global.ps1 (default 10:30).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\register-auto-global.ps1 [-Time 10:30]
# Remove: Unregister-ScheduledTask -TaskName "MANGO FINDER global collect" -Confirm:$false
param([string]$Time = "10:30")

$ErrorActionPreference = "Stop"
$taskName = "MANGO FINDER global collect"
$script = Join-Path $PSScriptRoot "auto-global.ps1"
if (-not (Test-Path $script)) { throw "auto-global.ps1 was not found next to this script" }

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Registered '$taskName' daily at $Time (runs only while you are logged on; if the PC was off, it runs at the next start)."
Write-Host "Log: $env:LOCALAPPDATA\mango-finder\auto-global.log"
