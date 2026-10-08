# Memoir format: what a processed day looks like

The target for any parser (today a Claude Code subagent per day; later possibly a cheaper model
over an API). The format is the contract; the model behind it is swappable. The full parser
prompt and the owner's roster live in gitignored `prompts/` (personal names); this doc holds the
shape only.

## One day = one note

`Life Wiki/Memoirs/<YYYY-MM-DD> - <Title>.md`, built from every transcript in
`Recordings/<date>/`. Recordings retell the same events at different detail; the parser MERGES
them (later, from-memory tellings win), never concatenates.

### Frontmatter (key order fixed)

| Key | Rule |
|---|---|
| `Title` | 3-9 plain words naming what happened. No purple prose ("The Weight Of..."). |
| `Date` | Equals the filename date. |
| `Tags` | Closed set of 15 emoji. Anything else fails verify. |
| `Feeling` | Exactly one of 6 emoji. The calendar view only renders these. |
| `people` | Links to people/Leos notes **that exist**. Public figures never. |
| `media` | Only what the author himself watched/played/read/listened to, linked to the exact existing title. Shelf board games link to their Board Games note. |
| `restaurants` | Only places eaten at / ordered from that have a Food note. Chains never. |
| `source`, `recordings` | `journal`, and the recordings folder path. |

### Body (order fixed, empty sections omitted)

A one-line gist quote, then `## Overview`, `## Feelings & Reflections`, `## World Events & News`,
`## Daily Timeline` (first person, concrete, everything kept), `## Threads` (still open / closed
today), `## Keepers`, and a collapsed `> [!note]- Transcript notes` callout: every correction,
guess and dropped garble, so the body never has to hedge.

## The sidecar (one JSON per day)

Where uncertainty goes instead of into the journal: `questions` (with `severity` high/low),
`media` / `restaurants` / `people` proposals for notes that don't exist yet, `plays` (board games
played: game, players, winner, rounds), `dropped` (superseded retellings), and `unlinked` (links
the guard removed). Nothing in it reaches the vault without the owner, except `plays`, which
become play-log notes.

## Deterministic steps around the model

These are code, so a weaker model cannot break them:

1. **Catalog** in: the existing Reading List titles, Food places and board games (with aliases)
   are handed to the parser next to the roster, so it links real titles.
2. **Link guard** out: any link to a note that doesn't exist is unlinked and logged in the
   sidecar. Dead links are impossible by construction.
3. **Verify**: frontmatter keys, closed vocabularies, title shape, no Whisper garbage, required
   sections. A failing draft never touches the vault.
4. **Install**: write the note; turn sidecar `plays` into play notes (create-only).

## Swapping the model

The model step is one shell command (`MEMOIR_DISPATCH`, `{instruction}` placeholder) that must
read the instruction file and write exactly the draft + sidecar paths it names. Any runner that
honours that contract can replace the Claude Code subagent, e.g. a small script calling a cheap
model through an OpenRouter key already on the machine. Steps 1-4 stay unchanged, which is the
point: the quality floor lives in code, not in the model. Before switching, re-parse a handful of
already-reviewed days with the new model and diff them against the accepted entries.
