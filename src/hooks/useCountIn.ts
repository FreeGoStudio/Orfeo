import { useEffect } from 'react'
import { useStore } from '../store'
import { setCountInDeps } from '../utils/countInRunner'
import { metronomeContext, scheduleMetronomeClick, setMetronomeAnchor } from './useMetronome'
import { outputLatencySec } from '../audio/engine'
import { nativeCall } from '../audio/nativeClient'
import { nativeArmStart, nativeCancelArmedStart } from '../audio/useNativeEngine'

// ── Wires the count-in runner (utils/countInRunner.ts) to the real audio:
// the metronome's AudioContext for the clicks and the active engine's
// measured output delay for lining up the first note. Mounted once (App). ─
export function useCountIn() {
  useEffect(() => {
    const native = () => useStore.getState().audioEngine === 'native'
    setCountInDeps({
      // Native: the engine's own clock — clicks are sent as "this many seconds
      // from now", all in one go, so their spacing is exact
      now: () => (native() ? performance.now() / 1000 : metronomeContext().currentTime),
      perfNow: () => performance.now(),
      ctxLatency: () => { if (native()) return outputLatencySec(); const c = metronomeContext() as any; return (c.outputLatency || c.baseLatency || 0) as number },
      engineLatency: () => outputLatencySec(),
      click: (when, accent) => {
        if (native()) { nativeCall('clickAfter', Math.max(0, when - performance.now() / 1000), accent); return { stop: () => nativeCancelArmedStart() } }
        const osc = scheduleMetronomeClick(when, accent); return { stop: () => osc.stop(0) }
      },
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (t) => window.clearTimeout(t as number),
      anchor: setMetronomeAnchor,
      engine: () => useStore.getState().audioEngine,
      engineStartedAt: () => ((window as any).__orfeoEngineStartedAt ?? null) as number | null,
      prepare: () => { (window as any).__orfeoPrepareStart?.() },
      armStart: (songTime, delay) => { if (!native()) return false; nativeArmStart(songTime, delay); return true },
    })
    return () => setCountInDeps(null)
  }, [])
}
