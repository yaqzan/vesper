# Architecture detail

## Request flow
1. iOS PWA records audio -> handed to the upload queue (`lib/useUploadQueue.js`), which writes it to IndexedDB as `status: 'queued'` **before** uploading. The orb is free again at once; uploads run one at a time in the background while you browse or record again.
2. XHR multipart POST to `/api/transcribe` (XHR, not fetch, for upload progress; aborted only after 45s with **no progress**, never on a fixed total -- long recordings on a slow uplink must finish). No app-level auth -- the tailnet is the access boundary.
3. Upload is staged to a temp file (size-capped as it streams), then moved into the vault day folder; response returns in <1s and a `BackgroundTask` runs `faster-whisper` afterward (see [transcription.md](transcription.md)). Staging outside the vault means a rejected upload never leaves a partial file where the memoir pipeline or the next scan would find it.
4. Frontend polls `/api/transcripts` every 3s while any entry has `transcript: null`; response shape: `{id, date, transcript, duration_seconds, word_count, created_at}`
5. Success deletes the IndexedDB record. Failure flips it to `status: 'failed'` -> PendingUploads banner (retry / discard); failed ones auto-retry on the `online` event.
6. **An app closed mid-upload** leaves a `'queued'` record; the next launch restarts it (`resume()` in App.jsx). iOS suspends a backgrounded PWA's network and Safari has no Background Sync/Fetch, so the app must be open for bytes to move -- but nothing is lost.
7. Progress shows in two places, split on purpose: **`NavProgressRing`** -- a wordless ring round the Record tab's icon, visible from every tab (average of all in-flight jobs; upload bytes fill 0-66%, transcribing holds at 85% and pulses, done closes it; ember while recording from another tab) -- and **ghost lines** in the Record screen's entry window ("Uploading 42%" / "Transcribing…" under the day's text, where the words will land). The ghost lines are the only place status is put into words. Nothing sits at the top of the page: an earlier top tray pushed the Record screen down into the orb. Upload completion does **not** switch tabs.

## Backend (`backend/main.py`)
Single-file FastAPI app.
- **No app-level auth.** Access is restricted at the network layer: reachable only through the `tailscale` sidecar container (see [networking.md](networking.md)) -- no API key to configure or rotate.
- **Rate limiting** runs on `/api/*` -- per-IP sliding window, keyed off `X-Forwarded-For` (set by the sidecar's proxy)
- **Model loading** -- `faster-whisper` loaded once at startup in a module-level variable; `/api/transcribe` returns 503 until ready
- **Static serving** -- `frontend/dist/` mounted at `/` via `StaticFiles(html=True)`; must remain the last mount so it acts as SPA fallback
- **No database.** The Obsidian vault holds every entry as a `<date>/NN - H.MMpm.{txt,audio}` pair; an in-memory index built at startup answers reads. Ids derive from the file path, pending state is "audio with no `.txt`", nothing Vesper stores is unique to it. Read [vault.md](vault.md) before touching anything that reads/writes an entry.
- `local_date` on upload lets the client pass the device's journal date, which becomes the vault folder (avoids UTC drift).

## API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Unauthenticated; reports `model_loaded`, indexed `entries`, whether the `vault` is mounted |
| `POST` | `/api/transcribe` | Multipart upload; returns immediately, transcribes in background |
| `GET` | `/api/transcripts[?date=]` | Newest first, served from the index |
| `GET` | `/api/calendar` | Per-day entry counts |
| `PATCH` | `/api/transcripts/{id}` | Replace transcript text -- writes the vault `.txt`, which *is* the entry |
| `DELETE` | `/api/transcripts/{id}` | **Deletes the vault files.** No second copy exists; client confirms first |
| `POST` | `/api/reindex` | Re-read the vault. Index only refreshes at startup, so this picks up edits made directly in Obsidian |

## Frontend (`frontend/src/`)
- `App.jsx` -- owns all state: connectivity gate, transcripts list, calendar data, pending uploads, the upload queue. Three tabs: Record / Calendar / Entries. **The Recorder stays mounted on every tab** (hidden with `visibility`, not `display:none`, which would drop the carousel/entry-window scroll positions) so leaving the tab mid-recording doesn't kill the mic; the nav ring turns ember to flag it from the other tabs.
- `lib/useUploadQueue.js` -- the background upload queue (see request flow). Sequential on purpose: parallel uploads only split one uplink.
- `components/NavProgressRing.jsx` -- the Record-tab ring (see request flow). App's `.notices` stack now holds only PendingUploads (failed uploads) and owns the safe-area inset.
- `components/TranscriptList.jsx` -- entry cards, grouped month -> day. Each card has an **edit** affordance (pencil) where a delete button used to sit; opening it swaps the card body for a textarea and reveals Delete / Cancel / Save. **Delete lives only inside edit mode** -- one step deeper deliberately, since a destructive control on the card face was a stray tap from wiping an entry. Still confirms before firing.
- `lib/api.js` -- all REST calls; no auth headers (network-level access control via Tailscale)
- `lib/db.js` -- IndexedDB wrapper for the offline upload queue
- `lib/recorder.js` -- `MediaRecorder` wrapper; detects iOS MIME type (`audio/mp4` vs `audio/webm`). Requests 64 kbps (`audioBitsPerSecond`) -- transparent for Whisper, several times smaller than iOS's default AAC, so uploads finish faster. `discard()` stops and drops the audio without calling `onDone`. Owns the `audio-meter` instance and closes it on stop.
- `lib/audio-meter.js` -- passive WebAudio tap on the mic stream (loudness + 32-band spectrum, auto-gained). Never connected to a destination, so it can't affect recorded audio. Its `AudioContext` is built before the first `await` in `createRecorder()` so it stays inside the user-gesture task iOS requires; **must** be closed on stop -- browsers cap concurrent contexts.
- `components/Recorder.jsx` -- the record screen. The orb carries its own caption -- "Tap to record" / "Saved" / error under the icon, the **timer** while recording. Both used to be rows above the orb and got shoved into the entry text or behind the orb when the entry or a top banner ate the page height. The entry window has **no min-height floor** for the same reason (a floor spilled it over the orb); it shrinks and re-pins to the bottom via `ResizeObserver`. A trash button beside the orb discards the take after a `confirm()`. Under the day carousel: "where you left off" -- the latest **finished** entry for the selected day (a pending one never blanks the day), **in full**, followed by ghost lines for that day's in-flight entries (local queue jobs + server entries with `transcript: null`), in a window that opens scrolled to the end (used to show only the last 300 characters). Two traps in that box: `justify-content: flex-end` bottom-anchors short text but makes overflow unreachable upward in Firefox, so the child uses `margin-top: auto` instead; pinning to the bottom once isn't enough because the serif face loads async and reflows the text taller, so the pin repeats on the next frame and again on `document.fonts.ready`.
- `components/AudioRing.jsx` -- canvas spectrum ring around the record orb, driven by `requestAnimationFrame` outside React. Writes loudness to `--vsp-level` on the orb; `Recorder.module.css` turns that into the orb's scale/glow (`.reactive` class, replaces the canned record pulse only when a meter is live).

Connectivity state machine in `App.jsx`: `connState`: `'checking'` -> `'ok'` | `'down'`. `'down'` (health check failed -- usually Tailscale not connected) shows a retry screen instead of the app.
