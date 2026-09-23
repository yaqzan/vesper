# CLAUDE.md

Guidance for Claude Code in this repo.

## What This Is

Vesper is a personal voice-journaling PWA with a home-hosted GPU transcription backend. iOS records audio -> uploads to `/api/transcribe` -> `faster-whisper` on GTX 1080 Ti -> written straight into the Obsidian vault. Served single-origin on port 8000, reachable only over the Tailscale tailnet via its own sidecar node (`vesper.<tailnet>.ts.net`) -- no public exposure, no app-level API key.

**There is no database.** The vault folder (`VESPER_VAULT_DIR`, e.g. an Obsidian `Recordings\<date>\`) holds every entry as a `NN - H.MMpm.txt` + audio pair; Vesper serves them from an in-memory index rebuilt at startup. Read [vault.md](.claude/docs/vault.md) before touching storage.

**Public repo (github.com/yaqzan/vesper).** Journal data and personal tooling never get committed: the vault folder, `.env` (`TS_AUTHKEY`, `VESPER_VAULT_DIR`), `backend/.env` (real names in the Whisper prompt/substitutions), `.horizon/`, `.planning/`, `prompts/` are gitignored. Tracked files carry no person's name, tailnet name or vault path. Pre-2026-09-23 history is in private `yaqzan/vesper-archive`.

## Dev Commands

### Frontend
```powershell
cd frontend
npm install
npm run dev       # Vite dev server (hot reload)
npm run build     # Output to frontend/dist/ (served by FastAPI)
```

### Backend
```powershell
docker compose up -d          # Start container
docker compose logs -f vesper # Tail logs
docker compose down           # Stop
```

### Windows management scripts
```powershell
.\ops\windows\vesper.ps1 start|stop|restart|status|logs
```
- `restart` is needed to pick up `.env` changes (full recreate)
- `status` shows container health and a `/health` probe

Health check: `curl http://localhost:8000/health` (no auth required)

## Deploying Changes

**Frontend changed** (`frontend/src/` or any other frontend file) -- build and confirm success:
```powershell
cd C:\Development\Vesper\frontend
npm run build
```
`frontend/dist/` is volume-mounted read-only into the container -- serves new files immediately, no restart needed.

**Reaching the installed PWA is a separate problem from the container serving new files** -- `frontend/public/sw.js` is deliberately network-first for the HTML document and cache-first for `/assets/*`, so a stale phone install needs `CACHE_VERSION` bumped in `sw.js` plus a full close/reopen of the PWA. Don't revert the document to cache-first -- see [deployment.md](.claude/docs/deployment.md).

**Backend changed** (`backend/main.py` or `backend/.env`) -- restart:
```powershell
.\ops\windows\vesper.ps1 restart    # full recreate (required for .env changes)
docker compose restart vesper       # main.py-only changes
```

**Both changed** -- build first, then restart. Confirm with `curl http://localhost:8000/health`.

## Reference docs

- [vault.md](.claude/docs/vault.md) -- **start here for anything storage-related**: the vault as sole source of truth, the in-memory index, filenames, durations, deleting
- [architecture.md](.claude/docs/architecture.md) -- request flow, API table, backend/frontend file-by-file detail
- [transcription.md](.claude/docs/transcription.md) -- faster-whisper/GPU config, model choice, name-substitution list, ElevenLabs history
- [networking.md](.claude/docs/networking.md) -- Tailscale sidecar setup
- [ops.md](.claude/docs/ops.md) -- watchdog, docker-compose hardening
- [deployment.md](.claude/docs/deployment.md) -- service worker caching design

## Critical invariant

The GTX 1080 Ti (Pascal) does **not** support `float16` -- always `WHISPER_COMPUTE_TYPE=int8_float32`, or the model load crashes. Detail: [transcription.md](.claude/docs/transcription.md).

