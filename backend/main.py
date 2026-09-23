"""Vesper backend — FastAPI transcription server.

The Obsidian vault is the single source of truth. Every entry is a pair of
files in `<vault>/<date>/`:

    NN - H.MMpm.txt     the transcript   (the data)
    NN - H.MMpm.m4a     the audio        (the data)

There is no database. On startup the vault is scanned into an in-memory index
that the read endpoints answer from; writes go to the vault first and update
the index after. Delete the index and nothing is lost — it is rebuilt from the
files. See .claude/docs/vault.md.

Also serves the compiled PWA as static files. Single origin: this one server
(port 8000) serves both the API and the app.
"""

import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import aiofiles
from dotenv import load_dotenv
from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()

# --- Configuration -----------------------------------------------------------

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "large-v3")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cuda")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8_float32")
WHISPER_INITIAL_PROMPT = os.getenv("WHISPER_INITIAL_PROMPT") or None


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

MAX_UPLOAD_MB = float(os.getenv("MAX_UPLOAD_MB", "50"))
RATE_LIMIT_API_PER_MIN = int(os.getenv("RATE_LIMIT_API_PER_MIN", "300"))
RATE_LIMIT_TRANSCRIBE_PER_MIN = int(os.getenv("RATE_LIMIT_TRANSCRIBE_PER_MIN", "20"))
MAX_UPLOAD_BYTES = int(MAX_UPLOAD_MB * 1024 * 1024)

BACKEND_DIR = Path(__file__).resolve().parent
FRONTEND_DIST = (BACKEND_DIR.parent / "frontend" / "dist").resolve()

# The vault. Everything lives here; without it there is nothing to serve.
VAULT_RECORDINGS_DIR = Path(os.getenv("VAULT_RECORDINGS_DIR", "/vault/recordings"))
# Filenames carry local wall-clock time ("6.58pm") while timestamps are handled
# in UTC, so the vault's timezone has to be explicit.
VAULT_TZ = ZoneInfo(os.getenv("VAULT_TZ", "America/Toronto"))

# Purely derived: audio durations are expensive to probe and never change for a
# given file, so they're memoised across restarts. Safe to delete at any time.
DURATION_CACHE_PATH = BACKEND_DIR / ".duration-cache.json"

