import { useEffect } from 'react'
import { create } from 'zustand'
import { useStore } from '../store'
import type { SupportNoteInfo } from '../types'

// ── The "Enjoying Orfeo?" note (components/SupportNote.tsx) and the Store
// build's Rate Orfeo star. Main decides which build this is and whether the
// note is due this launch (note:info in electron/main.ts). ─────────────────
export const useSupportNote = create<SupportNoteInfo & { noteOpen: boolean }>(() => ({
  store: false, prompt: false, noteOpen: false,
}))

// Not at startup: the note appears once Orfeo has been open a little while
const NOTE_DELAY_MS = 30_000

export function useSupportNoteService() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    window.electronAPI.getSupportNoteInfo().then((info) => {
      useSupportNote.setState(info)
      if (info.prompt) timer = setTimeout(() => {
        // Settings › Appearance › Enjoying Orfeo? can switch it off
        if (useStore.getState().supportNoteEnabled) useSupportNote.setState({ noteOpen: true })
      }, NOTE_DELAY_MS)
    }).catch(() => {})
    return () => clearTimeout(timer)
  }, [])
}

export async function requestStoreReview() {
  useSupportNote.setState({ noteOpen: false })
  await window.electronAPI.requestReview().catch(() => {})
}

// 'later' — until the next 5th launch · 'never' — the Store note's "Don't show
// again" · 'snooze' — "Disable for 30 days"
export function closeSupportNote(how: 'later' | 'never' | 'snooze') {
  useSupportNote.setState({ noteOpen: false })
  if (how === 'never') void window.electronAPI.neverShowSupportNote()
  if (how === 'snooze') void window.electronAPI.snoozeSupportNote()
}
