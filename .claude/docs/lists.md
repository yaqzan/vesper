# Lists: new Reading List titles and Food places from parsed days

The memoir parser's sidecar carries `media` and `restaurants` proposals for each day. The Reading
List and Food are human-judged, so nothing is written until the owner approves it in the app.
Same shape as [questions.md](questions.md): the pipeline proposes in a vault file, the app only
records a decision, the pipeline applies it on its next run.

## The file: `Recordings/<date>/additions.json`

Written by the pipeline after a day **installs** (a held day proposes nothing yet). One item per
new title/place:

```json
{"date": "2026-10-07", "types": ["Film", "TV", "..."],
 "items": [{"id": "m-weapons", "kind": "media", "name": "Weapons", "media_kind": "film",
            "status": "Finished", "type": "Film", "note": "...", "match": null,
            "memoir": "2026-10-07 - Title", "decision": null, "applied": null}]}
```

- Skipped when the parser says it exists (`catalog_title`), when a note with that name exists, or
  when another day already proposed it. Restaurants whose name wasn't caught ("name not said") are
  not proposed. A parenthetical in a name ("Qbob (heard as cube bob)") is dropped from `name`.
- `match` (restaurants): a Food place with a similar name, so "Skyview Bistro" vs "Sky Bistro"
  shows "Same as ..." instead of a duplicate.
- The app writes only `decision`: `{"via": "add", "name"?, "type"?}`, `{"via": "skip"}` or
  `{"via": "link"}` (it's the existing note). The pipeline writes `applied`
  (`created` / `exists` / `skipped` / `linked`); a day disappears from the app once all its items
  are applied.

## Who does what

| Step | Where |
|---|---|
| Propose after install, one Pharos push | `.horizon/memoir-v2/driver/additions.py` `collect`, called from `run_v2` install |
| List days, record a decision | `GET /api/additions`, `POST/DELETE /api/additions/{date}/{id}`; **Lists** tab (badge = undecided) |
| Write decided items, create-only | `additions.apply_decided`, start of every `run_v2 --apply` (host side: the container can't see Reading List/Food) |
| Backfill from existing sidecars | `py -3.11 driver/additions.py --backfill --since <date>` |

## What gets written

- **Reading List:** `Reading List/Media/<name>.md` with `Type`, `Status`, `Epoch` (month rule:
  Sep-Nov = Fall), `Started` (+ `Finished`), `mentions`, `source: journal`. **Score, Hours and
  Notes are never filled.** An existing note is never touched.
- **Food:** `Food/<name>/<name>.md` from the vault's `Templates/Restaurant.md` body with
  `visited`, `memoirs`, `source: journal`; rating/cuisine/city blank. Existing place: untouched.
- Board games are not Reading List items; skip them in the app (the parser links shelf games to
  their Board Games note, so they normally aren't proposed).

- **Status updates (`kind: "update"`):** an existing Reading List note whose `Status` is
  `Current`/blank, when a day says finished/dropped, is proposed as "Current -> Finished". Applying
  sets `Status` (+ `Finished` date if missing) and nothing else; any other status is left alone
  (the old file goes to `out/replaced-media/`).
- **Rating (optional, in the app):** whole stars for titles (`Score /5` as ⭐️ x N, set only when
  the note's is blank), halves for restaurants (`rating:`). A "3/5"-style figure in the parser's
  note pre-fills the picker (`rating_hint`). Hours/Notes are never written.

## Not built

- Adding the new day's memoir link to an existing Food place's `memoirs`.