AUDIO_SUFFIXES = {".m4a", ".webm", ".mp3", ".wav", ".mp4", ".ogg"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
INDEX_RE = re.compile(r"^(\d{2})\s*-\s*")
CLOCK_RE = re.compile(r"^(\d{1,2})\.(\d{2})\s*(am|pm)\b", re.IGNORECASE)

# A recording made before this hour belongs to the previous journal day (the
# app's own rule — JOURNAL_DAY_START_HOUR in frontend/src/lib/format.js). The
# folder name is already the journal date, so an early-hours clock time means
# the real calendar moment falls on the NEXT day.
JOURNAL_DAY_START_HOUR = 7
# Stems with no clock at all (a few hand-titled files) sit at midday, ordered
# by their index — obviously round rather than faking a precision the filename
# never had.
SYNTHETIC_HOUR = 12


# --- Request models ----------------------------------------------------------

class TranscriptEdit(BaseModel):
    # Generous ceiling: an hour of speech is well under 100k characters, and the
    # cap only exists so a runaway client can't push arbitrary bulk at us.
    transcript: str = Field(max_length=200_000)


# --- Rate limiting -----------------------------------------------------------

class RateLimiter:
    """Tiny in-memory sliding-window limiter, keyed per client IP."""

    def __init__(self, max_events: int, window_seconds: float = 60.0):
        self.max = max_events
        self.window = window_seconds
        self._hits: dict[str, deque] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        if self.max <= 0:
            return True
        now = time.monotonic()
        cutoff = now - self.window
        with self._lock:
            dq = self._hits.get(key)
            if dq is None:
                dq = deque()
                self._hits[key] = dq
            while dq and dq[0] < cutoff:
                dq.popleft()
            if len(dq) >= self.max:
                return False
            dq.append(now)
            return True


api_limiter = RateLimiter(RATE_LIMIT_API_PER_MIN)
transcribe_limiter = RateLimiter(RATE_LIMIT_TRANSCRIBE_PER_MIN)


def get_client_ip(request: Request) -> str:
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# --- The index ---------------------------------------------------------------

@dataclass
class Entry:
    """One vault recording, as the API sees it. `transcript is None` means the
    audio is there but the .txt isn't yet — i.e. still transcribing."""

    id: str
    date: str
    stem: str
    created_at: str
    transcript: str | None = None
    word_count: int | None = None
    duration_seconds: float | None = None
    audio_name: str | None = None

    def public(self) -> dict:
        return {
            "id": self.id,
            "date": self.date,
            "created_at": self.created_at,
            "transcript": self.transcript,
            "word_count": self.word_count,
            "duration_seconds": self.duration_seconds,
        }


@dataclass
class Index:
    entries: dict[str, Entry] = field(default_factory=dict)
    lock: threading.RLock = field(default_factory=threading.RLock)

    def sorted(self) -> list[Entry]:
        with self.lock:
            return sorted(
                self.entries.values(), key=lambda e: e.created_at, reverse=True
            )


index = Index()


def entry_id(date: str, stem: str) -> str:
    """Identity is the file's place in the vault, hashed to something
    URL-safe. Deterministic, so it survives a rebuild — no id needs storing."""
    return hashlib.sha1(f"{date}/{stem}".encode("utf-8")).hexdigest()[:16]


def parse_created_at(date: str, stem: str) -> str:
    """UTC timestamp for a `NN - H.MMpm - Title` stem in a `<date>` folder."""
    index_match = INDEX_RE.match(stem)
    slot = int(index_match.group(1)) if index_match else 0
    rest = stem[index_match.end():] if index_match else stem

    clock = CLOCK_RE.match(rest)
    if clock:
        hour12, minute, meridiem = int(clock.group(1)), int(clock.group(2)), clock.group(3)
        hour = hour12 % 12 + (12 if meridiem.lower() == "pm" else 0)
    else:
        hour, minute = SYNTHETIC_HOUR, slot

    day = datetime.strptime(date, "%Y-%m-%d")
    if hour < JOURNAL_DAY_START_HOUR:
        day += timedelta(days=1)
    return day.replace(hour=hour, minute=minute, tzinfo=VAULT_TZ).astimezone(
        timezone.utc
    ).isoformat()


# --- Duration cache ----------------------------------------------------------

_duration_cache: dict[str, dict] = {}
_duration_lock = threading.Lock()


def load_duration_cache() -> None:
    global _duration_cache
    try:
        _duration_cache = json.loads(DURATION_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — a missing or corrupt cache just rebuilds
        _duration_cache = {}


def save_duration_cache() -> None:
    try:
        with _duration_lock:
            payload = json.dumps(_duration_cache)
        DURATION_CACHE_PATH.write_text(payload, encoding="utf-8")
    except OSError as exc:
        print(f"[vesper] WARNING: could not write duration cache: {exc}", flush=True)


def cached_duration(key: str, audio: Path) -> float | None:
    """Cached probe, invalidated on mtime/size so a replaced file re-probes."""
    try:
        stat = audio.stat()
    except OSError:
        return None
    with _duration_lock:
        hit = _duration_cache.get(key)
        if hit and hit.get("mtime") == stat.st_mtime and hit.get("size") == stat.st_size:
            return hit.get("duration")
    return None


_FFMPEG_TIME_RE = re.compile(r"time=(\d+):(\d+):(\d+\.\d+)")


def probe_duration(audio: Path) -> float | None:
    """Audio duration, cheaply if possible.

    `MediaRecorder` webm files — everything the PWA records — carry no duration
    in their container header, so the fast metadata read returns nothing for
    them and we fall back to decoding the file and reading the final timestamp.
    That costs ~1.5s for a four-minute recording, which is why this only ever
    runs in the background backfill; anything Vesper transcribes itself gets
    its duration straight from Whisper instead.
    """
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format",
             str(audio)],
            capture_output=True, text=True, timeout=30, check=True,
        )
        return float(json.loads(out.stdout)["format"]["duration"])
    except Exception:  # noqa: BLE001 — fall through to the decode
        pass

    try:
        out = subprocess.run(
            ["ffmpeg", "-i", str(audio), "-f", "null", "-"],
            capture_output=True, text=True, timeout=300,
        )
        stamps = _FFMPEG_TIME_RE.findall(out.stderr)
        if not stamps:
            return None
        hours, minutes, seconds = stamps[-1]
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    except Exception:  # noqa: BLE001 — a duration is nice to have, not required
        return None


