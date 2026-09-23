# Vesper backup — snapshots the transcript database (your journal).
#
# Copies backend\transcripts.db into .\backups\ with a timestamp and keeps the
# most recent $Keep snapshots. Scheduled daily by install-tasks.ps1, and safe to
# run by hand. For a guaranteed-consistent copy you can stop the container first
# (docker compose stop), but at single-user scale an idle-time copy is fine.

param([int]$Keep = 30)

$ErrorActionPreference = 'Continue'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Db       = Join-Path $RepoRoot 'backend\transcripts.db'
$Dest     = Join-Path $RepoRoot 'backups'
$LogDir   = Join-Path $PSScriptRoot 'logs'
$LogFile  = Join-Path $LogDir 'backup.log'

function Write-Log {
    param([string]$Message)
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    Add-Content -Path $LogFile -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
}

if (-not (Test-Path $Dest)) { New-Item -ItemType Directory -Path $Dest -Force | Out-Null }

if (-not (Test-Path $Db)) {
    Write-Log "No database at '$Db' yet; nothing to back up."
    return
}

$ts   = Get-Date -Format 'yyyyMMdd-HHmmss'
$base = "transcripts-$ts.db"
Copy-Item -Path $Db -Destination (Join-Path $Dest $base) -Force
# Include sidecar journal/WAL files if present, for a coherent snapshot.
foreach ($ext in '-wal', '-shm', '-journal') {
    $side = "$Db$ext"
    if (Test-Path $side) { Copy-Item -Path $side -Destination (Join-Path $Dest "$base$ext") -Force }
}
Write-Log "Backed up -> $base"

# Retention: keep the newest $Keep snapshots, delete the rest.
$old = Get-ChildItem -Path $Dest -Filter 'transcripts-*.db' |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep
foreach ($f in $old) {
    Remove-Item $f.FullName -Force
    foreach ($ext in '-wal', '-shm', '-journal') {
        $side = "$($f.FullName)$ext"
        if (Test-Path $side) { Remove-Item $side -Force }
    }
    Write-Log "Pruned old snapshot $($f.Name)"
}
