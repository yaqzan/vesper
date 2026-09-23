import { useEffect, useRef } from 'react'

// A spectrum ring drawn around the recorder orb, so you can see the mic is
// hearing you. Bars are mirrored about the vertical axis — bass at the top,
// treble at the bottom — which keeps the ring balanced however you speak.
//
// The loop runs entirely outside React: it draws to the canvas and writes the
// overall loudness to `--vsp-level` on the orb element, which CSS turns into
// the orb's scale and glow. Nothing here triggers a render.

const BASE_LEN = 0.008 // resting bar length, as a fraction of canvas size
const MAX_LEN = 0.125 // ...and how far a full-scale band reaches
const RING_R = 0.352 // bar footings, just outside the sphere's rim
const BAR_FILL = 0.5 // bar width as a fraction of its slot

/**
 * @param meter    an audio-meter instance, or null when unavailable
 * @param active   whether to run the draw loop
 * @param orbRef   ref to the element that receives `--vsp-level`
 * @param className positioning class supplied by the parent
 */
export default function AudioRing({ meter, active, orbRef, className }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !meter || !active) return

    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    const orb = orbRef && orbRef.current
    const css = getComputedStyle(canvas)
    const readVar = (name, fallback) =>
      css.getPropertyValue(name).trim() || fallback
    const ember = readVar('--vsp-ember', '#c2473a')
    const emberBright = readVar('--vsp-ember-bright', '#e8775f')
    const gold = readVar('--vsp-gold-bright', '#f2d98a')

    let raf = 0
    let cssSize = 0
    let gradient = null

    const frame = () => {
      raf = requestAnimationFrame(frame)

      const size = canvas.clientWidth
      if (!size) return

      // The orb is sized off the viewport, so re-fit whenever it changes.
      if (size !== cssSize) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        cssSize = size
        canvas.width = Math.round(size * dpr)
        canvas.height = Math.round(size * dpr)
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
        gradient = null
      }

      const { level, bands } = meter.read()
      if (orb) orb.style.setProperty('--vsp-level', level.toFixed(3))

      const c = size / 2
      const r0 = size * RING_R
      const maxLen = size * MAX_LEN
      const baseLen = size * BASE_LEN
      const total = bands.length * 2

      if (!gradient) {
        gradient = ctx2d.createRadialGradient(c, c, r0, c, c, r0 + maxLen)
        gradient.addColorStop(0, ember)
        gradient.addColorStop(0.55, emberBright)
        gradient.addColorStop(1, gold)
      }

      ctx2d.clearRect(0, 0, size, size)
      ctx2d.strokeStyle = gradient
      ctx2d.lineCap = 'round'

      // A faint circle joining the footings, brightening as you speak.
      const barW = ((2 * Math.PI * r0) / total) * BAR_FILL
      ctx2d.lineWidth = 1
      ctx2d.globalAlpha = 0.08 + level * 0.2
      ctx2d.beginPath()
      ctx2d.arc(c, c, r0 - barW, 0, Math.PI * 2)
      ctx2d.stroke()

      ctx2d.lineWidth = barW
      for (let j = 0; j < total; j += 1) {
        // Second half walks the bands back down, mirroring the first.
        const energy = j < bands.length ? bands[j] : bands[total - 1 - j]
        const len = baseLen + energy * maxLen
        const angle = -Math.PI / 2 + (j / total) * Math.PI * 2
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        ctx2d.globalAlpha = 0.26 + energy * 0.74
        ctx2d.beginPath()
        ctx2d.moveTo(c + cos * r0, c + sin * r0)
        ctx2d.lineTo(c + cos * (r0 + len), c + sin * (r0 + len))
        ctx2d.stroke()
      }
      ctx2d.globalAlpha = 1
    }

    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      if (orb) orb.style.setProperty('--vsp-level', '0')
      if (cssSize) ctx2d.clearRect(0, 0, cssSize, cssSize)
    }
  }, [meter, active, orbRef])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
