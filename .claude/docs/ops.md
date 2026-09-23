# Ops infrastructure

**watchdog.ps1** -- runs every 5 min via Windows Scheduled Task. Ensures Docker Desktop is up and the vesper container is healthy. Also ensures the `cloudflared` service stays running (used by other apps on this host -- `api.bagholders.ai`, `fantasy-api.yaqzan.dev` -- not by Vesper). Logs to `ops/windows/logs/watchdog.log` (rotates at 512 KB).

**docker-compose.yml** hardening: binds to `127.0.0.1:8000` only (published by the `tailscale` sidecar service, since `vesper` shares its network namespace), `no-new-privileges`, `pids_limit: 512`, `mem_limit: 8g`, frontend mount read-only, GPU device reservation (`deploy.resources.reservations`), 600s `start_period` (first-boot model download window -- `large-v3` is a few GB, downloaded once into the `whisper-cache` volume).

The vault bind mount is **writable and required** -- where the data lives (see [vault.md](vault.md)). Scoped to the one recordings folder (`VESPER_VAULT_DIR`) rather than the whole vault, so Vesper can't reach the rest of it.

## Backups

The vault is what to back up; Vesper holds nothing else. `backend/` now contains only code plus a disposable duration cache.

`backend/.env`, `backend/.duration-cache.json` and the retired SQLite backups (`backend/transcripts.db.bak-*`, kept from the 2026-08-22 migration) are git-ignored.
