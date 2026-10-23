// ── The song's own volume and expression, under the Console fader ───────────
// Songs move their parts' volume (CC7: a fade-out, a part brought up for its
// solo) and expression (CC11: string swells, a held note dying away). Both
// engines play these. The Console fader starts at the song's first volume, so
// at any moment a part plays at the song's volume there × fader ÷ that first
// volume: untouched, exactly as written; pulled down, every swell scaled
// with it.

import type { ControlEvent } from '../types'

interface Track { volumeEvents?: ControlEvent[]; expressionEvents?: ControlEvent[] }

/** The value in effect at `time` (the first one before it starts) */
export function valueAt(events: ControlEvent[], time: number): number {
  let v = events[0].value
  for (const e of events) { if (e.time <= time) v = e.value; else break }
  return v
}

/** Fader → multiplier for the song's volume values: fader ÷ the song's first
 *  volume. A song that starts a part at silence (to fade it in) can't anchor
 *  the fader, so its values play as written. */
export function volumeRatio(track: Track, fader: number): number {
  const first = track.volumeEvents?.[0]?.value
  return first !== undefined && first > 0.01 ? fader / first : 1
}

/** The part's volume (0–1) at `time`, the fader included */
export function volumeAt(track: Track, fader: number, time: number): number {
  const ev = track.volumeEvents
  if (!ev?.length) return Math.max(0, Math.min(1, fader))
  return Math.max(0, Math.min(1, valueAt(ev, time) * volumeRatio(track, fader)))
}

/** The part's expression (0–1) at `time`; full when the song never sets it */
export function expressionAt(track: Track, time: number): number {
  const ev = track.expressionEvents
  return ev?.length ? valueAt(ev, time) : 1
}
