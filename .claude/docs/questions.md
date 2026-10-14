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
`{"via": "voice", "audio": "answers/q1.webm"}`, `{"via": "unsure"}` (owner can't tell: **look again**) or `{"via": "wrong", "text": "optional note"}`
(the owner says the question is mistaken; neither is an answer, both mean "look again"). A spoken answer is saved to
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

1. Re-transcribes wider than the first pass (+-25s, beam 10, hotwords from the guess/roster/
   mishearings) and re-parses the whole day with a "could not tell, take a fresh look: don't repeat
   the wording, say what you checked" block, plus the owner's other answers.
2. Not raised again -> the question is dropped and logged under `rechecked` (outcome "resolved by
   re-reading"); the owner is not asked.
3. Raised again -> the question is rewritten with the new wording, `why` (the parser's `affects`),
   `round`+1, `answer` back to `null`: an ordinary card again, plus one Pharos push.
4. Questions the re-read newly raises (and that duplicate nothing already open or answered) are
   added.

The day installs only when no question is open or `unsure` (run_v2 also refuses to install a day
whose state flips to `unsure` mid-run). Each re-ask needs the owner to press **Not sure** again, so
the loop can't spin on its own.

**`wrong` takes the same road** and is never auto-settled: the owner's note goes to the parser as
strong evidence ("they were there, but check it against the transcripts"), the day is re-read, and
only then does the question either drop (the parser no longer raises it; the note is kept under
`rechecked` and handed to the install parse as the owner's word) or come back rewritten with a
`why`. A recurring misreading still belongs in mishearings/roster, not in a note.

Status: `open` until the pipeline installs the day, then `resolved` (the app stops listing it).

## Who does what

| Step | Where |
|---|---|
| Parse a day; high-severity questions → write `questions.json`, don't install, one Pharos push | memoir pipeline, `run_v2.py --hold` (`.horizon/memoir-v2/driver/`, gitignored) |
| `unsure` answers → wider re-hear, whole-day re-parse, drop or re-ask | same, `run_v2.recheck_day` + `questions.apply_recheck`; tests `driver/test_questions_loop.py` |
| Before asking: re-transcribe each question's passage (+-8s, beam 10, likely names as Whisper `hotwords`) and re-parse with any changed wording as evidence; only what's still high is asked | memoir pipeline, `driver/retranscribe.py` (one-off `docker compose run` of the transcriber image) |
| List open days, record answers | `GET /api/questions`, `POST/DELETE /api/questions/{date}/{qid}/answer`, `POST .../voice`; Questions tab |
| Show the passage around a question's quote + when that recording was made | `GET /api/questions/{date}/{qid}/context` (reads the day's `.txt`s and audio mtimes; quote matched by word sequence, not verbatim) |
| Transcribe spoken answers | `worker.py` |
| All blocking questions answered → re-parse with the answers, install, mark `resolved` | memoir pipeline, next run |

A question's answer is ground truth for that day only. A name ruling that should apply everywhere
belongs in the pipeline's data (mishearings / people config), not in an answer.

## App

Fourth tab, **Questions**, with a badge of unanswered questions and a To answer / Answered split. One card per question: the
question, the transcript quote, **Show context** (transcript around the quote, highlighted, plus
"Recorded Sun Oct 11 · 8:13 PM · filed under Sat, Oct 10"), a "Yes, <guess>" button when there is a
guess, a text field, **Not sure** / **Question is wrong** (both: look again; typed text goes along as the
note), and a
mic button (tap to start, tap to stop and send; uses `lib/recorder.js`). Answered cards show the
answer with **Change** (clears it). While a spoken answer is transcribing the tab polls every 4s.

## Not built yet

- **Play the audio at the quote**: no audio route exists and transcripts carry no timestamps;
  `retranscribe.py` already has the window to record an `audio_at`.
- The app doesn't show `rechecked` (questions the re-read settled without asking). It is in
  `questions.json` if the owner wants to audit what was dropped.
