import { useRef, useState } from 'react'

import { MicIcon, StopIcon, CheckIcon } from './icons.jsx'
import { createRecorder, extForMime } from '../lib/recorder.js'
import { answerQuestion, answerByVoice, clearAnswer, fetchQuestionContext } from '../lib/api.js'
import { formatLongDate, formatEntryHeader, toDateString } from '../lib/format.js'

import styles from './QuestionsView.module.css'

// The memoir pipeline's open questions, one card each, grouped by day. A day's
// memoir is held back until every question on it is answered. Three ways to
// answer: confirm the parser's guess, type, or say it (recorded here, then
// transcribed by the same worker as journal entries). "Not sure" sends the
// question back to the pipeline to be looked at again with more context (a day
// is never written up with an unsure point); "Question is wrong" does the same
// with the typed note as evidence. Neither settles on its own.
// "Show context" loads the transcript around the quote and when it was recorded.

function answerLabel(q, answer) {
  if (answer.pending) return 'Transcribing your answer…'
  if (answer.via === 'guess') return `Yes: ${q.guess}`
  if (answer.via === 'unsure') return 'Not sure: it will be looked at again with more context'
  if (answer.via === 'wrong') {
    return answer.text
      ? `Marked wrong, looking again with your note: ${answer.text}`
      : 'Marked wrong, looking again with more context'
  }
  return answer.text
}

function QuoteContext({ date, qid }) {
  const [state, setState] = useState({ open: false, loading: false, data: null, error: null })

  const toggle = async () => {
    if (state.open) return setState((s) => ({ ...s, open: false }))
    setState((s) => ({ ...s, open: true, loading: !s.data, error: null }))
    if (state.data) return
    try {
      const data = await fetchQuestionContext(date, qid)
      setState({ open: true, loading: false, data, error: null })
    } catch (err) {
      setState({ open: true, loading: false, data: null, error: err.message })
    }
  }

  const { open, loading, data, error } = state
  const filedUnder = data?.recorded && toDateString(new Date(data.recorded)) !== date
  return (
    <div className={styles.context}>
      <button type="button" className={styles.link} onClick={toggle}>
        {open ? 'Hide context' : 'Show context'}
      </button>
      {open && loading && <p className={styles.contextMeta}>Loading…</p>}
      {open && error && <p className={styles.error}>{error}</p>}
      {open && data && (
        <>
          <p className={styles.contextMeta}>
            {data.recorded
              ? `Recorded ${formatEntryHeader(data.recorded)}`
              : 'Recording time unknown'}
            {filedUnder && ` · filed under ${formatLongDate(date)}`}
          </p>
          {!data.found && (
            <p className={styles.contextMeta}>
              Couldn’t find the quote in the transcript. This is where the recording starts.
            </p>
          )}
          <p className={styles.passage}>
            {data.before}
            {data.match && <mark className={styles.hit}>{data.match}</mark>}
            {data.after}
          </p>
        </>
      )}
    </div>
  )
}

export default function QuestionsView({ days, loaded, onDayChange }) {
  const [view, setView] = useState('todo')
  const count = (pred) => days.reduce((n, d) => n + d.questions.filter(pred).length, 0)
  const open = count((q) => !q.answer)
  const answered = count((q) => Boolean(q.answer))
  const again = count((q) => q.answer?.via === 'unsure' || q.answer?.via === 'wrong')
  const shown = days
    .map((d) => ({ ...d, questions: d.questions.filter((q) => Boolean(q.answer) === (view === 'done')) }))
    .filter((d) => d.questions.length)

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Questions</h1>
        <p className={styles.sub}>
          {!loaded
            ? 'Loading…'
            : open
              ? `${open} to answer. A day is written up once all of its questions are settled.`
              : again
                ? `Nothing to answer. ${again} being looked at again with more context.`
                : 'Nothing to answer. New questions show up here after a day is parsed.'}
        </p>
        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'todo'}
            className={`${styles.tabBtn} ${view === 'todo' ? styles.tabOn : ''}`}
            onClick={() => setView('todo')}
          >
            To answer ({open})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'done'}
            className={`${styles.tabBtn} ${view === 'done' ? styles.tabOn : ''}`}
            onClick={() => setView('done')}
          >
            Answered ({answered})
          </button>
        </div>
      </header>

      {loaded && shown.length === 0 && (
        <p className={styles.sub}>
          {view === 'todo' ? 'All caught up.' : 'Nothing answered yet.'}
        </p>
      )}
      {shown.map((day) => (
        <section key={day.date} className={styles.day}>
          <h2 className={styles.dayTitle}>{formatLongDate(day.date)}</h2>
          {day.questions.map((q) => (
            <QuestionCard key={q.id} date={day.date} q={q} onDayChange={onDayChange} />
          ))}
        </section>
      ))}
    </div>
  )
}

