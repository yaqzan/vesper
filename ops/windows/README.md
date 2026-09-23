# Vesper on Windows — keep-alive & backups

Three scheduled pieces keep Vesper running unattended on this PC:

| Piece | What it does | How it runs |
| --- | --- | --- |
| **Docker container** | The app itself. `restart: unless-stopped` + a `/health` healthcheck. | Restarts on crash automatically. |
| **`cloudflared`** | The public HTTPS tunnel. | Installed as a **Windows service** (always on). |
| **Watchdog** | Every 5 min: ensures Docker, the container (restarts if unhealthy), and the tunnel are all up. | **Scheduled Task**. |
| **Backup** | Daily 03:30: snapshots `transcripts.db` → `backups\`, keeps 30. | **Scheduled Task**. |

## One-time setup

### 1. Docker Desktop starts with Windows
Docker Desktop → **Settings → General → "Start Docker Desktop when you sign in"** (and **"Open Docker Dashboard at startup"** off). Because Docker Desktop needs a logged-in session, keep this account signed in — enabling **auto-login** is the usual move for a home server.

### 2. Install the tunnel as a service
From the repo root, with your tunnel already created (see the main README's Cloudflare section):

```powershell
cloudflared service install
Start-Service cloudflared
Get-Service cloudflared        # should say Running
```

This survives reboots with no user session.

### 3. Register the watchdog + backup tasks
In an **elevated** PowerShell (Run as Administrator):

```powershell
cd C:\Development\Vesper\ops\windows
Set-ExecutionPolicy -Scope Process Bypass
.\install-tasks.ps1
```

## Day-to-day

```powershell
Start-ScheduledTask "Vesper Watchdog"                 # force a tick now
Get-Content ops\windows\logs\watchdog.log -Tail 20    # what the watchdog did
Get-ScheduledTask "Vesper*" | Get-ScheduledTaskInfo   # last run / next run / result
docker compose ps                                     # container + health
.\uninstall-tasks.ps1                                 # remove the tasks
```

Run anything by hand safely:

```powershell
powershell -ExecutionPolicy Bypass -File ops\windows\watchdog.ps1
powershell -ExecutionPolicy Bypass -File ops\windows\backup.ps1
```

> Note: the watchdog keys its restart decisions off Docker's own health status,
> which honors the container's 10-minute `start_period`. The first boot (model
> download) will log "model still loading" without triggering restarts.
