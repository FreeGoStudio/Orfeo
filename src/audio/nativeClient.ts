// ── Renderer side of the native audio engine ─────────────────────────────────
// One MessagePort to Orfeo's audio process (electron/audioHost.ts): commands
// go out as { t: 'call', m, a }, the engine's status comes back ~30×/s into a
// small zustand store. If the audio process ever exits, it is restarted and
// the engine started again with the same options; the caller re-sends the
// song through `onRestart`.

import { create } from 'zustand'

export interface NativeStatus {
  position: number
  playing: boolean
  mode: 'exclusive' | 'shared' | 'none'
  rate: number
  periodFrames: number
  bufferFrames: number
  reportedLatencyMs: number
  lateWakeups: number
  reopens: number
  periodStep: number
  worstRenderMs: number
  deviceName: string
  fallbackReason?: string | null
  error?: string | null
  channelPeaks: number[]
  masterPeak: number
  compReductionDb: number
  liveNotes: number
  liveWaitAvgMs: number
  liveWaitMaxMs: number
  liveQueuedAvgMs: number
}

type Phase = 'off' | 'connecting' | 'starting' | 'running' | 'failed'

export const useNativeAudio = create<{ phase: Phase; status: NativeStatus | null; error: string | null }>(() => ({
  phase: 'off', status: null, error: null,
}))

let port: MessagePort | null = null
let portWaiter: ((p: MessagePort) => void) | null = null
let startOpts: { soundfonts: string[]; exclusive: boolean } | null = null
let startedWaiters: Array<(ok: boolean) => void> = []
const restartListeners = new Set<() => void>()

window.addEventListener('message', (e) => {
  if (e.data !== 'orfeo-audio-port' || !e.ports[0]) return
  port = e.ports[0]
  port.onmessage = onHostMessage
  portWaiter?.(port)
  portWaiter = null
})

function onHostMessage(e: MessageEvent) {
  const m = e.data
  if (m.t === 'status') useNativeAudio.setState({ status: m.status })
  else if (m.t === 'started') {
    useNativeAudio.setState({ phase: 'running', status: m.status, error: null })
    startedWaiters.forEach(w => w(true)); startedWaiters = []
  } else if (m.t === 'error') {
    console.error('[Orfeo Native]', m.during, m.message)
    if (m.during === 'start') {
      useNativeAudio.setState({ phase: 'failed', error: m.message })
      startedWaiters.forEach(w => w(false)); startedWaiters = []
    } else useNativeAudio.setState({ error: m.message })
  }
}

async function connect(): Promise<boolean> {
  const got = new Promise<MessagePort>(res => { portWaiter = res })
  const r = await window.electronAPI.connectNativeAudio()
  if (!r.ok) { useNativeAudio.setState({ phase: 'failed', error: r.reason ?? 'unavailable' }); portWaiter = null; return false }
  await got
  return true
}

/** Starts (or restarts) the engine. Resolves false if it couldn't start. */
export async function startNative(opts: { soundfonts: string[]; exclusive: boolean }): Promise<boolean> {
  startOpts = opts
  useNativeAudio.setState({ phase: 'connecting', error: null })
  if (!port && !(await connect())) return false
  useNativeAudio.setState({ phase: 'starting' })
  const started = new Promise<boolean>(res => startedWaiters.push(res))
  port!.postMessage({ t: 'start', ...opts })
  return started
}

export function stopNative() {
  port?.postMessage({ t: 'stop' })
  useNativeAudio.setState({ phase: 'off', status: null })
}

/** One engine call; silently dropped while the engine isn't running */
export function nativeCall(method: string, ...args: unknown[]) {
  if (useNativeAudio.getState().phase !== 'running') return
  port?.postMessage({ t: 'call', m: method, a: args })
}

export const isNativeRunning = () => useNativeAudio.getState().phase === 'running'

/** Called after the audio process had to be restarted — re-send the song etc. */
export function onNativeRestart(fn: () => void) { restartListeners.add(fn); return () => restartListeners.delete(fn) }

window.electronAPI?.onNativeAudioHostExit?.(async (code) => {
  console.warn('[Orfeo Native] audio process exited', code)
  port = null
  if (!startOpts || useNativeAudio.getState().phase === 'off') return
  if (await startNative(startOpts)) restartListeners.forEach(fn => fn())
})
