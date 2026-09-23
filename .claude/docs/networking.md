# Network access

Vesper is reached only over the Tailscale tailnet -- no Cloudflare Tunnel, no public DNS, no API key. Unlike a typical single-host setup, it does **not** rely on the host's own `tailscale serve` -- it runs its own Tailscale node in a Docker sidecar (`tailscale` service in `docker-compose.yml`), giving it a stable identity independent of the Windows host's own node:

```
https://vesper.<tailnet>.ts.net  -->  (tailscale sidecar, network_mode: service)  -->  vesper container :8000
```

**Why a sidecar, not host `tailscale serve`:** other tools on this host (agent harnesses, dev servers) can call `tailscale serve --bg <port>` themselves, which silently repoints `<host>.<tailnet>.ts.net` at whatever they're running -- happened once, broke Vesper's tailnet access. A dedicated node removes that failure mode.

Sidecar setup:
- `ops/tailscale/serve.json` -- HTTPS proxy config for the sidecar (proxies `443` -> `127.0.0.1:8000` inside the shared network namespace)
- `TS_AUTHKEY` in root `.env` (git-ignored) -- consumed once on first join; identity then persists in the `ts-vesper-state` Docker volume across restarts
- **Key expiry disabled** for the `vesper` node in the Tailscale admin console (Machines page) -- no periodic re-authentication needed
- Requires the tailnet's **HTTPS Certificates** feature (admin console -> DNS settings) for ACME cert issuance

To reconfigure or inspect:
```powershell
docker compose logs tailscale       # sidecar join / cert status
tailscale status                    # confirm the `vesper` node shows up alongside other tailnet devices
```

Any device that should reach Vesper (e.g. the iPhone) must be joined to the same tailnet with the Tailscale app connected -- no other way in. A Cloudflare Tunnel route existed briefly during migration, removed to keep this tailnet-only.
