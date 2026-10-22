import { useEffect } from 'react'
import { useStore } from '../store'
import { interruptTapping, tappingInterrupted, setTapLatencyProvider, noteClockTick } from '../utils/tapTempoSession'
import { outputLatencySec } from '../audio/engine'

// ── Tap Tempo watcher — supplies the output-device delay for tap stamping,
// and ends the tapping phase on any
// seek / loop wrap / stop so taps from two different places in the song are
// never fitted together. Mounted once (TapTempoPad). ─────────────────────
export function useTapTempo() {
  useEffect(() => {
    setTapLatencyProvider(() => outputLatencySec())
    const unsub = useStore.subscribe((st, prev) => {
      if (st.currentTime !== prev.currentTime) noteClockTick()
      const ses = st.tapSession
      if (!ses || ses.phase === 'preview' || !prev.tapSession) return
      if (!tappingInterrupted(prev, st)) return
      interruptTapping()
    })
    return () => { unsub(); setTapLatencyProvider(() => 0) }
  }, [])
}
