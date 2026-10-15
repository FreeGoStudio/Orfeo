// ── useStarmapMorph ──────────────────────────────────────────────────────────
// Glides the Starmap's star from one chord to the next: shared notes stay
// put, the other points travel round the rim (pairing in utils/starmap.ts),
// the colour blends from the old root's to the new root's and the names
// cross-fade. A star appearing fades and opens out; one disappearing fades.
// A new chord mid-glide starts from wherever the points are right then.
// Respects the system "reduce motion" setting (jumps straight to the end).

import { useEffect, useRef, useState } from 'react'
import { PITCH_CLASS_COLORS } from '../utils/colors'
import { pairVertices, mixColour } from '../utils/starmap'

export interface StarTarget { order: number[]; rootPc: number; name: string }

export interface StarFrame {
  positions: number[]       // star points, in notes (fractional mid-glide)
  colour: string            // current star colour
  name: string | null       // incoming (or current) chord name
  prevName: string | null   // outgoing name while cross-fading
  mix: number               // 0 → 1 over the glide (name cross-fade, halos)
  opacity: number           // whole star
  radiusK: number           // star radius factor (opens out on appear)
  settled: boolean
}

const APPEAR_RADIUS = 0.82
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const settledFrame = (target: StarTarget | null): StarFrame => target
  ? { positions: target.order, colour: PITCH_CLASS_COLORS[target.rootPc], name: target.name, prevName: null, mix: 1, opacity: 1, radiusK: 1, settled: true }
  : { positions: [], colour: PITCH_CLASS_COLORS[0], name: null, prevName: null, mix: 1, opacity: 0, radiusK: 1, settled: true }

export function useStarmapMorph(target: StarTarget | null, durationMs: number): StarFrame {
  const [frame, setFrame] = useState<StarFrame>(() => settledFrame(target))
  const frameRef = useRef(frame)
  frameRef.current = frame
  const rafRef = useRef<number | null>(null)
  const key = target ? `${target.order.join(',')}|${target.rootPc}|${target.name}` : ''

  useEffect(() => {
    const cur = frameRef.current
    const end = settledFrame(target)
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    const visible = cur.opacity > 0 && cur.positions.length > 0
    if (durationMs <= 0 || reduceMotion() || (!visible && !target)) { setFrame(end); return }

    // where each point starts and ends
    const from = visible ? cur.positions : (target?.order ?? [])
    const { start, end: stop } = target ? pairVertices(from, target.order) : { start: from, end: from }
    const fromColour = visible ? cur.colour : end.colour
    const toColour = target ? end.colour : cur.colour
    const fromOpacity = visible ? cur.opacity : 0
    const toOpacity = target ? 1 : 0
    const fromK = visible ? cur.radiusK : APPEAR_RADIUS
    const prevName = visible ? cur.name : null
    const name = target ? target.name : cur.name
    const t0 = performance.now()

    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs)
      const e = ease(t)
      if (t >= 1) { rafRef.current = null; setFrame(end); return }
      setFrame({
        positions: start.map((s, i) => s + (stop[i] - s) * e),
        colour: mixColour(fromColour, toColour, e),
        name, prevName: prevName === name ? null : prevName,
        mix: e,
        opacity: fromOpacity + (toOpacity - fromOpacity) * e,
        radiusK: fromK + (1 - fromK) * e,
        settled: false,
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return frame
}
