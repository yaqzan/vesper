# Vesper watchdog — keeps the stack alive on Windows.
#
# Run on a schedule (every ~5 min) by install-tasks.ps1. Each tick it:
#   1. Makes sure the Docker engine is reachable (launches Docker Desktop if not).
#   2. Makes sure the `vesper` container is up and healthy (compose up / restart).
#   3. Makes sure the `cloudflared` tunnel service is running.
# Decisions are based on Docker's own health status, which respects the
# container's start_period — so the long first-boot model download does NOT
# trigger a restart loop.
#
# Safe to run by hand any time:  powershell -ExecutionPolicy Bypass -File watchdog.ps1

$ErrorActionPreference = 'Continue'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Compose  = Join-Path $RepoRoot 'docker-compose.yml'
$LogDir   = Join-Path $PSScriptRoot 'logs'
$LogFile  = Join-Path $LogDir 'watchdog.log'
$HealthUrl = 'http://localhost:8000/health'

function Write-Log {
    param([string]$Message)
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $LogFile -Value $line
}

function Rotate-Log {
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 512KB)) {
        $tail = Get-Content $LogFile -Tail 1500
        Set-Content -Path $LogFile -Value $tail
    }
}

function Test-DockerReady {
    docker version --format '{{.Server.Version}}' 1>$null 2>$null
    return ($LASTEXITCODE -eq 0)
}

function Start-DockerDesktop {
    $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path $exe)) {
        Write-Log "Docker Desktop not found at '$exe'. Cannot auto-start."
        return $false
    }
    Write-Log 'Docker engine unreachable; launching Docker Desktop...'
    Start-Process -FilePath $exe | Out-Null
    for ($i = 0; $i -lt 36; $i++) {       # wait up to ~3 minutes
        Start-Sleep -Seconds 5
        if (Test-DockerReady) { Write-Log 'Docker engine is up.'; return $true }
    }
    Write-Log 'Docker engine did not become ready within the wait window.'
    return $false
}

function Ensure-Container {
    $cid = (docker compose -f $Compose ps -q vesper 2>$null | Select-Object -First 1)
    if (-not $cid) {
        Write-Log "Container not present; 'compose up -d'."
        docker compose -f $Compose up -d 2>&1 | ForEach-Object { Write-Log "  $_" }
        return
    }
    $running = (docker inspect -f '{{.State.Running}}' $cid 2>$null)
    $health  = (docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $cid 2>$null)
    if ($running -ne 'true') {
        Write-Log "Container not running (running=$running); 'compose up -d'."
        docker compose -f $Compose up -d 2>&1 | ForEach-Object { Write-Log "  $_" }
    }
    elseif ($health -eq 'unhealthy') {
        Write-Log 'Container reports unhealthy; recreating (picks up current .env).'
        docker compose -f $Compose down 2>&1 | ForEach-Object { Write-Log "  $_" }
        docker compose -f $Compose up -d 2>&1 | ForEach-Object { Write-Log "  $_" }
    }
    else {
        Write-Log "Container OK (running=$running, health=$health)."
    }
}

function Test-Health {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 8
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

function Ensure-Cloudflared {
    $svc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
    if ($null -eq $svc) {
        Write-Log "cloudflared service not installed (see ops\windows\README.md)."
        return
    }
    if ($svc.Status -ne 'Running') {
        Write-Log "cloudflared service is $($svc.Status); starting."
        try { Start-Service -Name 'cloudflared'; Write-Log 'cloudflared started.' }
        catch { Write-Log "Failed to start cloudflared: $_" }
    } else {
        Write-Log 'cloudflared service running.'
    }
}

# --- tick ---
Write-Log '=== watchdog tick ==='

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Log 'docker CLI not on PATH for this task. Aborting tick.'
    Rotate-Log
    exit 1
}

if (-not (Test-DockerReady)) {
    if (-not (Start-DockerDesktop)) {
        Write-Log 'Docker unavailable; aborting tick.'
        Rotate-Log
        exit 1
    }
}

Ensure-Container

if (Test-Health) { Write-Log 'HTTP /health -> 200.' }
else { Write-Log 'HTTP /health not ready (starting up or model still loading).' }

Ensure-Cloudflared

Write-Log 'tick complete.'
Rotate-Log