def remember_duration(key: str, audio: Path, duration: float | None) -> None:
    try:
        stat = audio.stat()
    except OSError:
        return
    with _duration_lock:
        _duration_cache[key] = {
            "mtime": stat.st_mtime, "size": stat.st_size, "duration": duration,
        }


# --- Scanning ----------------------------------------------------------------

def read_entry(date: str, stem: str, txt: Path | None, audio: Path | None) -> Entry:
    text = None
    if txt is not None:
        try:
            text = txt.read_text(encoding="utf-8", errors="replace").strip()
        except OSError as exc:
            print(f"[vesper] WARNING: unreadable {date}/{stem}.txt: {exc}", flush=True)
    key = f"{date}/{stem}"
    return Entry(
        id=entry_id(date, stem),
        date=date,
        stem=stem,
        created_at=parse_created_at(date, stem),
        transcript=text,
        word_count=len(text.split()) if text else (None if text is None else 0),
        duration_seconds=cached_duration(key, audio) if audio else None,
        audio_name=audio.name if audio else None,
    )


def scan_vault() -> dict[str, Entry]:
    """Rebuild the whole index from the vault. ~1s for a few hundred entries;
    only ever run at startup, so it's off the request path."""
    found: dict[str, Entry] = {}
    if not VAULT_RECORDINGS_DIR.is_dir():
        print(f"[vesper] WARNING: vault missing at {VAULT_RECORDINGS_DIR}", flush=True)
        return found

    for day_dir in VAULT_RECORDINGS_DIR.iterdir():
        if not day_dir.is_dir() or not DATE_RE.match(day_dir.name):
            continue
        # Group a day's files by stem. The `<date>.md` memoir notes and any
        # other stray files are simply not audio or transcripts, so they never
        # produce an entry.
        txts: dict[str, Path] = {}
        audios: dict[str, Path] = {}
        try:
            contents = list(day_dir.iterdir())
        except OSError as exc:
            print(f"[vesper] WARNING: unreadable folder {day_dir.name}: {exc}", flush=True)
            continue
        for path in contents:
            suffix = path.suffix.lower()
            if suffix == ".txt":
                txts[path.stem] = path
            elif suffix in AUDIO_SUFFIXES:
                audios[path.stem] = path

        for stem in set(txts) | set(audios):
            entry = read_entry(day_dir.name, stem, txts.get(stem), audios.get(stem))
            found[entry.id] = entry
    return found


def rebuild_index() -> int:
    started = time.monotonic()
    found = scan_vault()
    with index.lock:
        index.entries = found
    elapsed = (time.monotonic() - started) * 1000
    print(f"[vesper] Indexed {len(found)} entries from the vault in {elapsed:.0f}ms",
          flush=True)
    return len(found)


