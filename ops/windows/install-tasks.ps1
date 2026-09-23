# Registers two Scheduled Tasks (run as Administrator):
#   * "Vesper Watchdog" — at logon, then every 5 minutes, keeps the stack alive.
#   * "Vesper Backup"   — daily at 03:30, snapshots the transcript DB.
#
# The watchdog runs as the current (interactive) user because Docker Desktop
# needs a user session — so keep this account logged in (auto-login is fine for a
# home server). Re-run any time; it overwrites the existing tasks.
#
# Usage (in an elevated PowerShell):
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\install-tasks.ps1

$ErrorActionPreference = 'Stop'

# --- Require admin ---
$principalCheck = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'ERROR: please run this in an elevated (Administrator) PowerShell.' -ForegroundColor Red
    exit 1
}

$watchdog = Join-Path $PSScriptRoot 'watchdog.ps1'
$backup   = Join-Path $PSScriptRoot 'backup.ps1'
$user     = "$env:USERDOMAIN\$env:USERNAME"

function Register-VesperTask {
    param(
        [string]$Name,
        [string]$ScriptPath,
        [object[]]$Triggers
    )
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Triggers `
        -Principal $principal -Settings $settings -Force | Out-Null
    Write-Host "  registered: $Name" -ForegroundColor Green
}

# --- Watchdog: at logon + every 5 minutes, indefinitely ---
# NOTE: do not pass -RepetitionDuration ([TimeSpan]::MaxValue) here -- it serializes
# to an out-of-range Task Scheduler XML duration (P99999999DT23H59M59S) and
# Register-ScheduledTask rejects it. An empty Duration is how the schema spells
# "repeat forever", so build the trigger with an interval only, then blank out
# the duration it auto-fills.
$wdTrigger = New-ScheduledTaskTrigger -AtLogOn
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)
$repeat.Repetition.Duration = ''
$wdTrigger.Repetition = $repeat.Repetition
Register-VesperTask -Name 'Vesper Watchdog' -ScriptPath $watchdog -Triggers @($wdTrigger)

# --- Backup: daily at 03:30 ---
$bkTrigger = New-ScheduledTaskTrigger -Daily -At '3:30AM'
Register-VesperTask -Name 'Vesper Backup' -ScriptPath $backup -Triggers @($bkTrigger)

Write-Host ''
Write-Host 'Done. Useful commands:' -ForegroundColor Cyan
Write-Host '  Start-ScheduledTask  "Vesper Watchdog"     # run a tick now'
Write-Host '  Get-ScheduledTask    "Vesper*"             # see status'
Write-Host '  Get-Content ops\windows\logs\watchdog.log -Tail 20'
Write-Host '  .\uninstall-tasks.ps1                      # remove both tasks'
