import { Star } from 'lucide-react'
import { useStoreReview, requestStoreReview, closeReviewNote } from '../hooks/useStoreReview'
import { t } from '../utils/i18n'

// ── "Enjoying Orfeo?" — a small note in the corner offering the Microsoft
// Store's review window, every 5th launch of the Store build (see
// hooks/useStoreReview.ts). "Later" waits for the next 5th launch; rating
// or "Don't show again" ends it for good. ──────────────────────────────────
export function StoreReviewNote() {
  const open = useStoreReview((s) => s.noteOpen)
  if (!open) return null
  const btn = (primary: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-sm)',
    cursor: 'pointer',
    border: primary ? 'none' : '1px solid var(--text-inactive)',
    background: primary ? 'var(--text-amber)' : 'transparent',
    color: primary ? 'var(--bg-modal-header)' : 'var(--text-default)',
    fontWeight: primary ? 600 : 400,
    fontFamily: 'var(--font-ui)',
    whiteSpace: 'nowrap',
  })
  return (
    <div
      role="dialog"
      aria-label={t`Rate Orfeo`}
      style={{
        position: 'fixed', right: 24, bottom: 32, zIndex: 9900, width: 340,
        background: 'var(--bg-modal)', border: '1px solid var(--border2)',
        borderRadius: 'var(--radius-lg)', padding: '14px 16px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)', fontFamily: 'var(--font-ui)',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-amber)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', marginBottom: 8 }}>
        <Star size={13} strokeWidth={1.5} />
        {t`Enjoying Orfeo?`}
      </div>
      <div style={{ color: 'var(--text-default)', fontSize: 'var(--text-base)', lineHeight: 1.5 }}>
        {t`A rating in the Microsoft Store helps other musicians find it. It only takes a moment.`}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button style={btn(true)} onClick={() => void requestStoreReview()}>{t`Rate Orfeo`}</button>
        <button style={btn(false)} onClick={() => closeReviewNote(false)}>{t`Later`}</button>
        <button style={btn(false)} onClick={() => closeReviewNote(true)}>{t`Don't show again`}</button>
      </div>
    </div>
  )
}
