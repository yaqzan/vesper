# Ops infrastructure

**watchdog.ps1** -- runs every 5 min via Windows Scheduled Task. Ensures Docker Desktop is up and the vesper container is healthy. Also ensures the `cloudflared` service stays running (used by other apps on this host -- `api.bagholders.ai`, `fantasy-api.yaqzan.dev` -- not by Vesper). Logs to `ops/windows/logs/watchdog.log` (rotates at 512 KB).

**waker.ps1** -- long-running scheduled task ("Vesper Waker"); starts the on-demand `transcriber` container when `/api/queue` reports pending recordings, 10 min back-off after a failed run. Log: `ops/windows/logs/waker.log`. Detail in [transcription.md](transcription.md). The watchdog never starts the transcriber.

**docker-compose.yml** hardening (two services share the `vesper:local` image: `vesper` = API, no GPU; `transcriber` = GPU, `worker` profile, `restart: "no"`; use `--profile worker` with `down`): binds to `127.0.0.1:8000` only (published by the `tailscale` sidecar service, since `vesper` shares its network namespace), `no-new-privileges`, `pids_limit: 512`, `mem_limit: 8g`, frontend mount read-only, GPU device reservation (`deploy.resources.reservations`), 60s `start_period`. The GPU reservation and `whisper-cache` volume (`large-v3` is a few GB, downloaded once) belong to `transcriber`.

The vault bind mount is **writable and required** -- where the data lives (see [vault.md](vault.md)). Scoped to the one recordings folder (`VESPER_VAULT_DIR`) rather than the whole vault, so Vesper can't reach the rest of it.

## Backups

The vault is what to back up; Vesper holds nothing else. `backend/` now contains only code plus a disposable duration cache.

`backend/.env`, `backend/.duration-cache.json` and the retired SQLite backups (`backend/transcripts.db.bak-*`, kept from the 2026-08-22 migration) are git-ignored.
