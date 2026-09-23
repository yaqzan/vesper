# Removes the Vesper scheduled tasks. Run as Administrator.
$ErrorActionPreference = 'Continue'

foreach ($name in 'Vesper Watchdog', 'Vesper Backup') {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "removed: $name" -ForegroundColor Yellow
    } else {
        Write-Host "not found: $name"
    }
}
