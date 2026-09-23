// Vesper service worker — minimal, iOS "Add to Home Screen" friendly.
//
// Strategy:
//   - The HTML document: network-first. It names Vite's content-hashed
//     bundles, so serving it from cache pins the device to whatever build it
//     first saw — no later deploy can ever reach it. Cache is the offline
//     fallback only.
//   - Hashed assets under /assets/ and other same-origin GETs: cache-first.
//     Those filenames change on every build, so a hit is always correct.
//   - /api/ requests: network-only, never cached (transcripts must be fresh,
//     and uploads must hit the server).
//
// Bump CACHE_VERSION to invalidate old shells after a deploy.

const CACHE_VERSION = 'vesper-shell-v15'
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

/** Navigations and direct hits on the shell — anything that returns the HTML. */
function isDocumentRequest(request, url) {
  return (
    request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname === '/index.html'
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // API: always go to the network; never serve a stale transcript list.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request))
    return
  }

  // Document: straight to the network, and with `no-cache` so the browser's
  // own HTTP cache can't hand back a stale shell either (it still revalidates
  // cheaply via ETag). Falls back to the cached copy when offline.
  if (isDocumentRequest(request, url)) {
    event.respondWith(
      fetch(url.pathname, { cache: 'no-cache', credentials: 'same-origin' })
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone()
            caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put('/index.html', copy))
              .catch(() => {})
          }
          return response
        })
        .catch(() =>
          caches
            .match('/index.html')
            .then((cached) => cached || caches.match('/'))
        )
    )
    return
  }

  // Everything else same-origin: cache-first, fall back to network, then fill
  // the cache for next time.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request)
        .then((response) => {
          if (
            response &&
            response.status === 200 &&
            url.origin === self.location.origin
          ) {
            const copy = response.clone()
            caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put(request, copy))
              .catch(() => {})
          }
          return response
        })
        .catch(() => Response.error())
    })
  )
})
