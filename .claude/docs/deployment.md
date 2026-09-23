# Deployment / caching design

`frontend/public/sw.js` is a service worker on the phone: **network-first for the HTML document**, cache-first for `/assets/*`. `index.html` names Vite's content-hashed bundles, so caching the document pins the device to whatever build it first saw and no later deploy can reach it. **Don't revert the document to cache-first** -- tried before, breaks deploys silently (phone never updates, no visible error).

Backend reinforces this with `Cache-Control: no-cache` on `/`, `/index.html`, `/sw.js`, `/manifest.json` and `immutable` on `/assets/*` (`static_cache_headers` in `backend/main.py`). `main.jsx` reloads once on `controllerchange` so a deploy lands on the first app launch after it's published.

If the phone still shows an old build after a deploy, it's this layer, not the container. Bump `CACHE_VERSION` in `sw.js`, then fully close and reopen the PWA (backgrounding/foregrounding isn't enough -- iOS keeps the old service worker instance alive).