def backfill_durations() -> None:
    """Probe any audio whose duration isn't cached, updating entries in place.

    Runs after the index is already serving: durations are cosmetic, and
    ffprobe over a few hundred files is far too slow to sit in front of the
    first request.
    """
    pending = [e for e in index.sorted() if e.audio_name and e.duration_seconds is None]
    if not pending:
        return
    print(f"[vesper] Probing durations for {len(pending)} recording(s)...", flush=True)
    for entry in pending:
        audio = VAULT_RECORDINGS_DIR / entry.date / entry.audio_name
        duration = probe_duration(audio)
        remember_duration(f"{entry.date}/{entry.stem}", audio, duration)
        with index.lock:
            live = index.entries.get(entry.id)
            if live is not None:
                live.duration_seconds = duration
    save_duration_cache()
    print("[vesper] Duration probing complete.", flush=True)


# --- Whisper model -----------------------------------------------------------

whisper_model = None


def load_model() -> None:
    """Load the faster-whisper model. Tolerant of GPU-less environments so the
    server (and its static file serving + read endpoints) still come up; the
    transcribe endpoint reports 503 until a model is available."""
    global whisper_model
    try:
        from faster_whisper import WhisperModel

        print(
            f"[vesper] Loading Whisper model '{WHISPER_MODEL}' "
            f"on {WHISPER_DEVICE} ({WHISPER_COMPUTE_TYPE})...",
            flush=True,
        )
        whisper_model = WhisperModel(
            WHISPER_MODEL,
            device=WHISPER_DEVICE,
            compute_type=WHISPER_COMPUTE_TYPE,
        )
        print("[vesper] Whisper model loaded.", flush=True)
    except Exception as exc:  # noqa: BLE001 — surface any load failure, keep serving
        whisper_model = None
        print(
            f"[vesper] WARNING: Whisper model failed to load: {exc}\n"
            f"[vesper] The app will serve, but /api/transcribe will return 503 "
            f"until a model loads. For CPU fallback set WHISPER_DEVICE=cpu and "
            f"WHISPER_COMPUTE_TYPE=int8 in backend/.env.",
            flush=True,
        )


