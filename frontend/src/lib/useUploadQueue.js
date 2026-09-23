// Background upload queue. Owns every recording from the moment it stops until
// its transcript lands, so the recorder is free again immediately and uploads
// carry on while you browse other tabs or record the next entry.
//
// Durability: a recording is written to IndexedDB (status 'queued') BEFORE the
// upload starts. If the app is closed mid-upload — iOS suspends a backgrounded
// PWA's network — the record survives and the upload restarts on next launch.
// Only a completed upload deletes it. A failed upload flips it to 'failed',
// which is what the PendingUploads banner lists.
//
// Job stages: queued -> uploading -> transcribing -> done. Shown as the Record
// tab's nav ring (NavProgressRing) and as ghost lines under the day's entry
// (Recorder.jsx); 'done' lingers just long enough for the ring to close.

import { useCallback, useEffect, useRef, useState } from 'react'

import { uploadAudio } from './api.js'
import { extForMime } from './recorder.js'
import {
  savePending,
  getAllPending,
  deletePending,
  updatePending,
} from './db.js'

const DONE_LINGER_MS = 1500

export default function useUploadQueue({ transcripts, onUploaded, onFailed }) {
  const [jobs, setJobs] = useState([])
  const jobsRef = useRef([])
  const runningRef = useRef(false)
  const timersRef = useRef(new Map())
  const cbRef = useRef({ onUploaded, onFailed })
  cbRef.current = { onUploaded, onFailed }

  const commit = useCallback((next) => {
    jobsRef.current = next
    setJobs(next)
  }, [])

  const patchJob = useCallback(
    (id, patch) =>
      commit(jobsRef.current.map((j) => (j.id === id ? { ...j, ...patch } : j))),
    [commit]
  )

  const removeJob = useCallback(
    (id) => {
      clearTimeout(timersRef.current.get(id))
      timersRef.current.delete(id)
      commit(jobsRef.current.filter((j) => j.id !== id))
    },
    [commit]
  )

  const addJobs = useCallback(
    (items) => {
      const known = new Set(jobsRef.current.map((j) => j.id))
      const fresh = items.filter((i) => !known.has(i.id))
      if (fresh.length) commit([...jobsRef.current, ...fresh])
    },
    [commit]
  )

  // One upload at a time, oldest first — parallel uploads would just split
  // the same uplink and make every entry finish later.
  const run = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    try {
      for (;;) {
        const job = jobsRef.current.find((j) => j.stage === 'queued')
        if (!job) break
        patchJob(job.id, { stage: 'uploading', progress: 0 })
        const filename = `vesper-${job.timestamp}.${extForMime(job.mimeType)}`
        let lastPct = -1
        try {
          const entry = await uploadAudio(
            job.blob,
            job.mimeType,
            filename,
            job.localDate,
            (f) => {
              const pct = Math.floor(f * 100)
              if (pct !== lastPct) {
                lastPct = pct
                patchJob(job.id, { progress: f })
              }
            }
          )
          patchJob(job.id, {
            stage: 'transcribing',
            progress: 1,
            entryId: entry.id,
            blob: null, // the server has it; free the memory
          })
          await deletePending(job.id).catch(() => {})
          await cbRef.current.onUploaded?.()
        } catch (err) {
          console.warn('[vesper] Upload failed, keeping offline:', err)
          try {
            await updatePending(job.id, {
              attempts: (job.attempts || 0) + 1,
              lastError: err.message,
              status: 'failed',
            })
          } catch (dbErr) {
            console.error('[vesper] Could not mark upload failed:', dbErr)
          }
          removeJob(job.id)
          await cbRef.current.onFailed?.()
        }
      }
    } finally {
      runningRef.current = false
    }
  }, [patchJob, removeJob])

  /** Hand a finished recording to the queue. Persists it first. */
  const enqueue = useCallback(
    async ({ blob, mimeType, localDate, durationSeconds }) => {
      const record = {
        id: crypto.randomUUID(),
        blob,
        mimeType,
        localDate,
        timestamp: new Date().toISOString(),
        durationSeconds,
        fileSizeBytes: blob.size,
        attempts: 0,
        lastError: null,
        status: 'queued',
      }
      try {
        await savePending(record)
      } catch (err) {
        // Quota or a broken DB: still upload from memory, just without the
        // survive-an-app-close guarantee.
        console.warn('[vesper] Could not persist recording before upload:', err)
      }
      addJobs([{ ...record, stage: 'queued', progress: 0 }])
      run()
    },
    [addJobs, run]
  )

  /** Re-queue stored records (retry from the banner, or resume on launch). */
  const requeue = useCallback(
    async (items) => {
      for (const item of items) {
        await updatePending(item.id, { status: 'queued' }).catch(() => {})
      }
      addJobs(items.map((i) => ({ ...i, stage: 'queued', progress: 0 })))
      run()
    },
    [addJobs, run]
  )

  /** Pick up anything a closed app left mid-upload. Call once the server is reachable. */
  const resume = useCallback(async () => {
    const all = await getAllPending()
    const interrupted = all
      .filter((i) => i.status === 'queued')
      .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
    if (interrupted.length) await requeue(interrupted)
  }, [requeue])

  // transcribing -> done once the entry's text shows up in the list; the job
  // then lingers briefly and clears itself.
  useEffect(() => {
    const ready = new Set(
      (transcripts || [])
        .filter((t) => t.transcript !== null)
        .map((t) => t.id)
    )
    const finished = jobsRef.current.filter(
      (j) => j.stage === 'transcribing' && ready.has(j.entryId)
    )
    if (!finished.length) return
    const ids = new Set(finished.map((j) => j.id))
    commit(
      jobsRef.current.map((j) => (ids.has(j.id) ? { ...j, stage: 'done' } : j))
    )
    for (const id of ids) {
      timersRef.current.set(
        id,
        setTimeout(() => removeJob(id), DONE_LINGER_MS)
      )
    }
  }, [transcripts, commit, removeJob])

  useEffect(() => {
    const timers = timersRef.current
    return () => timers.forEach((t) => clearTimeout(t))
  }, [])

  return { jobs, enqueue, requeue, resume }
}
