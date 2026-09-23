import { useEffect, useMemo, useRef, useState } from 'react'

import {
  toDateString,
  parseDateString,
  formatShortDay,
  formatMonthHeader,
  journalToday,
  isMissedDay,
  GOAL_START_DATE,
} from '../lib/format.js'
import { ChevronIcon, FlameIcon, WarningIcon } from './icons.jsx'

import styles from './CalendarView.module.css'

const DAYS_BACK = 90

function addDays(date, delta) {
  const d = new Date(date)
  d.setDate(d.getDate() + delta)
  return d
}

// Build the trailing window of days (today first), bucketed by month.
function buildMonthGroups(today) {
  const groups = []
  let current = null
  for (let i = 0; i < DAYS_BACK; i += 1) {
    const d = addDays(today, -i)
    const dateStr = toDateString(d)
    const monthKey = `${d.getFullYear()}-${d.getMonth()}`
    if (!current || current.key !== monthKey) {
      current = { key: monthKey, label: formatMonthHeader(dateStr), days: [] }
      groups.push(current)
    }
    current.days.push(dateStr)
  }
  return groups
}

function computeStats(counts, today) {
  const todayStr = toDateString(today)

  // Streak: consecutive recorded days, allowed to end today OR yesterday (so a
  // not-yet-recorded today doesn't read as a broken streak before bedtime).
  let cursor = counts.has(todayStr) ? today : addDays(today, -1)
  let streak = 0
  while (counts.has(toDateString(cursor))) {
    streak += 1
    cursor = addDays(cursor, -1)
  }

  // Days since the most recent entry (for the "last recorded" fallback line).
  let lastRecordedDaysAgo = null
  for (let i = 0; i < 400; i += 1) {
    if (counts.has(toDateString(addDays(today, -i)))) {
      lastRecordedDaysAgo = i
      break
    }
  }

  // Missed days since the goal began (on/after GOAL_START_DATE, strictly past).
  let missedSinceGoal = 0
  for (let i = 1; i < DAYS_BACK; i += 1) {
    const dateStr = toDateString(addDays(today, -i))
    if (dateStr < GOAL_START_DATE) break
    if (!counts.has(dateStr)) missedSinceGoal += 1
  }

  // This month: recorded days vs. days elapsed so far this month.
  const elapsedThisMonth = today.getDate()
  let recordedThisMonth = 0
  for (let day = 1; day <= elapsedThisMonth; day += 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), day)
    if (counts.has(toDateString(d))) recordedThisMonth += 1
  }

  return {
    streak,
    lastRecordedDaysAgo,
    missedSinceGoal,
    elapsedThisMonth,
    recordedThisMonth,
  }
}

export default function CalendarView({ calendarData, onSelectDate }) {
  // "Today" is the journal day (rolls back before 7am), so the calendar's
  // notion of today lines up with what you'd be recording right now.
  const today = useMemo(() => parseDateString(journalToday()), [])
  const todayStr = toDateString(today)
  const todayRowRef = useRef(null)
  const [nudged, setNudged] = useState(null)

  const counts = useMemo(() => {
    const map = new Map()
    for (const { date, count } of calendarData || []) {
      if (count > 0) map.set(date, count)
    }
    return map
  }, [calendarData])

  const groups = useMemo(() => buildMonthGroups(today), [today])
  const stats = useMemo(() => computeStats(counts, today), [counts, today])

  // Open scrolled to today.
  useEffect(() => {
    if (todayRowRef.current) {
      todayRowRef.current.scrollIntoView({ behavior: 'instant', block: 'center' })
    }
  }, [])

  const handleEmptyTap = (dateStr) => {
    setNudged(dateStr)
    setTimeout(() => setNudged((d) => (d === dateStr ? null : d)), 360)
  }

  const monthProgress = stats.elapsedThisMonth
    ? Math.min(1, stats.recordedThisMonth / stats.elapsedThisMonth)
    : 0

  return (
    <div className={`${styles.wrap} vsp-scroll`}>
      <header className={styles.header}>
        <div className={styles.hero}>
          <div className={styles.streakBlock}>
            <div className={styles.streakNumberRow}>
              {stats.streak > 0 && <FlameIcon size={26} className={styles.flame} />}
              <span className={styles.streakNumber}>{stats.streak}</span>
            </div>
            <div className={styles.streakLabel}>
              {stats.streak === 1 ? 'day streak' : 'day streak'}
            </div>
          </div>

          <div className={styles.heroDivider} />

          <div className={styles.heroStats}>
            <div className={styles.heroStat}>
              <span className={styles.heroStatNum}>
                {stats.recordedThisMonth}
                <span className={styles.heroStatDenom}>
                  /{stats.elapsedThisMonth}
                </span>
              </span>
              <span className={styles.heroStatLabel}>this month</span>
            </div>
            <div className={styles.heroStat}>
              <span
                className={`${styles.heroStatNum} ${
                  stats.missedSinceGoal > 0 ? styles.heroStatMissed : ''
                }`}
              >
                {stats.missedSinceGoal}
              </span>
              <span className={styles.heroStatLabel}>missed</span>
            </div>
          </div>
        </div>

        <div className={styles.progressTrack}>
          <div
            className={styles.progressFill}
            style={{ width: `${monthProgress * 100}%` }}
          />
        </div>
      </header>

      <div className={styles.timeline}>
        {groups.map((group) => (
          <section key={group.key} className={styles.monthGroup}>
            <div className={styles.monthHeader}>
              <span className={styles.monthLabel}>{group.label}</span>
              <span className={styles.monthRule} />
            </div>

            {group.days.map((dateStr) => {
              const count = counts.get(dateStr) || 0
              const has = count > 0
              const isToday = dateStr === todayStr
              const missed = isMissedDay(dateStr, todayStr, has)

              const nodeClass = has
                ? styles.nodeFilled
                : missed
                  ? styles.nodeMissed
                  : isToday
                    ? styles.nodeToday
                    : styles.nodeEmpty

              return (
                <button
                  key={dateStr}
                  ref={isToday ? todayRowRef : null}
                  type="button"
                  className={[
                    styles.row,
                    has ? styles.rowHas : styles.rowQuiet,
                    missed ? styles.rowMissed : '',
                    isToday ? styles.rowToday : '',
                    nudged === dateStr ? styles.rowNudge : '',
                  ].join(' ')}
                  onClick={() =>
                    has ? onSelectDate(dateStr) : handleEmptyTap(dateStr)
                  }
                  aria-disabled={!has}
                >
                  <span className={styles.rail}>
                    <span className={`${styles.node} ${nodeClass}`}>
                      {has && count > 1 && (
                        <span className={styles.countBadge}>{count}</span>
                      )}
                    </span>
                  </span>

                  <span className={styles.dayLabel}>
                    {formatShortDay(dateStr)}
                    {isToday && <span className={styles.todayTag}>Today</span>}
                  </span>

                  <span className={styles.rowRight}>
                    {has ? (
                      <>
                        <span className={styles.count}>
                          {count} {count === 1 ? 'entry' : 'entries'}
                        </span>
                        <ChevronIcon size={18} className={styles.chevron} />
                      </>
                    ) : missed ? (
                      <span className={styles.missedTag}>
                        <WarningIcon size={13} />
                        missed
                      </span>
                    ) : isToday ? (
                      <span className={styles.todayHint}>record tonight</span>
                    ) : (
                      <span className={styles.noEntry}>—</span>
                    )}
                  </span>
                </button>
              )
            })}
          </section>
        ))}
      </div>

      <div className={styles.footSpace} />
    </div>
  )
}
