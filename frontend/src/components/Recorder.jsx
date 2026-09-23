import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { createRecorder } from '../lib/recorder.js'
import {
  formatTimer,
  journalToday,
  todayLocalDate,
  toDateString,
  parseDateString,
  dateParts,
} from '../lib/format.js'
import { MicIcon, StopIcon, CheckIcon, TrashIcon } from './icons.jsx'
import FileDropZone from './FileDropZone.jsx'
import AudioRing from './AudioRing.jsx'

import styles from './Recorder.module.css'

// Shown inside the orb, under its icon — kept short to fit the sphere. While
// recording the timer takes this slot instead.
const STATUS_TEXT = {
  idle: 'Tap to record',
  starting: 'Starting…',
  saved: 'Saved',
  error: 'Microphone unavailable',
}

const DAYS_BACK = 45
const CELL_W = 92 // px — must match .cell width in CSS
const SWIPE_THRESHOLD = 6 // px before a horizontal drag becomes a date swipe

function addDays(dateStr, delta) {
  const d = parseDateString(dateStr)
  d.setDate(d.getDate() + delta)
  return toDateString(d)
}

export default function Recorder({
  isDBReady,
  calendarData,
  transcripts,
  jobs,
  onRecordingDone,
  onRecordingChange,
  onUploadSuccess,
}) {
  const [status, setStatus] = useState('idle')
  const [elapsed, setElapsed] = useState(0)
  const [errorText, setErrorText] = useState('')
  // Live level/spectrum tap for the orb, non-null only while the mic is open.
  const [meter, setMeter] = useState(null)

  // The window of selectable days, ending at the real calendar day (you can't
  // record for the future). Default selection is the journal day — the night's
  // page — which is "yesterday" during the 1–7am window.
  //
  // The recorder stays mounted across tab switches (so a recording survives
  // them), so the window is keyed on today's date rather than built once —
  // otherwise an app left open overnight would never offer the new day.
  const todayKey = todayLocalDate()
  const days = useMemo(() => {
    const out = []
    for (let i = DAYS_BACK; i >= 0; i -= 1) out.push(addDays(todayKey, -i))
    return out
  }, [todayKey])
  const initialIndex = useMemo(
    () => Math.max(0, days.indexOf(journalToday())),
    [days]
  )
  const [selectedDate, setSelectedDate] = useState(() => days[initialIndex])

  const recorderRef = useRef(null)
  const orbRef = useRef(null)
  const startTimeRef = useRef(0)
  const tickRef = useRef(null)
  const resetTimeoutRef = useRef(null)
  const recordDateRef = useRef(selectedDate)
  const trackRef = useRef(null)
  const scrollTimerRef = useRef(null)
  const tailScrollRef = useRef(null)
  const swipeRef = useRef({ active: false })
  const didSwipeRef = useRef(false)

  const counts = useMemo(() => {
    const m = new Map()
    for (const { date, count } of calendarData || []) {
      if (count > 0) m.set(date, count)
    }
    return m
  }, [calendarData])

  // "Where you left off": the latest entry on the selected day, in full, and
  // nothing at all if that day is empty. It's there to resume the day you're
  // looking at — showing some other day's words would be actively misleading.
  // The window opens scrolled to the end (the last thing said) but scrolls back
  // through the whole entry, so you can re-read further than the final breath.
  //
  // Entries still on their way sit under that text as "ghost" lines
  // (Uploading 42% / Transcribing…), in the spot where their words will land.
  // They're the only place upload status is spelled out; the nav ring is
  // wordless. The text is the latest *finished* entry, so a pending one never
  // blanks the day.
  const selectedInfo = useMemo(() => {
    const onDay = (transcripts || []).filter((t) => t.date === selectedDate)
    // API returns created_at DESC → first with text is the latest finished.
    const written = onDay.find((t) => (t.transcript || '').trim())
    const serverIds = new Set(onDay.map((t) => t.id))
    const pending = onDay
      .filter((t) => t.transcript === null)
      .reverse() // oldest first, like the lines of a page
      .map((t) => ({ id: t.id, label: 'Transcribing…' }))
    const local = (jobs || [])
      .filter((j) => j.localDate === selectedDate)
      .filter(
        (j) =>
          j.stage === 'queued' ||
          j.stage === 'uploading' ||
          // uploaded, but the list refresh hasn't brought the entry in yet
          (j.stage === 'transcribing' && !serverIds.has(j.entryId))
      )
      .map((j) => ({
        id: j.id,
        label:
          j.stage === 'queued'
            ? 'Waiting to upload'
            : j.stage === 'uploading'
              ? `Uploading ${Math.round((j.progress || 0) * 100)}%`
              : 'Transcribing…',
      }))
    return {
      text: written ? written.transcript.trim() : null,
      count: onDay.length,
      ghosts: [...pending, ...local],
    }
  }, [transcripts, jobs, selectedDate])
  const ghostKey = selectedInfo.ghosts.map((g) => g.id).join()

  // Land on the end of the entry whenever the shown text changes (new day
  // swiped in, or a transcript arriving from the poll). Scrolling back is then
  // the user's move — we only set the starting position.
  //
  // Pinning once isn't enough: the serif face loads async and reflows the text
  // taller afterwards, which leaves a first paint stranded mid-entry. So we
  // re-pin on the next frame and again once fonts settle. Every pin targets
  // "bottom of whatever is there now", so a late one landing after a day-swipe
  // still does the right thing.
  useLayoutEffect(() => {
    const el = tailScrollRef.current
    if (!el) return
    const pin = () => {
      const node = tailScrollRef.current
      if (node) node.scrollTop = node.scrollHeight
    }
    pin()
    const frame = requestAnimationFrame(pin)
    document.fonts?.ready.then(pin)
    // The window has no height floor, so it shrinks when something (the
    // failed-upload banner) pushes the page down; re-pin then too, or the
    // newest words get cut off.
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(pin) : null
    ro?.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      ro?.disconnect()
    }
  }, [selectedInfo.text, ghostKey])

  const isRecording = status === 'recording'
  const isBusy = status === 'starting'
  const isDone = status === 'saved'
  const locked = isRecording || isBusy

  // --- Carousel ------------------------------------------------------------

  useLayoutEffect(() => {
    const el = trackRef.current
    if (el) el.scrollLeft = initialIndex * CELL_W
  }, [initialIndex])

  const indexFromScroll = useCallback(
    (left) => Math.min(days.length - 1, Math.max(0, Math.round(left / CELL_W))),
    [days]
  )

  const handleScroll = useCallback(() => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      const el = trackRef.current
      if (el) setSelectedDate(days[indexFromScroll(el.scrollLeft)])
    }, 70)
  }, [days, indexFromScroll])

  const scrollToIndex = useCallback((idx, smooth = true) => {
    const el = trackRef.current
    if (el) el.scrollTo({ left: idx * CELL_W, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // Swipe anywhere on the page to move dates. We watch the whole recorder area,
  // decide horizontal-vs-vertical once past a small threshold, and drive the
  // (otherwise non-scrollable) carousel directly. A real swipe suppresses the
  // record tap that would otherwise fire on release.
  const onAreaPointerDown = useCallback(
    (e) => {
      if (locked) return
      const el = trackRef.current
      if (!el) return
      swipeRef.current = {
        active: true,
        x: e.clientX,
        y: e.clientY,
        left: el.scrollLeft,
        decided: false,
        dragging: false,
      }
      didSwipeRef.current = false
    },
    [locked]
  )

  const onAreaPointerMove = useCallback(
    (e) => {
      const s = swipeRef.current
      if (!s.active) return
      const dx = e.clientX - s.x
      const dy = e.clientY - s.y
      if (!s.decided) {
        if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
          s.decided = true
          s.dragging = true
          const el = trackRef.current
          if (el) el.style.scrollSnapType = 'none'
        } else if (Math.abs(dy) > SWIPE_THRESHOLD + 4) {
          s.decided = true // vertical — leave it alone
        } else {
          return
        }
      }
      if (s.dragging) {
        const el = trackRef.current
        if (!el) return
        const left = Math.max(0, Math.min((days.length - 1) * CELL_W, s.left - dx))
        el.scrollLeft = left
        didSwipeRef.current = true
        setSelectedDate(days[indexFromScroll(left)])
      }
    },
    [days, indexFromScroll]
  )

  const onAreaPointerUp = useCallback(() => {
    const s = swipeRef.current
    if (!s.active) return
    s.active = false
    if (s.dragging) {
      const el = trackRef.current
      if (el) {
        el.style.scrollSnapType = ''
        scrollToIndex(indexFromScroll(el.scrollLeft))
      }
      // keep the swipe flag until just after the click would have fired
      setTimeout(() => {
        didSwipeRef.current = false
      }, 60)
    }
  }, [indexFromScroll, scrollToIndex])

  // --- Recording lifecycle -------------------------------------------------

  const stopTicking = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      stopTicking()
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current)
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
      if (recorderRef.current) recorderRef.current.stop()
    }
  }, [stopTicking])

  const scheduleReset = useCallback((delay) => {
    resetTimeoutRef.current = setTimeout(() => {
      setStatus('idle')
      setElapsed(0)
    }, delay)
  }, [])

  // Mirror the live recording up to the app so the upload tray can show it on
  // the other tabs.
  useEffect(() => {
    onRecordingChange?.(status === 'recording' ? startTimeRef.current : null)
  }, [status, onRecordingChange])

  // Hand the audio to the app's upload queue and free the orb at once. The
  // upload's progress lives in the tray, so the next entry can start while
  // this one is still going up.
  const handleRecordingDone = useCallback(
    (blob, mimeType) => {
      stopTicking()
      const durationSeconds = Math.max(
        0,
        (Date.now() - startTimeRef.current) / 1000
      )
      recorderRef.current = null
      setMeter(null) // the recorder closed it on stop
      onRecordingDone?.({
        blob,
        mimeType,
        localDate: recordDateRef.current,
        durationSeconds,
      })
      setStatus('saved')
      scheduleReset(2200)
    },
    [onRecordingDone, scheduleReset, stopTicking]
  )

  const startRecording = useCallback(async () => {
    if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current)
    setErrorText('')
    setStatus('starting')
    recordDateRef.current = selectedDate // lock the day at record time
    try {
      const recorder = await createRecorder()
      recorderRef.current = recorder
      startTimeRef.current = Date.now()
      setElapsed(0)
      recorder.start(handleRecordingDone)
      setMeter(recorder.meter)
      setStatus('recording')
      stopTicking()
      tickRef.current = setInterval(() => {
        setElapsed((Date.now() - startTimeRef.current) / 1000)
      }, 250)
    } catch (err) {
      console.error('[vesper] Could not start recording:', err)
      recorderRef.current = null
      setMeter(null)
      setErrorText(
        err && err.name === 'NotAllowedError'
          ? 'Microphone permission denied'
          : 'Microphone unavailable'
      )
      setStatus('error')
      scheduleReset(2600)
    }
  }, [handleRecordingDone, scheduleReset, stopTicking, selectedDate])

  const stopRecording = useCallback(() => {
    stopTicking()
    if (recorderRef.current) recorderRef.current.stop()
  }, [stopTicking])

  // Scrap the take: nothing is saved or uploaded. Confirmed first — it's the
  // one control that loses audio, and it sits right next to the stop button.
  const discardRecording = useCallback(() => {
    if (!recorderRef.current) return
    if (!window.confirm('Discard this recording? It won’t be saved.')) return
    stopTicking()
    recorderRef.current.discard()
    recorderRef.current = null
    setMeter(null)
    setElapsed(0)
    setStatus('idle')
  }, [stopTicking])

  const handleTap = useCallback(() => {
    if (didSwipeRef.current) return // a swipe just ended — don't record
    if (status === 'idle' || status === 'error' || status === 'saved') {
      startRecording()
    } else if (status === 'recording') stopRecording()
  }, [status, startRecording, stopRecording])

  const statusText =
    status === 'error' && errorText ? errorText : STATUS_TEXT[status]
  const selParts = dateParts(selectedDate)

  // The orb carries its own caption: the status line under the icon, or the
  // running timer while recording. Both used to be rows above the orb, and
  // got shoved into the entry text (or behind the orb) whenever the day's
  // entry or the upload tray ate the page's height.
  let icon
  if (isRecording) icon = <StopIcon size={30} className={styles.orbIcon} />
  else if (isDone) icon = <CheckIcon size={34} className={styles.orbIcon} />
  else icon = <MicIcon size={34} stroke={1.6} className={styles.orbIcon} />
  const orbIcon = (
    <span className={styles.orbStack}>
      {icon}
      {isRecording ? (
        <span className={styles.orbTimer}>{formatTimer(elapsed)}</span>
      ) : (
        <span key={status} className={styles.orbLabel}>
          {statusText}
        </span>
      )}
    </span>
  )

  let tailLabel = null
  if (selectedInfo.text) {
    tailLabel =
      selectedInfo.count > 1
        ? `${selectedInfo.count} entries · where you left off`
        : 'Where you left off'
  }

  return (
    <div
      className={styles.recorder}
      onPointerDown={onAreaPointerDown}
      onPointerMove={onAreaPointerMove}
      onPointerUp={onAreaPointerUp}
      onPointerCancel={onAreaPointerUp}
    >
      {/* Day carousel — swipe anywhere on the page to move it. */}
      <header className={styles.dateHeader}>
        <div
          ref={trackRef}
          className={styles.track}
          onScroll={handleScroll}
          role="listbox"
          aria-label="Choose the day to record for"
        >
          {days.map((date) => {
            const isSel = date === selectedDate
            const has = counts.has(date)
            const p = dateParts(date)
            return (
              <button
                key={date}
                type="button"
                className={`${styles.cell} ${isSel ? styles.cellSel : ''}`}
                style={{ width: CELL_W }}
                onClick={() => scrollToIndex(days.indexOf(date))}
                aria-selected={isSel}
                tabIndex={isSel ? 0 : -1}
              >
                <span className={styles.cellWeekday}>{p.weekdayShort}</span>
                <span className={styles.cellDay}>{p.day}</span>
                <span
                  className={`${styles.cellDot} ${has ? styles.cellDotOn : ''}`}
                />
              </button>
            )
          })}
        </div>

        <div className={styles.monthLine}>
          {selParts.month} {selParts.year}
        </div>
      </header>

      <div className={styles.stage} aria-label="Voice recorder">
        <div className={styles.tail} aria-live="polite">
          {selectedInfo.text || selectedInfo.ghosts.length > 0 ? (
            <>
              {tailLabel && (
                <span className={styles.tailLabel}>{tailLabel}</span>
              )}
              <div ref={tailScrollRef} className={styles.tailTextWrap}>
                {/* One child: the wrap bottom-anchors via margin-top:auto on
                    each child, so text and ghosts must travel together. */}
                <div>
                  {selectedInfo.text && (
                    <span className={styles.tailText}>{selectedInfo.text}</span>
                  )}
                  {selectedInfo.ghosts.map((g) => (
                    <span key={g.id} className={styles.ghost}>
                      <span className={styles.ghostDot} />
                      {g.label}
                    </span>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <span className={styles.tailEmpty}>No recordings yet</span>
          )}
        </div>

        <div className={styles.orbRow}>
          <button
            ref={orbRef}
            type="button"
            className={[
              styles.orb,
              isRecording ? styles.recording : '',
              // Only when a live meter is driving it — otherwise the canned
              // record pulse stays in charge.
              isRecording && meter ? styles.reactive : '',
              isBusy ? styles.busy : '',
              isDone ? styles.done : '',
            ].join(' ')}
            onClick={handleTap}
            disabled={isBusy || !isDBReady}
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
          >
            <span className={styles.aura} />
            <AudioRing
              meter={meter}
              active={isRecording}
              orbRef={orbRef}
              className={styles.ring}
            />
            {isRecording && (
              <span className={styles.ripples}>
                <span className={styles.ripple} style={{ animationDelay: '0s' }} />
                <span className={styles.ripple} style={{ animationDelay: '0.9s' }} />
                <span className={styles.ripple} style={{ animationDelay: '1.8s' }} />
              </span>
            )}
            {isBusy && <span className={styles.sweep} />}
            {status === 'saved' && <span className={styles.bloom} />}
            <span className={styles.sphere}>
              <span className={styles.gloss} />
              <span className={styles.shadow} />
            </span>
            {orbIcon}
          </button>

          {isRecording && (
            <button
              type="button"
              className={styles.discard}
              onClick={discardRecording}
              aria-label="Discard recording"
            >
              <TrashIcon size={22} />
            </button>
          )}
        </div>
      </div>

      <div className={styles.dropRow}>
        <FileDropZone
          localDate={selectedDate}
          onUploadSuccess={onUploadSuccess}
          disabled={isRecording || isBusy || !isDBReady}
        />
      </div>
    </div>
  )
}
