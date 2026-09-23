# Transcription backend

Local `faster-whisper`, run in-process on the GTX 1080 Ti, called from a `BackgroundTask` after the upload response returns (`_run_transcription` and `transcribe_file` in `backend/main.py`).

## History: ElevenLabs, then back to local

- 2026-06-23 -- switched from local Whisper to ElevenLabs Scribe v2 (hosted API) to drop the GPU/CUDA dependency and cut upload-to-result latency.
- 2026-08-18 -- switched back to local `faster-whisper`. Root cause: ElevenLabs' free-tier budget (10,000 credits/month, ~330 credits/min => ~30 min/month) couldn't cover daily 15+ min journaling -- a normal recording silently came back `word_count: 0` once the monthly quota ran out mid-month. The driving/check-later workflow never needed ElevenLabs' latency edge, and the idle 1080 Ti made the cloud API pointless. Async upload/polling/offline-queue plumbing added during the ElevenLabs era was kept; only the inference call inside `_run_transcription` changed.

## GPU / compute type -- critical

The GTX 1080 Ti (Pascal) does **not** support `float16`. Always:
```
WHISPER_COMPUTE_TYPE=int8_float32
```
`float16` crashes the model load. See memory: [Vesper deployment host](../../../memory/vesper-deployment-host.md) (machine-level GPU facts).

This rule is tied to the card, not to Vesper. If the GPU is replaced with anything Turing or newer (e.g. an RTX 3090 / 5060 Ti -- a swap was being weighed 2026-09-23), switch to `float16` and update this section and the CLAUDE.md invariant in the same edit.

Pascal is also losing software support. CUDA 13 dropped it, and PyTorch's cu128 wheels (2.8+) ship no sm_61 kernels. `faster-whisper` runs on CTranslate2, not PyTorch, so today's setup is unaffected. Any PyTorch-based model on this card needs the cu126 wheels or PyTorch <= 2.7.

## Model choice

`WHISPER_MODEL=large-v3` (not `large-v3-turbo`, not `distil-large-v3`).

Compared all three on real 13-15 min voice journal entries (2026-08-18): time differences were small and irrelevant to the workflow (16s / 21s / 55s on a 13-min clip). `distil-large-v3` was fastest but introduced real semantic errors (e.g. "very long" instead of "very low"). `large-v3` was most accurate; the extra ~35s over `large-v3-turbo` is free given the workflow. Re-ran against 3 ElevenLabs-transcribed entries -- roughly a wash (ElevenLabs slightly better on some proper nouns, local better with the name substitution below) -- not worth re-transcribing old entries for accuracy alone.

Names are still imperfect either way -- Whisper mishears proper nouns regardless of engine (e.g. "Hadi" -> "Hattie", "Farwa" -> "Faruwa"). Inherent model limitation, not a config bug; not worth chasing beyond the substitution list below.

**Re-checked 2026-09-23: staying on `large-v3`.** OpenAI released no Whisper successor. Its hosted models (`whisper-1`, `gpt-4o-transcribe`) are being retired in Feb 2027, which doesn't affect this local setup. Open models now beat `large-v3` on benchmark word error rate (~7.4%): Granite Speech 4.1 (~5.3%), Canary-Qwen 2.5B (5.6%), Voxtral (5.9%), plus the much faster Parakeet. The reasons not to switch:
- None of them fixes the real pain, which is proper names.
- All of them are PyTorch-based, which hits the Pascal wall above.
- Canary-Qwen needs ~10 GB in fp32 on an 11 GB card.
- The LLM-decoder models need chunking for 13-15 min entries, where Whisper handles long-form natively.

Worth revisiting after a GPU upgrade. Settle it with the same kind of bake-off on real entries as 2026-08-18, scored on names and semantic errors, not benchmark WER.

## Re-transcribing a failed entry

A failed transcription leaves audio in the vault with **no `.txt` beside it** -- identical to a pending entry, so a restart re-queues it automatically (`on_startup` in `main.py`). Nothing to run by hand.

To force a redo of an entry that *did* produce a transcript: delete its `.txt` from the vault day folder and restart. See [vault.md](vault.md).

The two entries stranded at `word_count: 0` by the ElevenLabs quota wall (Aug 17/18) were recovered this way on 2026-08-22 -- 1280 and 1051 words respectively.

## Initial prompt + substitutions

Two optional env vars in `backend/.env`, both consumed in `main.py`:

- `WHISPER_INITIAL_PROMPT` -- primes the model with names/context (e.g. `"My partner Alex and I..."`), passed straight to `model.transcribe()`.
- `WHISPER_SUBSTITUTIONS` -- post-processing find/replace for names Whisper still gets wrong. Format: `Wrong:Right,Also Wrong:Right` (comma-separated, whole-word, case-insensitive, applied in `transcribe_file` after the transcript text is assembled).

Rules for the list (the real values live only in the gitignored `backend/.env`):

- Add an entry only after it appears in a real transcript. Don't pre-guess variants.
- Don't blanket-substitute a name that also belongs to a real, different person: it corrupts every mention of them.
- An exclusion is only safe while the evidence is thin. Re-check exclusions against the whole corpus (one was wrong and became a substitution after the 2026-09 memoir backfill).

The owner's full table is `prompts/mishearings.tsv` (gitignored, local only): source of truth for both this env var and the memoir parser's roster. Its `scope` column marks rows safe as blind whole-word substitutions (`sub`) versus rows that need sentence context and must never go into `WHISPER_SUBSTITUTIONS` (`context`). `.env` is not auto-generated from it; keep them in step by hand.
