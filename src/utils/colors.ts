// ── Track color palette ───────────────────────────────────────────────────────
// 10 muted/desaturated colors for comfortable legibility on the dark (#0f0f12)
// background. Functional/state colors are intentionally kept outside the CSS
// token system — track colors are standalone, not theme colors.

// Hand LH/RH slots use the literal hex behind --hand-lh/--hand-rh (src/index.css),
// not a var() reference — track.color is also consumed as a numeric hex by
// PixiJS canvases (PianoRoll, ChannelStrip VU) via parseInt(..., 16), which a
// CSS custom-property string can't satisfy.
export const TRACK_COLOR_PALETTE = [
  '#e8a027', // Amber      — 3rd+ Piano-family track
  '#2dd4bf', // Teal
  '#6270A5', // Hand LH blue — 1st Piano-family track
  '#d1667a', // Rose
  '#5b9bd5', // Sky Blue
  '#7fae6f', // Sage Green
  '#e0895f', // Coral
  '#CB636C', // Hand RH pink — 2nd Piano-family track
  '#5b7c99', // Steel Blue
  '#c99a4a', // Warm Gold
] as const

// ── Starmap note colours — one pastel "starlight" colour per note, used for
// the chord shapes in the Scales Explorer's Starmap view. Hue walks the
// circle of fifths (OKLCH L 0.84 C 0.11, hue 110° + 30° per fifth), so notes
// a fifth apart get neighbouring colours. Index = note (0 = C … 11 = B/H).
// Kept clear of brand amber and the two hand colours. ──────────────────────
export const PITCH_CLASS_COLORS = [
  '#cfd17a', // C
  '#ebb3f7', // C♯/D♭
  '#7ae2c0', // D
  '#ffadad', // D♯/E♭
  '#78d8ff', // E
  '#f0c374', // F
  '#c9beff', // F♯/G♭
  '#a4dd98', // G
  '#ffadd5', // G♯/A♭
  '#65e0e7', // A
  '#ffb589', // A♯/B♭
  '#a0ccff', // B/H
] as const

// ── Piano-family default colors — deterministic regardless of track order,
// so the same visual identity (1st = LH blue, 2nd = RH pink, 3rd+ = amber)
// shows up for any file instead of whatever slot a round-robin lands on.
// Shared by midiParser.ts (initial load) and MidiEditor.tsx (live instrument
// reassignment) so both compute the exact same color for the exact same slot.
export const PIANO_FAMILY_COLORS = [TRACK_COLOR_PALETTE[2], TRACK_COLOR_PALETTE[7], TRACK_COLOR_PALETTE[0]]

// ── 4th+ piano-family track color — cycles through the rest of the palette
// instead of repeating the 3rd slot's amber for every track after it. "I
// don't care what color, just different" — not the same amber, and not
// colliding with slots 1-3's blue/pink/amber either. ─────────────────────
const PIANO_EXTRA_COLORS = TRACK_COLOR_PALETTE.filter((_, i) => i !== 0 && i !== 2 && i !== 7)
export function pianoFamilyColor(pianoIndex: number): string {
  if (pianoIndex < PIANO_FAMILY_COLORS.length) return PIANO_FAMILY_COLORS[pianoIndex]
  return PIANO_EXTRA_COLORS[(pianoIndex - PIANO_FAMILY_COLORS.length) % PIANO_EXTRA_COLORS.length]
}
