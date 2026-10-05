"""Vesper transcription worker -- the GPU half, started on demand.

Runs as its own container (`transcriber` in docker-compose.yml). The host-side
waker (ops/windows/waker.ps1) starts it when the API reports recordings
waiting; it loads the model, transcribes everything pending, and exits once the
queue has stayed empty for IDLE_EXIT_SECONDS, freeing the GPU and its RAM.

The vault is the queue: pending means audio with no `.txt` beside it. The API
process picks the finished transcripts up from the vault (`refresh_pending`).

Exit codes: 0 clean, 3 if any recording failed (the waker backs off on non-zero
so a poisoned file can't spin the container up every few seconds).
"""

import os
import re
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "large-v3")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cuda")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8_float32")
WHISPER_INITIAL_PROMPT = os.getenv("WHISPER_INITIAL_PROMPT") or None

VAULT_RECORDINGS_DIR = Path(os.getenv("VAULT_RECORDINGS_DIR", "/vault/recordings"))
AUDIO_SUFFIXES = {".m4a", ".webm", ".mp3", ".wav", ".mp4", ".ogg"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

IDLE_EXIT_SECONDS = float(os.getenv("WORKER_IDLE_EXIT_SECONDS", "60"))
POLL_SECONDS = 5
# An upload is copied into the vault in place, so a file still being written is
# visible. Its mtime keeps moving while bytes land; wait until it has settled.
SETTLE_SECONDS = 10


def log(msg: str) -> None:
    print(f"[worker] {msg}", flush=True)


def _parse_substitutions(raw: str) -> list[tuple[re.Pattern, str]]:
    """Parse 'Wrong:Right,Also Wrong:Right' into compiled whole-word,
    case-insensitive regexes. Misheard names are the main use case."""
    pairs = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk or ":" not in chunk:
            continue
        wrong, right = chunk.split(":", 1)
        wrong, right = wrong.strip(), right.strip()
        if wrong and right:
            pairs.append((re.compile(rf"\b{re.escape(wrong)}\b", re.IGNORECASE), right))
    return pairs


WHISPER_SUBSTITUTIONS = _parse_substitutions(os.getenv("WHISPER_SUBSTITUTIONS", ""))


def find_pending() -> list[Path]:
    """Audio files with no transcript beside them, oldest first."""
    found: list[tuple[float, Path]] = []
    if not VAULT_RECORDINGS_DIR.is_dir():
        return []
    now = time.time()
    for day_dir in VAULT_RECORDINGS_DIR.iterdir():
        if not day_dir.is_dir() or not DATE_RE.match(day_dir.name):
            continue
        try:
            contents = list(day_dir.iterdir())
        except OSError:
            continue
        txts = {p.stem for p in contents if p.suffix.lower() == ".txt"}
        for path in contents:
            if path.suffix.lower() not in AUDIO_SUFFIXES or path.stem in txts:
                continue
            try:
                mtime = path.stat().st_mtime
            except OSError:
                continue
            if now - mtime < SETTLE_SECONDS:
                continue
            found.append((mtime, path))
    return [p for _, p in sorted(found)]


model = None


def load_model() -> None:
    global model
    from faster_whisper import WhisperModel

    log(f"Loading '{WHISPER_MODEL}' on {WHISPER_DEVICE} ({WHISPER_COMPUTE_TYPE})...")
    started = time.monotonic()
    model = WhisperModel(
        WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE
    )
    log(f"Model loaded in {time.monotonic() - started:.0f}s.")


def transcribe_file(path: str) -> str:
    segments, _info = model.transcribe(
        path,
        vad_filter=True,
        language="en",
        beam_size=5,
        initial_prompt=WHISPER_INITIAL_PROMPT,
        # Stop repetition loops ("I'm sorry, I'm sorry, ..."). Feeding each
        # window's text into the next let one stuck window poison the rest,
        # and the silence threshold drops text invented over long pauses.
        # See .claude/docs/transcription.md "Repetition loops".
        condition_on_previous_text=False,
        word_timestamps=True,
        hallucination_silence_threshold=2,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    for pattern, replacement in WHISPER_SUBSTITUTIONS:
        text = pattern.sub(replacement, text)
    return text


def write_transcript(audio: Path, text: str) -> bool:
    """Write the .txt beside the audio, atomically (the API reads it the moment
    it exists). False if the recording was deleted while we worked on it."""
    if not audio.exists():
        log(f"{audio.name} was deleted mid-transcription; dropping result.")
        return False
    final = audio.with_suffix(".txt")
    tmp = audio.with_name(audio.stem + ".txt.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(final)
    return True


def main() -> int:
    failed: set[Path] = set()
    idle_since: float | None = None

    while True:
        pending = [p for p in find_pending() if p not in failed]
        if pending:
            idle_since = None
            if model is None:
                try:
                    load_model()
                except Exception as exc:  # noqa: BLE001
                    log(f"Model failed to load: {exc}")
                    return 3
            for audio in pending:
                try:
                    started = time.monotonic()
                    text = transcribe_file(str(audio))
                    if write_transcript(audio, text):
                        log(f"{audio.parent.name}/{audio.stem}: {len(text.split())} words "
                            f"in {time.monotonic() - started:.0f}s")
                except Exception as exc:  # noqa: BLE001
                    # Leave it pending (audio is safe) but don't retry it this run.
                    log(f"FAILED {audio.parent.name}/{audio.stem}: {exc}")
                    failed.add(audio)
            continue  # rescan straight away: more may have arrived meanwhile

        if idle_since is None:
            idle_since = time.monotonic()
        elif time.monotonic() - idle_since >= IDLE_EXIT_SECONDS:
            log("Queue empty; exiting to free the GPU.")
            return 3 if failed else 0
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    sys.exit(main())
