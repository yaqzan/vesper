# The vault is the data

**There is no database.** Every entry is a pair of files in the Obsidian vault:

```
<VESPER_VAULT_DIR>\<date>\
    NN - H.MMpm.txt      the transcript
    NN - H.MMpm.m4a      the audio
    <date>.md            the memoir note (Spore's; Vesper never touches it)
```

Vesper reads and writes those files directly. Nothing it stores is unique to it -- delete everything under `backend/` except the code and the app rebuilds itself from the vault on the next boot.

## Why it's shaped this way

It used to be a SQLite database *plus* `backend/recordings/` *plus* a mirror into the vault: three copies of every transcript, kept in step by sync code. They drifted -- the vault backfill silently created duplicate entries for recordings an earlier migration had already copied across (2026-08-22: 4 found, removed). One copy can't disagree with itself, so the other two were deleted. The vault won because it has the most claims on it: Obsidian edits it, Spore's memoir pipeline reads it, and it's what gets backed up.

## The index

A full vault read is ~1.4s through the Windows bind mount and grows with the corpus -- too slow for a poll-driven app. Reads are answered from an **in-memory index** built at startup (`scan_vault` / `rebuild_index`).

- The index is **pure cache** -- holds nothing the files don't.
- **Identity is the file's path**: `sha1("<date>/<stem>")[:16]`. Deterministic, so ids survive a rebuild with nothing to persist.
- **`transcript is None` means "still transcribing"** -- audio present, no `.txt` beside it yet. The vault encodes pending state by itself, so there's no queue to keep in sync. At startup, any such entry is re-queued; a crash mid-transcription recovers for free. (Verified zero pre-existing audio-without-transcript files before relying on this.)
- `<date>.md` memoir notes are neither `.txt` nor audio, so they never become entries.

### Refreshing

The index refreshes **at startup and on Vesper's own writes only** -- chosen over background polling. Consequence: a transcript edited directly in Obsidian won't appear in Vesper until it re-reads. Force it without a restart:

```powershell
curl -X POST http://localhost:8000/api/reindex
```

## Filenames

`NN - H.MMpm`, continuing the day folder's existing numbering. No title -- Vesper has no titling step, and inventing one would need an AI pass that can't run at upload time. Older migrated files carry AI titles (`01 - 6.58pm - Late night coding...`); both forms parse.

**Timezone is not optional.** `created_at` is UTC but filenames are local wall-clock, so everything converts through `VAULT_TZ` (`America/Toronto`). Get it wrong and evening recordings file under the next morning.

**Stems with no clock** (a handful of hand-titled files, e.g. `04 - What is a common misconception people have about you`) sit at midday plus their index in minutes -- ordered correctly against siblings, deliberately round rather than faking precision the filename never had.

## Durations

`formatMeta` shows "589 words · 3m 55s". Duration is cached in `backend/.duration-cache.json`, keyed by path, invalidated on mtime/size. Derived, disposable, gitignored.

**`MediaRecorder` webm files carry no duration in their container header** -- everything the PWA records. `ffprobe`'s metadata read returns nothing for them, so `probe_duration` falls back to decoding the file and reading the final timestamp (~1.5s for four minutes). That's why probing runs in the background after the index is already serving, never in front of a request. Anything Vesper transcribes itself skips this: Whisper reports duration directly.

Entries with no audio at all (a few transcript-only files) legitimately have no duration; the UI omits "· 0s" rather than printing a lie.

## Deleting

`DELETE /api/transcripts/{id}` **removes the vault files.** No second copy to fall back on -- real deletion, client confirms first. (Before the vault became the only store, delete deliberately spared the vault copy; that distinction no longer means anything.)

## Config

```
VAULT_RECORDINGS_DIR=/vault/recordings   # path INSIDE the container
VAULT_TZ=America/Toronto
```

Host path is bind-mounted in `docker-compose.yml`, writable, scoped to the `Recordings` folder rather than the whole vault. Point `VAULT_RECORDINGS_DIR` at an empty directory and Vesper starts empty -- not a setting to change casually.

## History

- **2026-08-22** -- missing 2026-08-10 day imported from a zip re-export (`AudioDiary_2026-08-22.zip`) by rerunning the Spore migration script's logic against the extracted `dates/2026/08/10/` folder; only day not sourced from the original `Audio Diary Export` directory.
- **2026-08-22** -- vault became the single source of truth. 31 Vesper-only recordings migrated in, 3 pre-existing duplicates skipped and 1 more found afterwards (dedupe compared text within a date folder; that pair sat on different days). `transcripts.db`, `backend/recordings/` (336 MB) and `backend/audio_queue/` deleted. Final SQLite backups kept, gitignored, as `backend/transcripts.db.bak-*`.
- Before that, the vault's history came from a **one-off** Spore migration (`C:\Development\Spore\scripts\migrate_audio_diary.py`), not a live pipeline -- which is why the two sides had drifted apart in the first place.
