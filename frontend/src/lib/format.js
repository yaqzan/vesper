// Date / number formatting shared across components.
//
// All "date string" values are 'YYYY-MM-DD' in the user's LOCAL calendar.
// We deliberately compute the local date from local clock components rather
// than slicing toISOString() (which is UTC) — a recording made at 11:50pm
// must land on today, not tomorrow, for users east of UTC. created_at values
// are full ISO datetimes (UTC) and are rendered in the viewer's local time.

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Today's date in the local calendar as 'YYYY-MM-DD'. */
export function todayLocalDate() {
  const d = new Date()
  return toDateString(d)
}

// --- Journal day ("the day doesn't end at midnight") ------------------------
//
// The user records a day's reflection in the small hours of the next morning
// (roughly 1am–7am). Those recordings belong to the day that just ended, not
// the calendar day on the clock. So any moment before JOURNAL_DAY_START_HOUR
// rolls back one calendar day. Everything that assigns a recording to a date —
// and the calendar's notion of "today" — runs through journalDate().

export const JOURNAL_DAY_START_HOUR = 7

/** The journal date for a given moment as 'YYYY-MM-DD' (rolls back before 7am). */
export function journalDate(d = new Date()) {
  const shifted = new Date(d)
  if (d.getHours() < JOURNAL_DAY_START_HOUR) {
    shifted.setDate(shifted.getDate() - 1)
  }
  return toDateString(shifted)
}

/** The journal date for right now. Use this when assigning a new recording. */
export function journalToday() {
  return journalDate(new Date())
}

/** True when the offset is active — we're in the early-morning roll-back window. */
export function isEarlyMorning(d = new Date()) {
  return d.getHours() < JOURNAL_DAY_START_HOUR
}

// --- The daily goal ---------------------------------------------------------
//
// Vesper's promise is "at least one recording every day." Missing days are
// flagged in the calendar from this date forward (days before it stay quiet —
// the goal simply didn't exist yet).

export const GOAL_START_DATE = '2026-06-20'

/** A day is "missed" if it's on/after the goal start, strictly past, and empty. */
export function isMissedDay(dateStr, todayStr, hasEntry) {
  return !hasEntry && dateStr >= GOAL_START_DATE && dateStr < todayStr
}

/** Split a 'YYYY-MM-DD' into display parts for the editorial date block. */
export function dateParts(dateStr) {
  const d = parseDateString(dateStr)
  return {
    weekday: WEEKDAYS[d.getDay()],
    weekdayShort: WEEKDAYS[d.getDay()].slice(0, 3),
    month: MONTHS[d.getMonth()],
    monthShort: MONTHS[d.getMonth()].slice(0, 3),
    day: d.getDate(),
    year: d.getFullYear(),
  }
}

/** A Date -> 'YYYY-MM-DD' using local components. */
export function toDateString(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse 'YYYY-MM-DD' into a local-midnight Date (avoids UTC shift). */
export function parseDateString(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** "Thursday, June 19" */
export function formatLongDate(dateStr) {
  const d = parseDateString(dateStr)
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** "Thu Jun 19" */
export function formatShortDay(dateStr) {
  const d = parseDateString(dateStr)
  return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
}

/** "JUNE 2025" — month-group header. */
export function formatMonthHeader(dateStr) {
  const d = parseDateString(dateStr)
  return `${MONTHS[d.getMonth()].toUpperCase()} ${d.getFullYear()}`
}

/** "Thursday, June 19 · 2:30 PM" from a full ISO datetime (shown in local time). */
export function formatEntryHeader(isoDateTime) {
  const d = new Date(isoDateTime)
  const datePart = `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
  const timePart = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${datePart} · ${timePart}`
}

/** "2:30 PM" from a full ISO datetime. */
export function formatClockTime(isoDateTime) {
  return new Date(isoDateTime).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Elapsed seconds -> "MM:SS" for the recording timer (tabular). */
export function formatTimer(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const mins = Math.floor(s / 60)
  const secs = s % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

/** Duration -> "4m 12s" or "42s". */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0))
  if (s < 60) return `${s}s`
  const mins = Math.floor(s / 60)
  const secs = s % 60
  return `${mins}m ${String(secs).padStart(2, '0')}s`
}

/** Bytes -> "1.2 MB" / "812 KB". */
export function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

/** "342 words · 4m 12s", or just "342 words" when there's no audio to time.
 *  A few vault entries are transcript-only, and "· 0s" reads as a bug. */
export function formatMeta(wordCount, durationSeconds) {
  const words = `${wordCount ?? 0} word${wordCount === 1 ? '' : 's'}`
  if (!durationSeconds) return words
  return `${words} · ${formatDuration(durationSeconds)}`
}
