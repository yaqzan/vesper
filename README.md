# Vesper

> Your voice. Your words. Every day.

A personal voice-journaling PWA with a home-hosted transcription backend.
Record a voice memo on your phone (one thumb, eyes on the road), and Vesper
uploads it to a GPU box at home that transcribes it with
[`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) and keeps a daily
diary of your spoken entries.

- **Frontend** — an installable iOS PWA (Add to Home Screen). Records audio,
  tracks which days have entries, shows a calendar/timeline and your
  transcripts. Works offline: failed uploads are queued and retried.
- **Backend** — a FastAPI server that transcribes uploads on GPU, writes each
  entry straight into an Obsidian vault folder, and serves the compiled
  frontend as static files. There's no database: the vault files *are* the
  data, and the server indexes them into memory at startup.

Everything is one origin — `tailscale serve` proxies port `8000` to an HTTPS
hostname on your private Tailscale network (tailnet), so there's no CORS, no
second domain, and no public exposure at all. Only devices joined to the
tailnet can reach it.

---

## Morning Checklist (what to do when you wake up)

1. Open a terminal and `cd vesper`
2. Confirm the server is running: `docker compose ps`
3. If it isn't: `docker compose up -d`
4. Make sure Tailscale is connected on your phone, then open
   `https://your-device.your-tailnet.ts.net` in Safari
5. First time only: **Share → Add to Home Screen**

That's it. Tap the gold record button, talk, and your day is saved.

---

## Initial Setup

1. **Configure** — copy both example envs (no API key needed):

   ```bash
   cp .env.example .env                  # Tailscale auth key + your recordings folder
   cp backend/.env.example backend/.env  # Whisper model, GPU type, timezone
   ```

   Set `WHISPER_COMPUTE_TYPE` for your GPU (the comments list which) and
   `VAULT_TZ` to your timezone. Needs Docker with the NVIDIA runtime.

2. **Build the frontend:**

   ```bash
   cd frontend && npm install && npm run build && cd ..
   ```

3. **Start the backend (GPU):**

   ```bash
   docker compose up -d
   ```

4. **Health check:**

   ```bash
   curl http://localhost:8000/health
   ```

   `{"status":"ok",...}` means it's healthy.

---

## Tailscale Setup (one-time, manual)

> Required for iOS microphone access — Safari blocks `getUserMedia` on any
> non-HTTPS origin. `tailscale serve` gives you a real HTTPS hostname on your
> private tailnet, reachable only by devices you've enrolled — no open ports,
> no public DNS.

1. Install Tailscale on this machine and sign in: https://tailscale.com/download
2. **One-time per tailnet:** enable HTTPS certificates — Tailscale admin
   console → **DNS** → toggle **"Enable HTTPS Certificates"**. Without this,
   `tailscale serve` can't issue a cert.
3. Point the tailnet hostname at the backend:

   ```bash
   tailscale serve --bg 8000
   tailscale serve status   # confirm: https://<device>.<tailnet>.ts.net -> 127.0.0.1:8000
   ```

   This persists across reboots — you only need to run it once (or again after
   `tailscale serve reset`).
4. Install Tailscale on your phone too and sign in to the same tailnet.

---

## iOS Installation

1. Confirm Tailscale is connected on your phone.
2. Open `https://<device>.<tailnet>.ts.net` in **Safari** (must be Safari).
3. Tap **Share → Add to Home Screen → "Vesper" → Add**.

No key or setup screen — being on the tailnet is what grants access.

---

## Updating

Rebuild the frontend and restart the container (the build output is mounted in):

```bash
cd frontend && npm run build && cd .. && docker compose restart
```

---

## Keeping it running (Windows)

So Vesper stays up unattended, two pieces run on a schedule: the container
(`restart: unless-stopped` + a `/health` healthcheck) and a **watchdog** that
checks it every 5 minutes and restarts it if it's down. A daily job snapshots
your transcript DB. Tailscale itself installs as an always-on Windows service
by default, so it doesn't need a watchdog entry — `tailscale serve`'s config
persists on its own across reboots.

One-time, from an **elevated** PowerShell:

```powershell
# Watchdog (every 5 min) + daily backup, as Scheduled Tasks
cd C:\Development\Vesper\ops\windows
Set-ExecutionPolicy -Scope Process Bypass
.\install-tasks.ps1
```

Also enable Docker Desktop's **"Start Docker Desktop when you sign in"** (it needs
a logged-in session — auto-login is the usual setup for a home server).

