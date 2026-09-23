import styles from './NavProgressRing.module.css'

// Upload progress as a ring around the Record tab's icon: visible from every
// tab, costs no layout. Deliberately wordless. The status text lives in the
// Record screen's "where you left off" window (Recorder.jsx ghost lines).
//
// Several uploads at once average into one ring. Upload bytes fill the first
// two thirds; transcription has no measurable progress, so it holds at 85% and
// breathes; done closes the ring, which then fades as the queue clears the job.

const R = 15
const C = 2 * Math.PI * R

function jobFraction(job) {
  switch (job.stage) {
    case 'uploading':
      return 0.66 * Math.min(1, job.progress || 0)
    case 'transcribing':
      return 0.85
    case 'done':
      return 1
    default:
      return 0 // queued
  }
}

export default function NavProgressRing({ jobs, recording }) {
  const active = jobs.length > 0
  const fraction = active
    ? jobs.reduce((sum, j) => sum + jobFraction(j), 0) / jobs.length
    : 0
  const sending = jobs.some((j) => j.stage === 'queued' || j.stage === 'uploading')
  const transcribing = !sending && jobs.some((j) => j.stage === 'transcribing')

  let mode = 'idle'
  if (recording) mode = 'recording'
  else if (sending) mode = 'uploading'
  else if (transcribing) mode = 'transcribing'
  else if (active) mode = 'done'

  // Recording (away from the Record tab) shows a full ember ring instead.
  const shown = recording ? 1 : fraction

  return (
    <svg
      className={styles.ring}
      data-mode={mode}
      viewBox="0 0 36 36"
      aria-hidden="true"
    >
      <circle className={styles.track} cx="18" cy="18" r={R} />
      <circle
        className={styles.fill}
        cx="18"
        cy="18"
        r={R}
        strokeDasharray={`${shown * C} ${C}`}
        transform="rotate(-90 18 18)"
      />
    </svg>
  )
}
