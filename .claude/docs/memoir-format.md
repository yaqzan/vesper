# Memoir format: what a processed day looks like

The contract for the memoir parser. The parser prompt, the roster, the mishearings table and the
slang glossary live in gitignored `prompts/` (personal names); the pipeline that runs it lives in
gitignored `.horizon/` (`memoir-v2` runs it, `memoir-pilot` holds the prompts and the experiments
that chose them). This doc holds the shape and the reasons only.

## Pipeline (chosen 2026-10-11 after four judged pilot rounds)

Three model passes per day, all through `claude -p` on the owner's subscription (no API key):

1. **Names pass (Haiku):** finds misheard names, places, products and slang against the roster,
   mishearings table and glossary. Code applies the fixes to the transcript; the model never
   rewrites it.
2. **Writer (Sonnet):** the parser prompt + layout C + the accuracy and voice rules.
3. **Check (Sonnet):** re-reads the draft against the transcripts and fixes wrong people, flipped
   meaning, added details, dropped hedges, sanitised wording and slang.

Measured on 12 days, blind-judged against the raw transcripts: about 0.75 wrong facts a day, down from
6.75 for the earlier single-pass entries.

**Rules stay general; one-off fixes go in data.** A misheard name is a mishearings row, a person
is a roster line, a slang term is a glossary row. Never a name or a specific day in the prompts.
The roster is regenerated from that data before every run (a row added to the TSV does nothing
until then).

## One day = one note

`Life Wiki/Memoirs/<YYYY-MM-DD> - <Title>.md`, built from every transcript in
`Recordings/<date>/`. Recordings retell the same events; the parser merges them (later tellings
win), never concatenates. Re-parsing an existing day keeps its filename and `Title`, because
People, Leos, play and food notes link to it by filename.

### Frontmatter (key order fixed)

| Key | Rule |
|---|---|
| `Title` | 3-9 plain words naming what happened. No purple prose. |
| `Date` | Equals the filename date. |
| `Tags` | Closed set of 15 emoji. Anything else fails verify. |
| `Feeling` | Exactly one of 6 emoji. The calendar view only renders these. |
| `people` | Links to People/Leos notes **that exist**. Public figures never. |
| `media` | Only what the author watched/played/read/listened to, linked to the exact existing title. Shelf board games link to their Board Games note. |
| `restaurants` | Only places eaten at that have a Food note. Chains never. |
| `source`, `recordings` | `journal`, and the recordings folder path. |

### Body (layout C, empty sections omitted)

1. A one-line `>` gist: what kind of day it was.
2. `## The Day in Brief`: 3-6 bullets, `**Headline.** one sentence`, most important first, about
   the day's events (routine sleep times aren't news).
3. `## Breakdown`: the day as a story, grouped `### Morning` / `### Afternoon` / `### Evening` /
   `### Night` (only the parts the day had); each scene is a paragraph that opens with a bold
   title. First person, past tense, written as the author that same night, in the author's own
   register (slang and blunt opinions kept, not sanitised). A last `### Odds and ends` for details
   with no place in the day.
4. `## Feelings & Reflections`, `## World Events & News`, `## Threads` (still open / closed
   today), `## Keepers`.
5. A collapsed `> [!note]- Transcript notes` callout: every correction, guess and dropped garble.

## The sidecar (one JSON per day)

Where uncertainty goes instead of into the journal: `questions` (severity high/low),
`media` / `restaurants` / `people` proposals, `plays`, `meals` (tied to Spice recipes),
`leo_visits`, `dropped`, `unlinked`. **High-severity questions hold the day** and go to the app
([questions.md](questions.md)); answers come back as ground truth on the next run. `plays` become
play-log notes (create-only); `media` / `restaurants` go to the app's Lists tab ([lists.md](lists.md))
for approval; nothing else reaches the vault without the owner.

## Deterministic steps around the models

Code, so a model can't break them: catalog in (existing Reading List / Food / board-game titles),
link guard out (a link to a missing note is unlinked and logged), verify (keys, closed
vocabularies, title shape, required sections; a failing draft never touches the vault), install
(backup of the replaced note, owner-edited frontmatter carried over, play notes).
