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
  exists: 'Already in the vault',
  skipped: 'Skipped',
  linked: 'Already there',
}

function decisionLabel(item) {
  if (item.applied) return APPLIED_LABEL[item.applied] || item.applied
  const d = item.decision
  if (d.via === 'skip') return 'Skipped'
  if (d.via === 'link') return `Already there${item.match ? `: ${item.match}` : ''}`
  const where = item.kind === 'restaurant' ? 'Food' : `Reading List (${d.type || item.type})`
  return `Will add “${d.name || item.name}” to ${where}`
}

function ItemCard({ date, item, types, onDayChange }) {
  const [name, setName] = useState(item.name)
  const [type, setType] = useState(item.type || 'Other')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const isMedia = item.kind === 'media'

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
  }))

  return (
    <article className={`${shared.card} ${item.decision ? shared.answered : ''}`}>
      <p className={styles.kind}>
        {isMedia ? (item.media_kind || 'title') : 'restaurant'}
        {isMedia && item.status && ` · ${item.status}`}
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
          <div className={shared.inputRow}>
            <input
              className={shared.input}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              aria-label="Name"
            />
            {isMedia && (
              <select
                className={styles.select}
                value={type}
                disabled={busy}
                onChange={(e) => setType(e.target.value)}
                aria-label="Type"
              >
                {[...new Set([type, ...types])].map((t) => <option key={t}>{t}</option>)}
              </select>
            )}
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={shared.guess}
              disabled={busy || !name.trim()}
              onClick={() => decide('add')}
            >
              {isMedia ? 'Add to Reading List' : 'Add to Food'}
            </button>
            <button
              type="button"
              className={shared.link}
              disabled={busy}
              onClick={() => decide('skip')}
            >
              Skip
            </button>
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
