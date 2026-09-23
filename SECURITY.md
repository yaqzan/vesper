# Vesper — Security Notes

Vesper is a single-user app you host at home and reach over your **Tailscale
tailnet** — never the public internet. This is the threat model and the
proportionate measures for that scale.

## Threat model (what we're actually defending against)

- **Resource abuse** — someone (or a runaway retry loop) burning your GPU or
  filling your disk via `/api/transcribe`.
- **Your PC's general exposure** — malware, ransomware, unpatched software.
- **Tailnet scope creep** — a device you no longer trust staying enrolled.

Not in scope at this scale: internet scanners/bots (there's no public hostname
to scan), credential brute force (there's no credential — WireGuard device
identity is the only way in), or nation-state-grade adversaries.

## The single biggest win: no public exposure at all

`tailscale serve` proxies the backend only onto your private tailnet — there is
no public DNS record, no port forward, and no Cloudflare Tunnel. A device has
to be enrolled in your tailnet (and have Tailscale's WireGuard connection
active) to reach Vesper at all; there is nothing internet-routable to scan or
brute-force.

- ❌ Do **not** port-forward 8000 (or anything) on your router.
- The container binds `127.0.0.1:8000` only (see `docker-compose.yml`), so
  nothing on your LAN talks to the raw HTTP port except the local
  `tailscale serve` proxy.
- Keep your tailnet's device list (Tailscale admin console → **Machines**) to
  devices you actually trust — that list *is* your access control.

## Already implemented in this repo

| Measure | Where | Why |
| --- | --- | --- |
| **Global per-IP rate limit** on all `/api` (default 300/min) | rate-limit middleware | Blunts flooding/retry storms. |
| **Strict rate limit** on `/api/transcribe` (default 20/min) | `transcribe_rate_limit` | Protects the GPU/disk. |
| **Upload size cap** (default 50 MB) | streamed check in `transcribe` | A hostile/buggy upload can't fill the disk. |
| Real client IP via `X-Forwarded-For` | `get_client_ip` | Rate limits key on the true caller, not the local proxy. |
| `no-new-privileges`, pids limit, mem limit | `docker-compose.yml` | Contains the container. |
| Read-only frontend mount, log rotation | `docker-compose.yml` | Smaller blast radius; logs can't fill disk. |
| `/health` (info-free) | `backend/main.py` | Liveness only; leaks nothing. |
| `.env` / `transcripts.db` git-ignored | `.gitignore` | Secrets & journal never committed. |

Tune the limits in `backend/.env` (`RATE_LIMIT_*`, `MAX_UPLOAD_MB`). Set any
limit to `0` to disable it. Restart after changes: `docker compose restart`.

## Windows hygiene (reasonable for a home server)

- **Microsoft Defender**: leave **Real-time protection** on. It's sufficient at
  this scale — no third-party AV needed.
- **Defender Firewall**: keep it **on** (default). You need no inbound rules —
  there's nothing to expose.
- **Updates**: keep **Windows Update**, **Docker Desktop**, and **Tailscale**
  current — this is the highest-value malware defense there is.
- **Ransomware (optional)**: Defender → Ransomware protection → **Controlled
  folder access**, then allow Docker. Protects `transcripts.db` and `backups\`.
- **Least privilege**: run Vesper from a standard (non-admin) account day to day;
  only the one-time `install-tasks.ps1` needs admin.
- **Backups**: the daily job writes to `backups\`. Point a cloud-synced or
  external folder at it occasionally — your journal is the irreplaceable part.

## Removing a device's access

There's no key to rotate — access is the tailnet membership itself. To revoke a
device (lost phone, decommissioned laptop): Tailscale admin console →
**Machines** → remove it. It loses access immediately, no backend changes
needed.

## Optional further hardening

- **Drop all container capabilities**: uncomment `cap_drop: [ALL]` in
  `docker-compose.yml`, then confirm a recording still transcribes (most CUDA
  setups are fine; a few need caps back).
- **Tailscale ACLs**: if your tailnet grows beyond "just my devices," use
  [tailnet ACLs](https://tailscale.com/kb/1018/acls) to restrict which devices
  may reach port 8000, rather than relying on flat mesh connectivity.
- Move the stack to a dedicated Linux box and run it under `systemd` if you ever
  want true headless operation without a logged-in session.
