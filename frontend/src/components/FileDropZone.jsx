import { useCallback, useRef, useState } from 'react'
import { uploadAudio } from '../lib/api.js'
import { journalToday } from '../lib/format.js'
import { UploadIcon } from './icons.jsx'
import styles from './FileDropZone.module.css'

function isAudio(file) {
  return (
    file.type.startsWith('audio/') ||
    file.type === 'video/mp4' ||
    file.type === 'video/webm' ||
    file.type === 'video/quicktime'
  )
}

const LABELS = {
  idle: 'Drop audio file · or click to browse',
  over: 'Release to transcribe',
  uploading: 'Transcribing…',
  done: 'Saved.',
}

export default function FileDropZone({ onUploadSuccess, disabled, localDate }) {
  const [phase, setPhase] = useState('idle') // idle | over | uploading | done | error
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef = useRef(null)
  const resetRef = useRef(null)

  const scheduleReset = useCallback(() => {
    clearTimeout(resetRef.current)
    resetRef.current = setTimeout(() => {
      setPhase('idle')
      setErrorMsg('')
    }, 2500)
  }, [])

  const processFile = useCallback(
    async (file) => {
      if (!isAudio(file)) {
        setErrorMsg('Not an audio file')
        setPhase('error')
        scheduleReset()
        return
      }
      setPhase('uploading')
      try {
        await uploadAudio(
          file,
          file.type || 'audio/mpeg',
          file.name,
          localDate || journalToday()
        )
        setPhase('done')
        if (onUploadSuccess) await onUploadSuccess()
        scheduleReset()
      } catch (err) {
        setErrorMsg(err.message || 'Upload failed')
        setPhase('error')
        scheduleReset()
      }
    },
    [onUploadSuccess, scheduleReset]
  )

  const handleDragOver = useCallback(
    (e) => {
      e.preventDefault()
      if (phase !== 'uploading') setPhase('over')
    },
    [phase]
  )

  const handleDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setPhase((p) => (p === 'over' ? 'idle' : p))
    }
  }, [])

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      if (disabled || phase === 'uploading') return
      clearTimeout(resetRef.current)
      setPhase('idle')
      const file = e.dataTransfer.files[0]
      if (file) processFile(file)
    },
    [disabled, phase, processFile]
  )

  const handleClick = useCallback(() => {
    if (disabled || phase === 'uploading') return
    inputRef.current?.click()
  }, [disabled, phase])

  const handleFileChange = useCallback(
    (e) => {
      const file = e.target.files[0]
      e.target.value = ''
      if (!file) return
      clearTimeout(resetRef.current)
      processFile(file)
    },
    [processFile]
  )

  const label = phase === 'error' ? errorMsg : (LABELS[phase] ?? LABELS.idle)

  return (
    <div
      className={[
        styles.zone,
        phase === 'over' ? styles.over : '',
        phase === 'uploading' ? styles.uploading : '',
        phase === 'done' ? styles.done : '',
        phase === 'error' ? styles.errored : '',
        disabled ? styles.muted : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Drop audio file or click to browse"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/mp4,video/webm,video/quicktime,.m4a,.flac"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <UploadIcon size={18} stroke={1.6} />
      <span className={styles.label}>{label}</span>
    </div>
  )
}
