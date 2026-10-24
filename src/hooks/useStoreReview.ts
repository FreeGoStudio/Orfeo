import { useEffect } from 'react'
import { create } from 'zustand'
import type { ReviewInfo } from '../types'

// ── Rate Orfeo (Microsoft Store build only — main decides, see review:info in
// electron/main.ts). One shared state for the star button and the note that
// offers a review every 5th launch. ───────────────────────────────────────
export const useStoreReview = create<ReviewInfo & { noteOpen: boolean }>(() => ({
  available: false, prompt: false, noteOpen: false,
}))

// Not at startup: the note appears once Orfeo has been open a little while
const NOTE_DELAY_MS = 30_000

export function useStoreReviewService() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    window.electronAPI.getReviewInfo().then((info) => {
      useStoreReview.setState(info)
      if (info.prompt) timer = setTimeout(() => useStoreReview.setState({ noteOpen: true }), NOTE_DELAY_MS)
    }).catch(() => {})
    return () => clearTimeout(timer)
  }, [])
}

export async function requestStoreReview() {
  useStoreReview.setState({ noteOpen: false })
  const status = await window.electronAPI.requestReview().catch(() => 'error' as const)
  // Rated: no more notes this launch either
  if (status === 'succeeded') useStoreReview.setState({ prompt: false })
}

export function closeReviewNote(never: boolean) {
  useStoreReview.setState({ noteOpen: false })
  if (never) void window.electronAPI.neverAskReview()
}