function QuestionCard({ date, q, onDayChange }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef(null)

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

  const startVoice = async () => {
    setError(null)
    try {
      // Created inside the tap: iOS only opens the mic from a user gesture.
      const rec = await createRecorder()
      recorderRef.current = rec
      setRecording(true)
      await rec.start((blob, mime) => {
        setRecording(false)
        recorderRef.current = null
        run(() => answerByVoice(date, q.id, blob, `${q.id}.${extForMime(mime)}`))
      })
    } catch (err) {
      setRecording(false)
      setError(err.message || 'Microphone unavailable')
    }
  }

  const stopVoice = () => recorderRef.current?.stop()

  const answer = q.answer
  return (
    <article className={`${styles.card} ${answer ? styles.answered : ''}`}>
      {q.round > 1 && <p className={styles.round}>Asked again (round {q.round})</p>}
      <p className={styles.question}>{q.question}</p>
      {q.why && <p className={styles.why}>{q.why}</p>}
      {q.quote && <blockquote className={styles.quote}>“{q.quote}”</blockquote>}
      <QuoteContext date={date} qid={q.id} />

      {answer ? (
        <div className={styles.answerRow}>
          <CheckIcon size={16} className={styles.tick} />
          <span className={styles.answerText}>{answerLabel(q, answer)}</span>
          <button
            type="button"
            className={styles.link}
            disabled={busy}
            onClick={() => run(() => clearAnswer(date, q.id))}
          >
            Change
          </button>
        </div>
      ) : (
        <>
          {q.guess && (
            <button
              type="button"
              className={styles.guess}
              disabled={busy || recording}
              onClick={() => run(() => answerQuestion(date, q.id, { acceptGuess: true }))}
            >
              Yes, {q.guess}
            </button>
          )}
          <form
            className={styles.inputRow}
            onSubmit={(e) => {
              e.preventDefault()
              if (text.trim()) run(() => answerQuestion(date, q.id, { text: text.trim() }))
            }}
          >
            <input
              className={styles.input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={recording ? 'Listening…' : 'Type an answer'}
              disabled={busy || recording}
              enterKeyHint="send"
            />
            <button
              type="button"
              className={`${styles.mic} ${recording ? styles.micLive : ''}`}
              aria-label={recording ? 'Stop and send' : 'Answer by voice'}
              disabled={busy}
              onClick={recording ? stopVoice : startVoice}
            >
              {recording ? <StopIcon size={18} /> : <MicIcon size={18} />}
            </button>
          </form>
          <div className={styles.escapes}>
            <button
              type="button"
              className={styles.link}
              disabled={busy || recording}
              onClick={() => run(() => answerQuestion(date, q.id, { unsure: true }))}
            >
              Not sure
            </button>
            <button
              type="button"
              className={styles.link}
              disabled={busy || recording}
              onClick={() => run(() => answerQuestion(date, q.id, {
                wrong: true, text: text.trim() || undefined }))}
            >
              Question is wrong
            </button>
          </div>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </article>
  )
}
