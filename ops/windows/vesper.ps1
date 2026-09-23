# Vesper server manager — idempotent start / stop / restart / status / logs.
#
# Usage (from repo root or anywhere):
#   .\ops\windows\vesper.ps1 start      # start if not running, no-op if already up
#   .\ops\windows\vesper.ps1 stop       # stop and remove the container
#   .\ops\windows\vesper.ps1 restart    # full recreate — always picks up .env changes
#   .\ops\windows\vesper.ps1 status     # show container state, health, and live key check
#   .\ops\windows\vesper.ps1 logs       # tail 50 lines of container logs
#   .\ops\windows\vesper.ps1            # same as status

$ErrorActionPreference = 'Stop'

$RepoRoot  = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Compose   = Join-Path $RepoRoot 'docker-compose.yml'
$HealthUrl = 'http://localhost:8000/health'

$Action = if ($args.Count -gt 0) { $args[0].ToLower() } else { 'status' }

# ── helpers ──────────────────────────────────────────────────────────────────

function Get-ContainerId {
    docker compose -f $Compose ps -q vesper 2>$null | Select-Object -First 1
}

function Test-Health {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 6
        $body = $r.Content | ConvertFrom-Json
        return $body
    } catch { return $null }
}

function Write-Status {
    $cid    = Get-ContainerId
    $banner = if ($cid) {
        $running = docker inspect -f '{{.State.Running}}' $cid 2>$null
        $health  = docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $cid 2>$null
        $uptime  = docker inspect -f '{{.State.StartedAt}}' $cid 2>$null
        "container $($cid.Substring(0,12))  running=$running  health=$health  started=$uptime"
    } else {
        "no container running"
    }
    Write-Host ""
    Write-Host "  Container : $banner"

    $health = Test-Health
    if ($health) {
        Write-Host "  /health   : ok  model_loaded=$($health.model_loaded)"
    } else {
        Write-Host "  /health   : unreachable"
    }
    Write-Host ""
}

# ── actions ──────────────────────────────────────────────────────────────────

switch ($Action) {

    'start' {
        $cid = Get-ContainerId
        if ($cid) {
            $running = docker inspect -f '{{.State.Running}}' $cid 2>$null
            if ($running -eq 'true') {
                Write-Host "Already running ($($cid.Substring(0,12))). Use 'restart' to pick up .env changes."
                Write-Status
                exit 0
            }
        }
        Write-Host "Starting Vesper..."
        docker compose -f $Compose up -d
        Write-Host "Started."
        Write-Status
    }

    'stop' {
        Write-Host "Stopping Vesper..."
        docker compose -f $Compose down
        Write-Host "Stopped."
    }

    'restart' {
        Write-Host "Recreating Vesper (will pick up current .env)..."
        docker compose -f $Compose down
        docker compose -f $Compose up -d
        Write-Host "Restarted."
        Write-Status
    }

    'logs' {
        $cid = Get-ContainerId
        if (-not $cid) { Write-Host "No container running."; exit 1 }
        docker logs --tail 50 -f $cid
    }

    'status' {
        Write-Status
    }

    default {
        Write-Host "Unknown action '$Action'. Use: start | stop | restart | status | logs"
        exit 1
    }
}
