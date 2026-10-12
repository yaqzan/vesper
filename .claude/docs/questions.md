# Memoir questions: ask before a day is written up

When the memoir parser isn't sure about something that would change a fact in the entry (who
someone is, whether something happened), the day is **held**: its questions go to the app, the
owner answers (tap, type or speak), and the next pipeline run writes the day with the answers as
ground truth. Owner's choice 2026-10-11: answer in the app, by voice if wanted, and a day waits
until every question is answered.

## The file: `Recordings/<date>/questions.json`

One per held day, in the vault (no database, same as entries). The pipeline creates it and owns
`status`; the app only ever writes a question's `answer`.

```json
{"date": "2026-10-09", "status": "open", "created": "...",
 "questions": [{"id": "q1", "topic": "...", "quote": "what the transcript said",
                "question": "...", "guess": "the parser's best guess or null",
                "blocking": true, "answer": null}]}
```

`answer` is one of `{"via": "guess"}` (the guess is right), `{"via": "text", "text": "..."}`,
`{"via": "voice", "audio": "answers/q1.webm"}`, `{"via": "unsure"}` (owner can't tell: **look again**) or `{"via": "wrong", "text": "optional why"}`
(the question is mistaken). A spoken answer is saved to
`Recordings/<date>/answers/<qid>.<ext>` and transcribed by the normal worker into `<qid>.txt`
beside it (`worker.find_pending` scans `answers/`; `/api/queue` counts them so the waker starts
the GPU). Answer files are not entries: the index and the memoir packer only read the day
folder's top level.

Optional question fields the pipeline may set and the app shows: `why` (what answering changes /
what new evidence was found) and `round` (1 = first ask; shown as "Asked again (round N)").

## Never install a day with an unsure point

Owner's rule 2026-10-12: a memoir is never committed with an unresolved point. `unsure` is not a
way to release a day; it sends the question **back round the loop with new information** until it
is resolved. The app only records it (the card shows "looked at again", the badge stops counting
it because nothing is waiting on the owner). On its next run the pipeline, for each `unsure`
question:

1. Re-transcribes wider than the first pass (more seconds each side, beam 10, hotwords from the
   roster and neighbouring days) and re-parses the day with the whole recording, neighbouring days
   and the roster as context.
2. Resolved with confidence -> drops the question (record how in the file) and carries on.
3. Still open -> rewrites the question with the new evidence, sets `why`, increments `round`,
   sets `answer` back to `null`, so it returns to the owner as an ordinary card.

The day installs only when no question is open or `unsure`. A `wrong` answer drops the question
and is passed to the re-parse as "the premise was mistaken".

Status: `open` until the pipeline installs the day, then `resolved` (the app stops listing it).

## Who does what

| Step | Where |
|---|---|
| Parse a day; high-severity questions → write `questions.json`, don't install, one Pharos push | memoir pipeline, `--hold` mode (outside this repo) |
| Before asking: re-transcribe each question's passage (+-8s, beam 10, likely names as Whisper `hotwords`) and re-parse with any changed wording as evidence; only what's still high is asked | memoir pipeline, `driver/retranscribe.py` (one-off `docker compose run` of the transcriber image) |
| List open days, record answers | `GET /api/questions`, `POST/DELETE /api/questions/{date}/{qid}/answer`, `POST .../voice`; Questions tab |
| Show the passage around a question's quote + when that recording was made | `GET /api/questions/{date}/{qid}/context` (reads the day's `.txt`s and audio mtimes; quote matched by word sequence, not verbatim) |
| Transcribe spoken answers | `worker.py` |
| All blocking questions answered → re-parse with the answers, install, mark `resolved` | memoir pipeline, next run |

A question's answer is ground truth for that day only. A name ruling that should apply everywhere
belongs in the pipeline's data (mishearings / people config), not in an answer.

## App

Fourth tab, **Questions**, with a badge of unanswered questions. One card per question: the
question, the transcript quote, **Show context** (transcript around the quote, highlighted, plus
"Recorded Sun Oct 11 · 8:13 PM · filed under Sat, Oct 10"), a "Yes, <guess>" button when there is a
guess, a text field, **Not sure** (look again) / **Question is wrong** (typed text goes along as the
why), and a
mic button (tap to start, tap to stop and send; uses `lib/recorder.js`). Answered cards show the
answer with **Change** (clears it). While a spoken answer is transcribing the tab polls every 4s.

## Not built yet

- **The re-ask loop above** (pipeline side): `unsure` handling, `why`, `round`. Until it exists an
  `unsure` question just sits there and its day stays held.
- **Play the audio at the quote**: no audio route exists and transcripts carry no timestamps;
  `retranscribe.py` already has the +-8s window to record an `audio_at`.
