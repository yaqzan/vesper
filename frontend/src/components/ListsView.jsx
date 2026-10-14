import { useState } from 'react'

import { CheckIcon } from './icons.jsx'
import { decideAddition, clearAddition } from '../lib/api.js'
import { formatLongDate } from '../lib/format.js'

import shared from './QuestionsView.module.css'
import styles from './ListsView.module.css'

// New Reading List titles and Food places the memoir pipeline heard in a parsed
// day. Nothing reaches the vault until you add it; the pipeline writes the note
// on its next run (create-only, Score/Hours/rating stay blank for you).

const APPLIED_LABEL = {
  created: 'Added',
  updated: 'Updated',
  exists: 'Already in the vault',
  skipped: 'Skipped',
  linked: 'Already there',
}

function decisionLabel(item) {
  if (item.applied) return APPLIED_LABEL[item.applied] || item.applied
  const d = item.decision
  if (d.via === 'skip') return 'Skipped'
  if (d.via === 'link') return `Already there${item.match ? `: ${item.match}` : ''}`
  const rated = d.rating ? ` · rated ${d.rating}` : ''
  if (item.kind === 'update') return `Will mark “${item.name}” ${item.status}${rated}`
  const where = item.kind === 'restaurant' ? 'Food' : `Reading List (${d.type || item.type})`
  return `Will add “${d.name || item.name}” to ${where}${rated}`
}

function ItemCard({ date, item, types, onDayChange }) {
  const [name, setName] = useState(item.name)
  const [type, setType] = useState(item.type || 'Other')
  const [rating, setRating] = useState(item.rating_hint ? String(item.rating_hint) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const isUpdate = item.kind === 'update'
  const isMedia = item.kind === 'media'
  // Titles take whole stars; restaurants take halves.
  const ratingOptions = item.kind === 'restaurant'
    ? ['1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5']
    : ['1', '2', '3', '4', '5']

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      onDayChange(await fn())
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const decide = (via) => run(() => decideAddition(date, item.id, {
    via,
    name: via === 'add' && name.trim() !== item.name ? name.trim() : undefined,
    type: via === 'add' && isMedia && type !== item.type ? type : undefined,
    rating: via === 'add' && rating ? Number(rating) : undefined,
  }))

  return (
    <article className={`${shared.card} ${item.decision ? shared.answered : ''}`}>
      <p className={styles.kind}>
        {item.kind === 'restaurant' ? 'restaurant' : (item.media_kind || 'title')}
        {isUpdate
          ? ` · ${item.current_status} → ${item.status}`
          : isMedia && item.status && ` · ${item.status}`}
      </p>
      <p className={shared.question}>{item.name}</p>
      {item.note && <p className={shared.why}>{item.note}</p>}

      {item.decision || item.applied ? (
        <div className={shared.answerRow}>
          <CheckIcon size={16} className={shared.tick} />
          <span className={shared.answerText}>{decisionLabel(item)}</span>
          {!item.applied && (
            <button
              type="button"
              className={shared.link}
              disabled={busy}
              onClick={() => run(() => clearAddition(date, item.id))}
            >
              Change
            </button>
          )}
        </div>
      ) : (
        <>
          {item.match && (
            <button
              type="button"
              className={shared.guess}
              disabled={busy}
              onClick={() => decide('link')}
            >
              Same as “{item.match}” (already there)
            </button>
          )}
          {renaming && (
            <input
              className={`${shared.input} ${styles.rename}`}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              aria-label="Name"
            />
          )}
          <div className={styles.fields}>
            <label className={styles.field}>
              <span className={styles.label}>Rating</span>
              <select
                className={styles.select}
                value={rating}
                disabled={busy}
                onChange={(e) => setRating(e.target.value)}
              >
                <option value="">None</option>
                {ratingOptions.map((r) => <option key={r} value={r}>{`${r} / 5`}</option>)}
              </select>
            </label>
            {isMedia && (
              <label className={styles.field}>
                <span className={styles.label}>Type</span>
                <select
                  className={styles.select}
                  value={type}
                  disabled={busy}
                  onChange={(e) => setType(e.target.value)}
                >
                  {[...new Set([type, ...types])].map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={shared.guess}
              disabled={busy || (!isUpdate && !name.trim())}
              onClick={() => decide('add')}
            >
              {isUpdate ? `Mark ${item.status.toLowerCase()}` : isMedia ? 'Add to Reading List' : 'Add to Food'}
            </button>
            <button
              type="button"
              className={shared.link}
              disabled={busy}
              onClick={() => decide('skip')}
            >
              Skip
            </button>
            {!isUpdate && !renaming && (
              <button
                type="button"
                className={shared.link}
                disabled={busy}
                onClick={() => setRenaming(true)}
              >
                Rename
              </button>
            )}
          </div>
        </>
      )}
      {error && <p className={shared.error}>{error}</p>}
    </article>
  )
}

export default function ListsView({ days, loaded, onDayChange }) {
  const open = days.reduce(
    (n, d) => n + d.items.filter((i) => !i.decision && !i.applied).length, 0)
  return (
    <div className={shared.wrap}>
      <header className={shared.header}>
        <h1 className={shared.title}>Lists</h1>
        <p className={shared.sub}>
          {!loaded
            ? 'Loading…'
            : open
              ? `${open} new titles and places heard in your days. Add what you want kept.`
              : 'Nothing to review. New titles and places show up here after a day is parsed.'}
        </p>
      </header>
      {days.map((day) => (
        <section key={day.date} className={shared.day}>
          <h2 className={shared.dayTitle}>{formatLongDate(day.date)}</h2>
          {day.items.map((item) => (
            <ItemCard
              key={item.id}
              date={day.date}
              item={item}
              types={day.types}
              onDayChange={onDayChange}
            />
          ))}
        </section>
      ))}
    </div>
  )
}
