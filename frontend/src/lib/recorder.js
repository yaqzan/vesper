// iOS-safe audio recording.
//
// Safari on iOS is picky about MediaRecorder MIME types — it does not support
// webm/opus and instead wants mp4/aac. We feature-detect in preference order
// and fall back to the browser default ('') if nothing matches. Chunks are
// gathered with a 1s timeslice and combined on stop.

import { createAudioMeter } from './audio-meter.js'

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  '',
]

const AUDIO_BITS_PER_SECOND = 64_000

/** Best-guess file extension for a recorded MIME type (for upload filenames). */
export function extForMime(mimeType) {
  if (!mimeType) return 'webm'
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  return 'webm'
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const type of MIME_CANDIDATES) {
    if (type === '') return ''
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

/**
 * Create a recorder bound to a fresh microphone stream.
 * Resolves to: { start(onDone), stop(), discard(), mimeType, stream, meter }
 *   - start(onDone): begins recording; onDone(blob, mimeType) fires on stop.
 *   - stop(): stops recording, releases the mic and closes the meter.
 *   - discard(): like stop(), but the audio is dropped and onDone never fires.
 *   - meter: live level/spectrum tap for the orb visuals, or null if WebAudio
 *     is unavailable. Owned by the recorder — closed automatically on stop.
 */
export async function createRecorder() {
  // Built before the first await so it's still inside the user-gesture task —
  // iOS Safari won't start an AudioContext outside one.
  const meter = createAudioMeter()

  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    })
  } catch (err) {
    if (meter) meter.close()
    throw err
  }

  const mimeType = pickMimeType()
  // Speech for Whisper, not music: 64 kbps is transparent for transcription
  // and a fraction of the browser default (iOS AAC runs ~128k+), so uploads
  // finish several times faster. Browsers that ignore the hint still record.
  const options = { audioBitsPerSecond: AUDIO_BITS_PER_SECOND }
  if (mimeType) options.mimeType = mimeType
  let recorder
  try {
    recorder = new MediaRecorder(stream, options)
  } catch (err) {
    // Don't leave the mic hot or an AudioContext stranded — browsers cap how
    // many can exist, so a leak here breaks every later recording.
    stream.getTracks().forEach((track) => track.stop())
    if (meter) meter.close()
    throw err
  }
  // Some browsers ignore an unsupported requested type and choose their own.
  const effectiveMime = recorder.mimeType || mimeType || 'audio/webm'

  if (meter) meter.connect(stream)

  const chunks = []
  let onDoneCallback = null
  let discarded = false
  let wakeLock = null

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data)
  }

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: effectiveMime })
    chunks.length = 0
    stream.getTracks().forEach((track) => track.stop())
    if (meter) meter.close()
    if (wakeLock) {
      wakeLock.release().catch(() => {})
      wakeLock = null
    }
    if (onDoneCallback && !discarded) onDoneCallback(blob, effectiveMime)
  }

  return {
    mimeType: effectiveMime,
    stream,
    meter,
    async start(onDone) {
      onDoneCallback = onDone
      // Prevent the screen from sleeping mid-recording — iOS/Safari suspends
      // MediaRecorder when the screen locks, so long recordings get truncated.
      if (navigator.wakeLock) {
        try {
          wakeLock = await navigator.wakeLock.request('screen')
          // Re-acquire if the system releases it (e.g. tab goes to background
          // then returns to foreground).
          wakeLock.addEventListener('release', async () => {
            if (recorder.state === 'recording' && navigator.wakeLock) {
              try { wakeLock = await navigator.wakeLock.request('screen') } catch { wakeLock = null }
            }
          })
        } catch {
          // Wake lock unavailable (older Safari, Firefox, privacy settings) —
          // recording still works, just warn in the console.
          console.warn('[vesper] Screen wake lock unavailable — long recordings may be truncated if the screen sleeps.')
        }
      }
      // 1s timeslice keeps memory bounded and survives long recordings.
      recorder.start(1000)
    },
    stop() {
      if (recorder.state !== 'inactive') recorder.stop()
    },
    /** Stop and throw the audio away — releases the mic, never calls onDone. */
    discard() {
      discarded = true
      chunks.length = 0
      if (recorder.state !== 'inactive') recorder.stop()
    },
  }
}
