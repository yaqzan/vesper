import { useCallback, useEffect, useRef, useState } from 'react'

import Recorder from './components/Recorder.jsx'
import CalendarView from './components/CalendarView.jsx'
import TranscriptList from './components/TranscriptList.jsx'
import PendingUploads from './components/PendingUploads.jsx'
import NavProgressRing from './components/NavProgressRing.jsx'
import SettingsOverlay from './components/SettingsOverlay.jsx'
import { MicIcon, CalendarIcon, BookIcon, VesperGlyph, SettingsIcon } from './components/icons.jsx'

import {
  checkHealth,
  fetchTranscripts,
  fetchCalendar,
  deleteTranscript,
  updateTranscript,
} from './lib/api.js'
import { initDB, getAllPending, deletePending } from './lib/db.js'
import useUploadQueue from './lib/useUploadQueue.js'

import styles from './App.module.css'

const TABS = [
  { id: 'record', label: 'Record', Icon: MicIcon },
  { id: 'calendar', label: 'Calendar', Icon: CalendarIcon },
  { id: 'entries', label: 'Entries', Icon: BookIcon },
]

// connState: 'checking' | 'ok' | 'down'
export default function App() {
  const [connState, setConnState] = useState('checking')
  const [isDBReady, setIsDBReady] = useState(false)

  const [transcripts, setTranscripts] = useState([])
  const [calendarData, setCalendarData] = useState([])
  const [pendingUploads, setPendingUploads] = useState([])

  const [activeTab, setActiveTab] = useState('record')
  const [filterDate, setFilterDate] = useState(null)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  // Start time (ms) of the recording in progress, or null.
  const [recordingSince, setRecordingSince] = useState(null)

  // --- Data loaders --------------------------------------------------------

  const loadPending = useCallback(async () => {
    try {
      // In-flight ('queued') records belong to the upload tray; the banner is
      // only for uploads that failed and need a retry or a discard.
      const all = await getAllPending()
      setPendingUploads(all.filter((i) => i.status !== 'queued'))
    } catch (err) {
      console.warn('[vesper] Could not read pending uploads:', err)
    }
  }, [])

  const refreshData = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([fetchTranscripts(), fetchCalendar()])
      setTranscripts(t)
      setCalendarData(c)
    } catch (err) {
      console.warn('[vesper] Could not refresh data:', err)
    } finally {
      setDataLoaded(true)
    }
  }, [])

  // --- Upload queue --------------------------------------------------------

  const { jobs, enqueue, requeue, resume } = useUploadQueue({
    transcripts,
    onUploaded: refreshData,
    onFailed: loadPending,
  })

  const retryAll = useCallback(async () => {
    if (!navigator.onLine) return
    const failed = (await getAllPending()).filter((i) => i.status !== 'queued')
    if (!failed.length) return
    await requeue(failed)
    await loadPending()
  }, [loadPending, requeue])

  const retryOne = useCallback(
    async (item) => {
      await requeue([item])
      await loadPending()
    },
    [loadPending, requeue]
  )

  const discardPending = useCallback(
    async (id) => {
      await deletePending(id)
      await loadPending()
    },
    [loadPending]
  )

  // --- Startup connectivity check -------------------------------------------

  const checkConnection = useCallback(() => {
    setConnState('checking')
    checkHealth()
      .then(() => setConnState('ok'))
      .catch(() => setConnState('down'))
  }, [])

  useEffect(() => {
    checkConnection()
  }, [checkConnection])

  // --- Lifecycle -----------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    initDB()
      .then(async () => {
        if (cancelled) return
        setIsDBReady(true)
        await loadPending()
      })
      .catch((err) => console.warn('[vesper] IndexedDB init failed:', err))
    return () => {
      cancelled = true
    }
  }, [loadPending])

  useEffect(() => {
    if (connState === 'ok') refreshData()
  }, [connState, refreshData])

  // Restart uploads a closed app left unfinished. Once per launch, after both
  // the server and the local DB are confirmed.
  const resumedRef = useRef(false)
  useEffect(() => {
    if (connState !== 'ok' || !isDBReady || resumedRef.current) return
    resumedRef.current = true
    resume().catch((err) =>
      console.warn('[vesper] Could not resume uploads:', err)
    )
  }, [connState, isDBReady, resume])

  useEffect(() => {
    window.addEventListener('online', retryAll)
    return () => window.removeEventListener('online', retryAll)
  }, [retryAll])

  // --- Handlers ------------------------------------------------------------

  // Stays on whatever tab you're on — the tray shows the entry's progress, and
  // its transcript appears in place when it lands.
  const handleUploadSuccess = refreshData

  // Poll every 3 s while any transcript is awaiting transcription.
  useEffect(() => {
    const hasPending = transcripts.some((t) => t.transcript === null)
    if (!hasPending) return
    const id = setInterval(refreshData, 3000)
    return () => clearInterval(id)
  }, [transcripts, refreshData])

  const handleSelectDate = useCallback((date) => {
    setFilterDate(date)
    setActiveTab('entries')
  }, [])

  const handleDelete = useCallback(
    async (id) => {
      await deleteTranscript(id)
      await refreshData()
    },
    [refreshData]
  )

  // Patch the edited entry in place first so the card closes onto the new text
  // immediately, then refresh for the server's authoritative word_count.
  const handleEdit = useCallback(
    async (id, text) => {
      const saved = await updateTranscript(id, text)
      setTranscripts((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, transcript: saved.transcript, word_count: saved.word_count }
            : t
        )
      )
      refreshData()
    },
    [refreshData]
  )

  const clearFilter = useCallback(() => setFilterDate(null), [])

  // --- Render --------------------------------------------------------------

  // The Record tab's orb already shows a live recording; the nav ring only
  // needs to flag it from the other tabs.
  const recordingAway = activeTab !== 'record' && recordingSince !== null

  if (connState === 'checking') {
    return (
      <div className={styles.authGate}>
        <VesperGlyph size={56} />
      </div>
    )
  }

  if (connState === 'down') {
    return (
      <div className={styles.authGate}>
        <div className={styles.offlineCard}>
          <VesperGlyph size={56} />
          <p className={styles.offlineText}>
            Can't reach Vesper — check that Tailscale is connected.
          </p>
          <button
            type="button"
            className={styles.offlineRetry}
            onClick={checkConnection}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.app}>
      <button
        type="button"
        className={styles.settingsBtn}
        onClick={() => setShowSettings(true)}
        aria-label="Settings"
      >
        <SettingsIcon size={20} stroke={1.6} />
      </button>

      {showSettings && (
        <SettingsOverlay onClose={() => setShowSettings(false)} />
      )}

      {pendingUploads.length > 0 && (
        <div className={styles.notices}>
          <PendingUploads
            items={pendingUploads}
            onRetry={retryOne}
            onRetryAll={retryAll}
            onDelete={discardPending}
          />
        </div>
      )}

      <main className={styles.content}>
        {/* Always mounted, only hidden: leaving the tab mid-recording must
            not kill the mic. Hidden with visibility (not display:none) so the
            carousel and entry window keep their scroll positions. */}
        <div
          className={activeTab === 'record' ? styles.pane : styles.paneHidden}
          aria-hidden={activeTab !== 'record'}
        >
          <Recorder
            isDBReady={isDBReady}
            calendarData={calendarData}
            transcripts={transcripts}
            jobs={jobs}
            onRecordingDone={enqueue}
            onRecordingChange={setRecordingSince}
            onUploadSuccess={handleUploadSuccess}
          />
        </div>

        {activeTab === 'calendar' && (
          <CalendarView
            calendarData={calendarData}
            onSelectDate={handleSelectDate}
          />
        )}

        {activeTab === 'entries' && (
          <TranscriptList
            transcripts={transcripts}
            filterDate={filterDate}
            loaded={dataLoaded}
            onClearFilter={clearFilter}
            onDelete={handleDelete}
            onEdit={handleEdit}
          />
        )}
      </main>

      <nav className={styles.tabbar} aria-label="Primary">
        <span
          className={styles.indicator}
          style={{ '--idx': TABS.findIndex((t) => t.id === activeTab) }}
          aria-hidden="true"
        />
        {TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              type="button"
              className={`${styles.tab} ${active ? styles.tabActive : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                if (id !== 'entries') setFilterDate(null)
                setActiveTab(id)
              }}
            >
              <span className={styles.iconWrap}>
                <Icon size={23} stroke={active ? 2.1 : 1.6} />
                {id === 'record' && (
                  <NavProgressRing jobs={jobs} recording={recordingAway} />
                )}
              </span>
              <span className={styles.tabLabel}>{label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
