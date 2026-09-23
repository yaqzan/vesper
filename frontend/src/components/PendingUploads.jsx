import { useState } from 'react'

import {
  formatClockTime,
  formatDuration,
  formatFileSize,
} from '../lib/format.js'
import { WarningIcon, TrashIcon } from './icons.jsx'

import styles from './PendingUploads.module.css'

export default function PendingUploads({
  items,
  onRetry,
  onRetryAll,
  onDelete,
  isRetrying = false,
}) {
  const [expanded, setExpanded] = useState(false)

  if (!items || items.length === 0) return null
  const n = items.length

  return (
    <div className={styles.banner}>
      <button
        type="button"
        className={styles.summary}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <WarningIcon size={18} className={styles.warnIcon} />
        <span className={styles.summaryText}>
          {n} upload{n === 1 ? '' : 's'} failed · saved on this phone
        </span>
        <span className={styles.caret} data-open={expanded}>
          ▾
        </span>
      </button>

      <button
        type="button"
        className={styles.retryAll}
        onClick={onRetryAll}
        disabled={isRetrying}
      >
        {isRetrying ? 'Retrying…' : 'Retry All'}
      </button>

      {expanded && (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.item}>
              <div className={styles.itemInfo}>
                <span className={styles.itemTime}>
                  {formatClockTime(item.timestamp)}
                </span>
                <span className={styles.itemMeta}>
                  {formatDuration(item.durationSeconds)} ·{' '}
                  {formatFileSize(item.fileSizeBytes)} · attempt {item.attempts}
                </span>
                {item.lastError && (
                  <span className={styles.itemError}>{item.lastError}</span>
                )}
              </div>
              <div className={styles.itemActions}>
                <button
                  type="button"
                  className={styles.itemRetry}
                  onClick={() => onRetry(item)}
                  disabled={isRetrying}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className={styles.itemDiscard}
                  onClick={() => onDelete(item.id)}
                  aria-label="Discard recording"
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
