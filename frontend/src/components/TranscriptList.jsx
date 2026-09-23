import { useMemo, useState } from 'react'

import {
  formatClockTime,
  formatLongDate,
  formatMeta,
  journalToday,
  dateParts,
} from '../lib/format.js'
import { TrashIcon, MicIcon, ChevronIcon, PencilIcon } from './icons.jsx'

import styles from './TranscriptList.module.css'

const TRUNCATE_AT = 400

function TranscriptCard({ entry, onDelete, onEdit }) {
  const [expanded, setExpanded] = useState(false)
  // Editing is a per-card mode rather than a route: `draft` is non-null exactly
  // while the textarea is open, so it doubles as the mode flag.
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const isPending = entry.transcript === null
  const text = entry.transcript || ''
  const isLong = text.length > TRUNCATE_AT
  const editing = draft !== null

  const shown = !isLong || expanded ? text : `${text.slice(0, TRUNCATE_AT).trimEnd()}…`

  const startEdit = () => {
    setSaveError('')
    setDraft(text)
  }

  const cancelEdit = () => {
    setDraft(null)
    setSaveError('')
  }

  const handleSave = async () => {
    if (draft.trim() === text.trim()) {
      cancelEdit()
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      await onEdit(entry.id, draft)
      setDraft(null)
    } catch (err) {
      setSaveError(err.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  // Delete lives behind the edit affordance on purpose — it used to sit on the
  // card face, one stray tap from destroying an entry.
  const handleDelete = () => {
    if (window.confirm('Delete this entry? This cannot be undone.')) {
      onDelete(entry.id)
    }
  }

  return (
    <article className={`${styles.card} ${editing ? styles.cardEditing : ''}`}>
      <span className={styles.spine} aria-hidden="true" />
      <div className={styles.cardHead}>
        <span className={styles.cardTime}>{formatClockTime(entry.created_at)}</span>
        {!isPending && (
          <span className={styles.cardMeta}>
            {formatMeta(entry.word_count, entry.duration_seconds)}
          </span>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            className={styles.editor}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            spellCheck
            aria-label="Edit transcript"
          />
          {saveError && <p className={styles.editError}>{saveError}</p>}
          <div className={styles.editFoot}>
            <button
              type="button"
              className={styles.deleteText}
              onClick={handleDelete}
              disabled={saving}
            >
              <TrashIcon size={15} />
              Delete
            </button>
            <div className={styles.editActions}>
              <button
                type="button"
                className={styles.cancel}
                onClick={cancelEdit}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.save}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className={styles.body}>
            {isPending ? (
              <span className={styles.transcribing}>Transcribing…</span>
            ) : (
              <>
                {shown}
                {isLong && (
                  <button
                    type="button"
                    className={styles.showMore}
                    onClick={() => setExpanded((e) => !e)}
                  >
                    {expanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </>
            )}
          </p>

          {!isPending && (
            <div className={styles.cardFoot}>
              <button
                type="button"
                className={styles.edit}
                onClick={startEdit}
                aria-label="Edit entry"
              >
                <PencilIcon size={17} />
              </button>
            </div>
          )}
        </>
      )}
    </article>
  )
}

function Skeleton() {
  return (
    <div className={styles.skeletonWrap} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.skeletonCard}>
          <div className={styles.skelLine} style={{ width: '52%' }} />
          <div className={styles.skelLine} style={{ width: '34%', opacity: 0.6 }} />
          <div className={styles.skelBlock} />
        </div>
      ))}
    </div>
  )
}

function monthKeyOf(dateStr) {
  return dateStr.slice(0, 7)
}

export default function TranscriptList({
  transcripts,
  filterDate,
  loaded,
  onClearFilter,
  onDelete,
  onEdit,
}) {
  const visible = useMemo(() => {
    if (!filterDate) return transcripts
    return transcripts.filter((t) => t.date === filterDate)
  }, [transcripts, filterDate])

  // Bucket entries into months → days. transcripts arrive created_at DESC, so
  // months and the days within them are already newest-first.
  const months = useMemo(() => {
    if (filterDate) return null
    const map = new Map()
    for (const entry of visible) {
      const key = monthKeyOf(entry.date)
      let m = map.get(key)
      if (!m) {
        const p = dateParts(entry.date)
        m = { key, label: `${p.month} ${p.year}`, days: new Map() }
        map.set(key, m)
      }
      if (!m.days.has(entry.date)) m.days.set(entry.date, [])
      m.days.get(entry.date).push(entry)
    }
    return [...map.values()].map((m) => ({
      key: m.key,
      label: m.label,
      dayCount: m.days.size,
      entryCount: [...m.days.values()].reduce((n, a) => n + a.length, 0),
      days: [...m.days.entries()].map(([date, entries]) => ({ date, entries })),
    }))
  }, [visible, filterDate])

  // Current month open by default, everything older collapsed. `openKeys` is
  // null until the user toggles, at which point it becomes the explicit set.
  const currentMonthKey = monthKeyOf(journalToday())
  const [openKeys, setOpenKeys] = useState(null)
  const openSet = useMemo(() => {
    if (openKeys) return openKeys
    return new Set([currentMonthKey])
  }, [openKeys, currentMonthKey])

  const toggleMonth = (key) => {
    setOpenKeys((prev) => {
      const base = prev || new Set([currentMonthKey])
      const next = new Set(base)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const showSkeleton = !loaded && transcripts.length === 0

  return (
    <div className={`${styles.wrap} vsp-scroll`}>
      <header className={styles.header}>
        {filterDate ? (
          <>
            <button type="button" className={styles.back} onClick={onClearFilter}>
              ← All entries
            </button>
            <h2 className={styles.filterTitle}>{formatLongDate(filterDate)}</h2>
          </>
        ) : (
          <h2 className={styles.title}>Journal</h2>
        )}
      </header>

      {showSkeleton ? (
        <Skeleton />
      ) : visible.length === 0 ? (
        filterDate ? (
          <div className={styles.empty}>
            <MicIcon size={40} stroke={1.4} className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>Nothing recorded on this day.</p>
          </div>
        ) : (
          <div className={styles.empty}>
            <MicIcon size={40} stroke={1.4} className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>Your first entry is waiting.</p>
            <p className={styles.emptySub}>{formatLongDate(journalToday())}</p>
            <p className={styles.emptyHint}>Tap Record to begin.</p>
          </div>
        )
      ) : filterDate ? (
        <div className={styles.list}>
          {visible.map((entry) => (
            <TranscriptCard
              key={entry.id}
              entry={entry}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          ))}
        </div>
      ) : (
        months.map((month) => {
          const open = openSet.has(month.key)
          return (
            <section key={month.key} className={styles.month}>
              <button
                type="button"
                className={styles.monthHeader}
                onClick={() => toggleMonth(month.key)}
                aria-expanded={open}
              >
                <span className={styles.monthName}>{month.label}</span>
                <span className={styles.monthStats}>
                  <span className={styles.statDays}>
                    {month.dayCount} {month.dayCount === 1 ? 'day' : 'days'}
                  </span>
                  <span className={styles.statDot}>·</span>
                  <span className={styles.statEntries}>
                    {month.entryCount}{' '}
                    {month.entryCount === 1 ? 'entry' : 'entries'}
                  </span>
                  <ChevronIcon
                    size={18}
                    className={`${styles.monthChevron} ${open ? styles.monthChevronOpen : ''}`}
                  />
                </span>
              </button>

              {open && (
                <div className={styles.monthBody}>
                  {month.days.map((group) => (
                    <div key={group.date} className={styles.dayGroup}>
                      <div className={styles.dayHeader}>
                        {formatLongDate(group.date)}
                      </div>
                      <div className={styles.list}>
                        {group.entries.map((entry) => (
                          <TranscriptCard
                            key={entry.id}
                            entry={entry}
                            onDelete={onDelete}
                            onEdit={onEdit}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })
      )}

      <div className={styles.footSpace} />
    </div>
  )
}
