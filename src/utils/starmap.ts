// ── Starmap geometry ─────────────────────────────────────────────────────────
// The Scales Explorer's Starmap view draws the 12 notes on a ring in
// chromatic order, C at the top, clockwise. A chord's notes joined in ring
// order make its "star": every chord of one quality is the same shape turned
// (all major triads one triangle, minor triads its mirror image), so the eye
// learns qualities as shapes.

// ── Ring layouts — where each note sits, 0 = top, clockwise. Chromatic: by
// semitone (C C♯ D …). Fifths: the Circle of Fifths order (C G D A …), so
// chords pack into tight clusters and keys a fifth apart sit side by side.
// Either way every chord of one quality is the same shape turned. ───────
export type RingLayout = 'chromatic' | 'fifths'
export function ringPosition(pc: number, layout: RingLayout): number {
  const n = ((pc % 12) + 12) % 12
  return layout === 'fifths' ? (n * 7) % 12 : n
}

// ── Angle of a note on the ring, degrees, 0 = top, clockwise ───────────────
export function pcAngle(pc: number): number {
  return (((pc % 12) + 12) % 12) * 30
}

// ── Point on the ring for a note — SVG coordinates (y grows downward) ──────
export function pcPoint(pc: number, cx: number, cy: number, r: number): { x: number; y: number } {
  const rad = ((pcAngle(pc) - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

// ── The notes a shape joins: unique, in ring order. Joining them in this
// order never crosses itself. Shapes need 3–6 different notes — fewer is
// a line or a dot, more stops reading as a star. ─────────────────────────
export const STAR_MIN_NOTES = 3
export const STAR_MAX_NOTES = 6

export function ringOrder(pcs: Iterable<number>): number[] {
  return Array.from(new Set(Array.from(pcs, pc => ((pc % 12) + 12) % 12))).sort((a, b) => a - b)
}

export function starShape(pcs: Iterable<number>): number[] | null {
  const order = ringOrder(pcs)
  return order.length >= STAR_MIN_NOTES && order.length <= STAR_MAX_NOTES ? order : null
}

// ── SVG points attribute for a shape ───────────────────────────────────────
export function shapePoints(order: number[], cx: number, cy: number, r: number): string {
  return order.map(pc => { const p = pcPoint(pc, cx, cy, r); return `${p.x.toFixed(2)},${p.y.toFixed(2)}` }).join(' ')
}

// ── Motion: pairing the points of one star with the next ───────────────────
// Positions are in note units (0–12, fractional mid-glide). Notes the two
// chords share stay put; the rest are matched by the least total travel
// round the rim. A new point (3 → 4 notes) grows out of the nearest old one;
// a leftover point (4 → 3) slides into the nearest new one and merges.
// Returns where each point starts and ends; `end` is unwrapped (start + the
// shortest signed arc) so a straight blend glides the short way round.

// shortest signed distance round the ring from a to b, in notes (−6…6)
export function ringArc(a: number, b: number): number {
  let d = (((b - a) % 12) + 12) % 12
  if (d > 6) d -= 12
  return d
}

// best assignment of `few` onto distinct members of `many` (least total |arc|)
function bestMatch(few: number[], many: number[]): number[] {
  let best: number[] = [], bestCost = Infinity
  const used = new Array(many.length).fill(false)
  const pick: number[] = []
  const walk = (i: number, cost: number) => {
    if (cost >= bestCost) return
    if (i === few.length) { bestCost = cost; best = [...pick]; return }
    for (let j = 0; j < many.length; j++) {
      if (used[j]) continue
      used[j] = true; pick.push(j)
      walk(i + 1, cost + Math.abs(ringArc(few[i], many[j])))
      used[j] = false; pick.pop()
    }
  }
  walk(0, 0)
  return best
}

const nearest = (x: number, pool: number[]) =>
  pool.reduce((b, p) => (Math.abs(ringArc(x, p)) < Math.abs(ringArc(x, b)) ? p : b), pool[0])

export function pairVertices(from: number[], to: number[]): { start: number[]; end: number[] } {
  const start: number[] = [], end: number[] = []
  const push = (a: number, b: number) => { start.push(a); end.push(a + ringArc(a, b)) }
  if (from.length === 0) { to.forEach(b => push(b, b)); return { start, end } }
  if (to.length === 0) { from.forEach(a => push(a, a)); return { start, end } }
  const fromRem = [...from], toRem: number[] = []
  for (const b of to) {
    const i = fromRem.findIndex(a => Math.abs(ringArc(a, b)) < 1e-3)
    if (i >= 0) { push(fromRem[i], b); fromRem.splice(i, 1) } else toRem.push(b)
  }
  if (fromRem.length <= toRem.length) {
    const m = bestMatch(fromRem, toRem)
    fromRem.forEach((a, i) => push(a, toRem[m[i]]))
    toRem.forEach((b, j) => { if (!m.includes(j)) push(nearest(b, from), b) })
  } else {
    const m = bestMatch(toRem, fromRem)
    toRem.forEach((b, i) => push(fromRem[m[i]], b))
    fromRem.forEach((a, j) => { if (!m.includes(j)) push(a, nearest(a, to)) })
  }
  return { start, end }
}

// ── Colour blend between two roots, through OKLab so the midpoint stays as
// bright as the ends (no muddy grey on the way from yellow to blue). ─────
type Lab = [number, number, number]
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function hexToOklab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => toLin(v / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ]
}

function oklabToHex([L, A, B]: Lab): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map(c => Math.round(Math.min(1, Math.max(0, fromLin(c))) * 255))
  return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('')
}

export function mixColour(a: string, b: string, t: number): string {
  if (t <= 0) return a
  if (t >= 1) return b
  const x = hexToOklab(a), y = hexToOklab(b)
  return oklabToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}
