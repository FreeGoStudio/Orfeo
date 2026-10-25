import { useI18n } from '../../utils/i18n'
import { useId, type ReactNode } from 'react'
import { getSettingById, type SettingId } from './catalog'
import { DEFS } from './defs'
import { BetaBadge, SurfaceContext } from './controls'

const always = () => true

// Catalog text with **bold** words: the stars mark what to emphasise
export function richText(text: string): ReactNode {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i} style={{ fontWeight: 600, color: 'var(--text-default)' }}>{part}</b> : part))
}

// ── One setting in the Settings window: icon + name (switch on the right),
// full description, then its controls, glance lines and follow-up options.
export function SettingCard({ id }: { id: SettingId }) {
  useI18n()
  const def = DEFS[id], info = getSettingById()[id]
  const useVisible = def.useVisible ?? always
  const visible = useVisible()
  const labelId = useId()
  if (!visible) return null
  const { Control, Glance, Extra, Description, NameSuffix, icon: Icon } = def
  const onNameLine = def.kind !== 'choice'
  const controlFirst = def.layout === 'controlFirst'
  const description = (
    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', lineHeight: 1.5, fontFamily: 'var(--font-ui)', fontStyle: 'italic', marginTop: controlFirst ? 10 : 0 }}>
      {Description ? <Description /> : richText(info.description)}
    </div>
  )
  return (
    <SurfaceContext.Provider value="window">
    <div role="group" aria-labelledby={labelId} style={{
      background: 'var(--bg-tile)', border: `1px solid ${def.notice ? 'var(--accent-amber-strong)' : 'var(--border2)'}`, borderRadius: 'var(--radius-lg)',
      padding: '12px 14px', minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', columnGap: 8, marginBottom: 6, minHeight: 20 }}>
        <div id={labelId} style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0,
          fontSize: 'var(--text-xs)', color: 'var(--text-default)', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
          <Icon size={13} strokeWidth={1.5} style={{ color: 'var(--text-amber)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.name}{NameSuffix && <> <NameSuffix /></>}</span>
          {def.badge === 'beta' && <BetaBadge />}
        </div>
        {onNameLine ? <Control /> : null}
      </div>
      {controlFirst ? (
        <>
          {!onNameLine && <div style={{ marginTop: 4 }}><Control /></div>}
          {Glance && !def.glanceQuickOnly && <Glance />}
          {description}
        </>
      ) : (
        <>
          {description}
          {!onNameLine && <div style={{ marginTop: 10 }}><Control /></div>}
          {Glance && !def.glanceQuickOnly && <Glance />}
        </>
      )}
      {Extra && <Extra />}
    </div>
    </SurfaceContext.Provider>
  )
}
