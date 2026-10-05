# Vesper waker -- starts the GPU transcriber only while recordings are waiting.
#
# Long-running: polls the API's /api/queue every few seconds and, when anything
# is pending and the transcriber container isn't running, starts it. The worker
# exits by itself when the queue has been empty ~60s. Run by the "Vesper Waker"
# scheduled task (install-tasks.ps1); safe to run by hand, one instance only.
#
# Back-off: a worker that exits non-zero (a recording failed) is not restarted
# for 10 minutes, otherwise one bad file would wake the GPU every few seconds.

$ErrorActionPreference = 'Continue'

$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Compose    = Join-Path $RepoRoot 'docker-compose.yml'
$LogDir     = Join-Path $PSScriptRoot 'logs'
$LogFile    = Join-Path $LogDir 'waker.log'
$QueueUrl   = 'http://127.0.0.1:8000/api/queue'
$Container  = 'vesper-transcriber'
$PollSec    = 5
$BackoffMin = 10

function Write-Log {
    param([string]$Message)
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 512KB)) {
        $tail = Get-Content $LogFile -Tail 500
        Set-Content -Path $LogFile -Value $tail
    }
    Add-Content -Path $LogFile -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
}

function Get-Pending {
    try {
        $r = Invoke-RestMethod -Uri $QueueUrl -TimeoutSec 8
        return [int]$r.pending
    } catch { return -1 }
}

# Returns @{ Exists; Running; ExitCode; Finished } for the transcriber container.
function Get-WorkerState {
    $raw = docker inspect -f '{{.State.Running}}|{{.State.ExitCode}}|{{.State.FinishedAt}}' $Container 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $raw) { return @{ Exists = $false; Running = $false } }
    $p = $raw.Split('|')
    return @{
        Exists   = $true
        Running  = ($p[0] -eq 'true')
        ExitCode = [int]$p[1]
        Finished = [datetime]::Parse($p[2]).ToUniversalTime()
    }
}

Write-Log 'waker started.'
while ($true) {
    $pending = Get-Pending
    if ($pending -gt 0) {
        $w = Get-WorkerState
        if (-not $w.Running) {
            $backoff = $w.Exists -and $w.ExitCode -ne 0 -and
                (([datetime]::UtcNow - $w.Finished).TotalMinutes -lt $BackoffMin)
            if (-not $backoff) {
                Write-Log "$pending pending; starting transcriber."
                docker compose -f $Compose --profile worker up -d transcriber 2>&1 |
                    ForEach-Object { Write-Log "  $_" }
            }
        }
    }
    Start-Sleep -Seconds $PollSec
}