Full details, day-to-day commands, and logs: [ops/windows/README.md](ops/windows/README.md).

---

## Security

Vesper is never exposed to the public internet at all — access is restricted
at the network layer to devices joined to your Tailscale tailnet (WireGuard,
per-device identity). On top of that it still has proportionate hardening:
per-IP rate limiting (global + a stricter cap on transcription), an
upload-size limit, and a contained container (`no-new-privileges`, resource
limits, read-only frontend mount).

Read and follow [SECURITY.md](SECURITY.md) — especially **don't port-forward**
and keep your tailnet's device list to ones you trust.

---

## GPU Notes

`large-v3-turbo` needs roughly **3 GB of VRAM**. A GTX 1080 Ti (11 GB) handles
it comfortably. The first startup downloads the model weights (~800 MB) into the
named Docker volume `whisper-cache`, so subsequent restarts are instant. The
image bundles the CUDA 12 math libraries (`nvidia-cublas-cu12`,
`nvidia-cudnn-cu12`) that ctranslate2 needs for GPU inference.

### Compute type by GPU generation

`WHISPER_COMPUTE_TYPE` must match what your GPU supports:

| GPU generation | Compute capability | Recommended `WHISPER_COMPUTE_TYPE` |
| --- | --- | --- |
| Turing / Ampere / Ada (RTX 20xx+) | 7.0+ | `float16` (fastest) |
| **Pascal (GTX 10xx, e.g. 1080 Ti)** | 6.1 | **`int8_float32`** (no efficient fp16) |
| CPU only | — | `int8` |

Pascal cards have no efficient float16, so `float16` fails with *"target device
or backend do not support efficient float16 computation"* and falls back to CPU.
This box is a **1080 Ti**, so `backend/.env` is set to `int8_float32`. To see
exactly what your card supports:

```bash
docker exec vesper-vesper-1 python -c "import ctranslate2 as c; print(c.get_supported_compute_types('cuda'))"
```

**CPU fallback** — if you don't have an NVIDIA GPU (or for testing), set the
following in `backend/.env` and restart:

```
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
```

```bash
docker compose restart
```

> On CPU, transcription is much slower and you can drop `WHISPER_MODEL` to
> something like `small` or `base` for usable latency.

---

## Your data

Your journal never touches git:

| file | what it is |
|---|---|
| the folder in `VESPER_VAULT_DIR` | every entry: `<date>/NN - H.MMpm.txt` plus its audio |
| `.env` | Tailscale auth key and that folder's path |
| `backend/.env` | model settings, plus the names Whisper should learn to spell |

## Project Layout

```
vesper/
├── frontend/        Vite + React + Mantine PWA  (build output → frontend/dist)
├── backend/         FastAPI + faster-whisper (data lives in the Obsidian vault)
├── scripts/         generate_icons.py (programmatic app icons)
├── docker-compose.yml
└── README.md
```

## API (no app-level auth — access is restricted to the Tailscale tailnet)

| Method   | Path                      | Purpose                                  |
| -------- | ------------------------- | ---------------------------------------- |
| `POST`   | `/api/transcribe`         | Upload audio (`audio`, optional `local_date`) → transcript |
| `GET`    | `/api/transcripts`        | All transcripts, or `?date=YYYY-MM-DD`   |
| `GET`    | `/api/calendar`           | `[{ date, count }]` for recorded days    |
| `PATCH`  | `/api/transcripts/{id}`   | Edit a transcript (`{ transcript }`) — rewrites the vault file |
| `DELETE` | `/api/transcripts/{id}`   | Delete one entry — **removes its vault files** |
| `POST`   | `/api/reindex`            | Re-read the vault (picks up edits made in Obsidian) |
| `GET`    | `/health`                 | Liveness probe (used by the healthcheck/watchdog) |

Watch logs anytime with:

```bash
docker compose logs -f vesper
```

## License

MIT
