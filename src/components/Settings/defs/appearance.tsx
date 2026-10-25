import { useState } from 'react'
import type { LocalePreference } from '../../../i18n/core'
import { tr, useI18n, t } from '../../../utils/i18n'
import { Palette, ZoomIn, RotateCcw, Sparkles, MessageSquare } from 'lucide-react'
import { useStore } from '../../../store'
import { AppBgBtn, ZoomStepper, GlanceLine, InlineIcon, Switch, useSurface } from '../controls'
import { useAppZoom } from '../../../hooks/useAppZoom'
import type { SettingDef } from '../types'

function ThemeControl() {
  useI18n()
  const appTheme = useStore(s => s.appTheme)
  return (
    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
      <AppBgBtn color="var(--bg-modal-header)" label={tr("Dark")} active={appTheme === 'dark'} onClick={() => useStore.getState().setAppTheme('dark')} />
      <AppBgBtn color="var(--bg-warm)" label={tr("Coming soon")} active={false} onClick={() => {}} comingSoon />
    </div>
  )
}

function AppZoomControl() {
  const z = useAppZoom()
  // tooltips in Setup only — the window card explains the buttons in text
  const surface = useSurface()
  return <ZoomStepper percent={z.percent} steps={z.steps} max={z.max} onStep={z.step} onReset={z.reset} tooltips={surface === 'setup'} />
}
function AppZoomGlance() {
  useI18n()
  const z = useAppZoom()
  return (
    <GlanceLine>
      {t`Ctrl + / Ctrl − / Ctrl 0 — like a web browser`}
      {z.max < 200 && <>{' · '}{t`Limited to ${z.max}% at this window size.`}</>}
    </GlanceLine>
  )
}

// Window card: the description already gives the shortcuts — only the size cap
function AppZoomCap() {
  useI18n()
  const z = useAppZoom()
  if (z.max >= 200) return null
  return <GlanceLine>{t`Limited to ${z.max}% at this window size.`}</GlanceLine>
}

function LanguageControl() {
  const { preference, setLanguage, tr } = useI18n()
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  return <div>
    <select aria-label={tr('language.label')} value={preference} disabled={busy}
      style={{ width: '100%', minWidth: 0, padding: '6px 8px', color: 'var(--text-default)', background: 'var(--bg-tile)', border: '1px solid var(--border2)', borderRadius: 4 }}
      onChange={async e => {
        setBusy(true); setError(false)
        try { await setLanguage(e.target.value as LocalePreference) } catch { setError(true) } finally { setBusy(false) }
      }}>
      <option value="system">{tr('language.system')}</option>
      <option value="en">English</option>
      <option value="zh-CN">简体中文</option>
    </select>
    {error && <div role="alert">{tr('language.error')}</div>}
  </div>
}

export const APPEARANCE_DEFS: SettingDef[] = [
  { id: 'language', icon: MessageSquare, kind: 'choice', Control: LanguageControl },
  { id: 'theme', icon: Palette, kind: 'choice', Control: ThemeControl },
  { id: 'appZoom', icon: ZoomIn, kind: 'inline', Control: AppZoomControl, Glance: AppZoomGlance, glanceQuickOnly: true, Extra: AppZoomCap,
    Description: () => <>{t`Makes everything in Orfeo bigger or smaller. Ctrl + / Ctrl − / Ctrl 0 work exactly as in a web browser.`} {t`Click`} <InlineIcon><RotateCcw size={10} /></InlineIcon> {t`to reset.`}</> },
  {
    id: 'tooltips', icon: MessageSquare, kind: 'switch',
    Control: () => { const v = useStore(s => s.tooltipsEnabled); return <Switch value={v} onChange={useStore.getState().setTooltipsEnabled} label={t`Tooltips`} /> },
  },
  {
    id: 'starmap', icon: Sparkles, kind: 'switch',
    Control: () => { const v = useStore(s => s.starmapEnabled); return <Switch value={v} onChange={useStore.getState().setStarmapEnabled} label={t`Starmap`} /> },
  },
]