def transcribe_file(path: str) -> tuple[str, float]:
    """Run faster-whisper synchronously (blocking, GPU-bound). Call via
    run_in_threadpool. Returns (text, duration_seconds)."""
    segments, info = whisper_model.transcribe(
        path,
        vad_filter=True,
        language="en",
        beam_size=5,
        initial_prompt=WHISPER_INITIAL_PROMPT,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    for pattern, replacement in WHISPER_SUBSTITUTIONS:
        text = pattern.sub(replacement, text)
    duration = float(getattr(info, "duration", 0.0) or 0.0)
    return text, duration


# --- Writing into the vault --------------------------------------------------

# Slot allocation reads the folder then writes into it; two uploads landing
# together would otherwise both pick the same NN.
_slot_lock = threading.Lock()


def next_stem(day_dir: Path, when: datetime) -> str:
    """`NN - H.MMpm`, continuing the day folder's existing numbering. No title:
    Vesper has no titling step, and inventing one would need an AI pass that
    can't run at upload time."""
    highest = 0
    if day_dir.is_dir():
        for existing in day_dir.iterdir():
            match = INDEX_RE.match(existing.name)
            if match:
                highest = max(highest, int(match.group(1)))
    local = when.astimezone(VAULT_TZ)
    clock = f"{local.hour % 12 or 12}.{local.minute:02d}{'am' if local.hour < 12 else 'pm'}"
    return f"{highest + 1:02d} - {clock}"


async def _run_transcription(entry_key: str) -> None:
    """Background task: transcribe the audio of an already-indexed entry and
    write the transcript beside it in the vault."""
    with index.lock:
        entry = index.entries.get(entry_key)
        if entry is None:
            return  # deleted before we got to it
        date, stem, audio_name = entry.date, entry.stem, entry.audio_name

    if not audio_name:
        return
    audio = VAULT_RECORDINGS_DIR / date / audio_name

    try:
        text, duration = await run_in_threadpool(transcribe_file, str(audio))
    except Exception as exc:  # noqa: BLE001
        print(f"[vesper] Transcription failed for {date}/{stem}: {exc}", flush=True)
        # Leave the entry pending rather than writing an empty .txt: the audio
        # is safe in the vault, and a restart re-queues it.
        return

    try:
        (VAULT_RECORDINGS_DIR / date / f"{stem}.txt").write_text(text, encoding="utf-8")
    except OSError as exc:
        print(f"[vesper] WARNING: could not write {date}/{stem}.txt: {exc}", flush=True)
        return

    remember_duration(f"{date}/{stem}", audio, duration)
    save_duration_cache()
    with index.lock:
        live = index.entries.get(entry_key)
        if live is not None:
            live.transcript = text
            live.word_count = len(text.split())
            live.duration_seconds = duration
    print(f"[vesper] Transcribed {date}/{stem}: {len(text.split())} words", flush=True)


# --- App / lifecycle ---------------------------------------------------------

app = FastAPI(title="Vesper")


@app.on_event("startup")
async def on_startup() -> None:
    load_duration_cache()
    rebuild_index()
    load_model()

    # Audio with no transcript beside it means a run that never finished —
    # the vault itself is the queue, so nothing extra needs tracking.
    pending = [e.id for e in index.sorted() if e.audio_name and e.transcript is None]
    if pending:
        print(f"[vesper] Re-queuing {len(pending)} unfinished transcription(s)...",
              flush=True)
        for key in pending:
            asyncio.create_task(_run_transcription(key))

    asyncio.create_task(run_in_threadpool(backfill_durations))


@app.middleware("http")
async def global_api_rate_limit(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        if not api_limiter.allow(get_client_ip(request)):
            return JSONResponse(
                {"detail": "Too many requests — slow down a moment."},
                status_code=429,
            )
    return await call_next(request)


def transcribe_rate_limit(request: Request) -> None:
    if not transcribe_limiter.allow(get_client_ip(request)):
        raise HTTPException(
            status_code=429,
            detail="Transcription rate limit reached — try again shortly.",
        )


# --- Endpoints ---------------------------------------------------------------

@app.get("/health")
def health():
    with index.lock:
        count = len(index.entries)
    return {
        "status": "ok",
        "model_loaded": whisper_model is not None,
        "entries": count,
        "vault": VAULT_RECORDINGS_DIR.is_dir(),
    }


@app.post("/api/reindex")
def reindex():
    """Re-read the vault. The index only refreshes at startup, so this is the
    way to pick up transcripts edited directly in Obsidian without a restart."""
    return {"entries": rebuild_index()}


@app.post(
    "/api/transcribe",
    dependencies=[Depends(transcribe_rate_limit)],
)
async def transcribe(
    audio: UploadFile,
    background_tasks: BackgroundTasks,
    local_date: str | None = Form(default=None),
):
    if whisper_model is None:
        raise HTTPException(
            status_code=503,
            detail="Transcription model not loaded. Check server logs / GPU.",
        )
    if not VAULT_RECORDINGS_DIR.is_dir():
        raise HTTPException(
            status_code=503,
            detail="Vault unavailable — recordings have nowhere to go.",
        )

    suffix = Path(audio.filename or "audio").suffix or ".bin"
    now = datetime.now(timezone.utc)
    date = local_date or now.astimezone(VAULT_TZ).strftime("%Y-%m-%d")

    # Stage outside the vault so a rejected upload never leaves a partial file
    # where the memoir pipeline (or the next scan) would see it.
    fd, tmp_name = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        total = 0
        async with aiofiles.open(tmp_path, "wb") as out:
            while chunk := await audio.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Recording exceeds the {MAX_UPLOAD_MB:g} MB limit.",
                    )
                await out.write(chunk)

        day_dir = VAULT_RECORDINGS_DIR / date
        with _slot_lock:
            day_dir.mkdir(parents=True, exist_ok=True)
            stem = next_stem(day_dir, now)
            shutil.move(str(tmp_path), day_dir / f"{stem}{suffix}")
    except HTTPException:
        tmp_path.unlink(missing_ok=True)
        raise
    except OSError as exc:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Could not save recording: {exc}")

    entry = Entry(
        id=entry_id(date, stem),
        date=date,
        stem=stem,
        created_at=parse_created_at(date, stem),
        audio_name=f"{stem}{suffix}",
    )
    with index.lock:
        index.entries[entry.id] = entry

    background_tasks.add_task(_run_transcription, entry.id)
    return entry.public()


@app.get("/api/transcripts")
def list_transcripts(date: str | None = None):
    entries = index.sorted()
    if date:
        entries = [e for e in entries if e.date == date]
    return [e.public() for e in entries]


@app.get("/api/calendar")
def calendar():
    counts: dict[str, int] = {}
    for entry in index.sorted():
        counts[entry.date] = counts.get(entry.date, 0) + 1
    return [
        {"date": date, "count": count}
        for date, count in sorted(counts.items(), reverse=True)
    ]


@app.patch("/api/transcripts/{key}")
def update_transcript(key: str, payload: TranscriptEdit):
    """Replace an entry's transcript — hand corrections to what Whisper heard.
    Writes straight to the vault file, which is the entry."""
    with index.lock:
        entry = index.entries.get(key)
        if entry is None:
            raise HTTPException(status_code=404, detail="Not found")
        date, stem = entry.date, entry.stem

    text = payload.transcript.strip()
    try:
        (VAULT_RECORDINGS_DIR / date / f"{stem}.txt").write_text(text, encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not save to vault: {exc}")

    with index.lock:
        live = index.entries.get(key)
        if live is not None:
            live.transcript = text
            live.word_count = len(text.split()) if text else 0
    return {"id": key, "transcript": text, "word_count": len(text.split()) if text else 0}


@app.delete("/api/transcripts/{key}")
def delete_transcript(key: str):
    """Delete the entry's files from the vault.

    The vault is the only copy now, so this really does destroy the recording
    and its transcript — there is no second store to fall back on. The client
    confirms before calling.
    """
    with index.lock:
        entry = index.entries.get(key)
        if entry is None:
            raise HTTPException(status_code=404, detail="Not found")
        date, stem = entry.date, entry.stem

    day_dir = VAULT_RECORDINGS_DIR / date
    removed = []
    if day_dir.is_dir():
        for path in day_dir.iterdir():
            if path.stem == stem and (
                path.suffix.lower() == ".txt" or path.suffix.lower() in AUDIO_SUFFIXES
            ):
                try:
                    path.unlink()
                    removed.append(path.name)
                except OSError as exc:
                    raise HTTPException(
                        status_code=500, detail=f"Could not delete {path.name}: {exc}"
                    )

    with index.lock:
        index.entries.pop(key, None)
    print(f"[vesper] Deleted {date}/{stem} ({len(removed)} file(s))", flush=True)
    return JSONResponse({"deleted": key, "files": removed})


# --- Static files (MUST be mounted after all API routes) ---------------------

# StaticFiles sends ETag/Last-Modified but no Cache-Control, so browsers fall
# back to heuristic caching. That's wrong for the shell: index.html names Vite's
# content-hashed bundles, so a stale copy pins the device to an old build and no
# deploy can reach it. Hashed assets are the opposite case — the filename
# changes every build, so they're safe to cache hard.
SHELL_PATHS = frozenset({"/", "/index.html", "/sw.js", "/manifest.json"})


@app.middleware("http")
async def static_cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path in SHELL_PATHS:
        # "no-cache" = may store, but must revalidate — a cheap 304 via ETag.
        response.headers["Cache-Control"] = "no-cache"
    elif path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="app")
else:
    print(
        f"[vesper] NOTE: {FRONTEND_DIST} not found — build the frontend "
        f"(cd frontend && npm run build) to serve the PWA.",
        flush=True,
    )
