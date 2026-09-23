// Live loudness + spectrum analysis of the microphone stream, used only to
// drive the recorder orb's visual feedback.
//
// This is a passive tap: the analyser is never connected to a destination, so
// it can't colour or feed back into what MediaRecorder captures. Everything is
// wrapped defensively — if WebAudio is missing or throws, createAudioMeter()
// returns null and recording carries on exactly as before.

const FFT_SIZE = 1024
const BANDS = 32

// The voice band. Actual bins are derived from the real sample rate.
const LOW_HZ = 90
const HIGH_HZ = 5200

const DB_FLOOR = -85 // maps to byte 0   — below this reads as silence
const DB_CEIL = -25 // maps to byte 255 — a loud voice close to the mic

const BAND_FLOOR = 0.16 // discard the bottom of the byte range (room hiss)
const BAND_TILT = 0.9 // lift the top bands; speech energy falls off with pitch
const ATTACK = 0.55 // fraction of the gap closed per frame while rising
const RELEASE = 0.12 // ...and while falling back — slow decay reads as "fluid"

const NOISE_GATE = 0.004 // RMS below this is silence, not a quiet voice
const PEAK_FLOOR = 0.03 // never auto-gain a room quieter than this
const PEAK_DECAY = 0.997 // ~4 s half-life for the running loudness reference

/**
 * Create a meter. The AudioContext is constructed eagerly (callers should do
 * this inside the user-gesture task — iOS won't start one otherwise) and only
 * begins reading once connect() is handed a stream.
 *
 * Returns null if WebAudio is unavailable.
 *   - connect(stream): start analysing
 *   - read(): { level, bands } — level 0..1, bands a Float32Array of 0..1.
 *     The same object and array are reused every call; don't retain them.
 *   - close(): release the AudioContext (browsers cap how many can exist)
 */
export function createAudioMeter() {
  const Ctx =
    typeof window !== 'undefined' &&
    (window.AudioContext || window.webkitAudioContext)
  if (!Ctx) return null

  let ctx
  try {
    ctx = new Ctx()
  } catch {
    return null
  }

  const analyser = ctx.createAnalyser()
  analyser.fftSize = FFT_SIZE
  // Low smoothing here — we apply our own asymmetric envelope below, and
  // stacking the two would make the ring sluggish on attack.
  analyser.smoothingTimeConstant = 0.25
  analyser.minDecibels = DB_FLOOR
  analyser.maxDecibels = DB_CEIL

  // Band edges: exponential across the voice range, but forced to advance at
  // least one bin per band. That makes the crowded low end fall back to linear
  // spacing on its own, so no two bands ever show the same reading.
  const binHz = ctx.sampleRate / FFT_SIZE
  const lastBin = analyser.frequencyBinCount - 1
  const lowBin = Math.max(1, Math.round(LOW_HZ / binHz))
  const highBin = Math.min(lastBin, Math.max(lowBin + 1, Math.round(HIGH_HZ / binHz)))
  const ratio = highBin / lowBin

  const bandLo = new Int32Array(BANDS)
  const bandHi = new Int32Array(BANDS)
  const bandTilt = new Float32Array(BANDS)
  let edge = lowBin
  for (let i = 0; i < BANDS; i += 1) {
    let end = Math.round(lowBin * Math.pow(ratio, (i + 1) / BANDS))
    if (end <= edge) end = edge + 1
    bandLo[i] = Math.min(edge, lastBin)
    bandHi[i] = Math.min(Math.max(end, bandLo[i] + 1), lastBin + 1)
    bandTilt[i] = 1 + (i / (BANDS - 1)) * BAND_TILT
    edge = bandHi[i]
  }

  const freq = new Uint8Array(analyser.frequencyBinCount)
  const time = new Uint8Array(analyser.fftSize)
  const bands = new Float32Array(BANDS)
  const out = { level: 0, bands }

  let source = null
  let live = false
  let closed = false
  let peak = PEAK_FLOOR

  function teardown() {
    try {
      if (source) source.disconnect()
    } catch {
      /* already gone */
    }
    try {
      analyser.disconnect()
    } catch {
      /* already gone */
    }
    source = null
    live = false
  }

  return {
    bandCount: BANDS,

    connect(stream) {
      if (closed || live) return
      try {
        source = ctx.createMediaStreamSource(stream)
        source.connect(analyser)
        live = true
        if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      } catch (err) {
        console.warn('[vesper] Audio meter unavailable:', err)
        teardown()
      }
    },

    read() {
      if (!live || closed) return out

      // Overall loudness from the waveform — steadier than averaging the FFT.
      analyser.getByteTimeDomainData(time)
      let sumSq = 0
      for (let i = 0; i < time.length; i += 1) {
        const v = (time[i] - 128) / 128
        sumSq += v * v
      }
      const rms = Math.sqrt(sumSq / time.length)

      // Auto-gain against a slowly-decaying peak, so a soft speaker still
      // fills the ring while a shout doesn't just clip flat.
      peak = Math.max(peak * PEAK_DECAY, PEAK_FLOOR)
      let target = 0
      if (rms > NOISE_GATE) {
        peak = Math.max(peak, rms)
        target = Math.min(1, Math.pow(rms / peak, 0.75))
      }
      out.level += (target - out.level) * (target > out.level ? 0.4 : 0.1)

      // Collapse the ring in silence rather than letting room noise wobble it.
      const gate = Math.min(1, out.level * 2.2)

      analyser.getByteFrequencyData(freq)
      for (let i = 0; i < BANDS; i += 1) {
        const lo = bandLo[i]
        const hi = bandHi[i]
        let sum = 0
        for (let b = lo; b < hi; b += 1) sum += freq[b]
        const avg = sum / (hi - lo) / 255
        const raw = (avg - BAND_FLOOR) / (1 - BAND_FLOOR)
        const e = raw > 0 ? Math.min(1, raw * bandTilt[i]) * gate : 0
        const prev = bands[i]
        bands[i] = prev + (e - prev) * (e > prev ? ATTACK : RELEASE)
      }

      return out
    },

    close() {
      if (closed) return
      closed = true
      teardown()
      ctx.close().catch(() => {})
    },
  }
}
