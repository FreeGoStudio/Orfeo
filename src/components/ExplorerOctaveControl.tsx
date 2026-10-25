import { useI18n, t } from '../utils/i18n'
// ── ExplorerOctaveControl ────────────────────────────────────────────────────
// "Octave ˄ ˅ ↺" — moves everything the Chord and Scales Explorers play up or
// down by whole octaves (shared setting, so both explorers stay in step).
// Whatever's lit on the keyboard right now moves with it.

import { ChevronUp, ChevronDown, RotateCcw } from 'lucide-react'
import { useStore } from '../store'
import Tooltip from './Tooltip'
import { EXPLORER_OCTAVE_MIN, EXPLORER_OCTAVE_MAX, shiftNotesByOctaves } from '../utils/explorerShared'

const LABEL_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-ui)', fontSize: 10, fontWeight: 600,
  color: 'var(--text-dimmest)', letterSpacing: '0.10em',
  textTransform: 'uppercase', userSelect: 'none',
}

// showLabel: false where the surrounding layout already names the control
// (the Scales Explorer's settings column).
export default function ExplorerOctaveControl({ showLabel = true }: { showLabel?: boolean }) {
  useI18n()
  const octave = useStore(s => s.explorerOctave)

  const moveTo = (next: number) => {
    const clamped = Math.max(EXPLORER_OCTAVE_MIN, Math.min(EXPLORER_OCTAVE_MAX, next))
    const state = useStore.getState()
    const delta = clamped - state.explorerOctave
    if (delta === 0) return
    state.setExplorerOctave(clamped)
    if (state.explorerKeys.size === 0) return
    const notes = Array.from(state.explorerKeys)
    const shifted = shiftNotesByOctaves(notes, delta)
    if (!shifted) return
    const colors = new Map<number, string>()
    notes.forEach((m, i) => { const c = state.explorerKeyColors.get(m); if (c) colors.set(shifted[i], c) })
    state.setExplorerKeys(new Set(shifted), colors)
  }

  const canUp = octave < EXPLORER_OCTAVE_MAX
  const canDown = octave > EXPLORER_OCTAVE_MIN
  const btn = (enabled: boolean): React.CSSProperties => ({
    background: 'none', border: 'none', padding: '0 1px', display: 'flex', alignItems: 'center',
    cursor: enabled ? 'pointer' : 'default',
    color: enabled ? 'var(--text-amber)' : 'var(--state-disabled)',
  })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {showLabel && <span style={{ ...LABEL_STYLE, marginRight: 2 }}>{t`Octave`}</span>}
      <Tooltip oneLine title={t`Octave up`}>
        <button onClick={() => moveTo(octave + 1)} disabled={!canUp} style={btn(canUp)}
          onMouseEnter={e => { if (canUp) e.currentTarget.style.color = 'var(--accent-amber-hover)' }}
          onMouseLeave={e => { e.currentTarget.style.color = canUp ? 'var(--text-amber)' : 'var(--state-disabled)' }}
        ><ChevronUp size={14} strokeWidth={2.5} /></button>
      </Tooltip>
      <Tooltip oneLine title={t`Octave down`}>
        <button onClick={() => moveTo(octave - 1)} disabled={!canDown} style={btn(canDown)}
          onMouseEnter={e => { if (canDown) e.currentTarget.style.color = 'var(--accent-amber-hover)' }}
          onMouseLeave={e => { e.currentTarget.style.color = canDown ? 'var(--text-amber)' : 'var(--state-disabled)' }}
        ><ChevronDown size={14} strokeWidth={2.5} /></button>
      </Tooltip>
      <Tooltip oneLine title={t`Reset octave`}>
        <button onClick={() => moveTo(0)} disabled={octave === 0}
          style={{ ...btn(octave !== 0), color: octave !== 0 ? 'var(--text-inactive)' : 'var(--state-hover-bg)', marginLeft: 2 }}
          onMouseEnter={e => { if (octave !== 0) e.currentTarget.style.color = 'var(--text-amber)' }}
          onMouseLeave={e => { e.currentTarget.style.color = octave !== 0 ? 'var(--text-inactive)' : 'var(--state-hover-bg)' }}
        ><RotateCcw size={12} /></button>
      </Tooltip>
    </div>
  )
}
