import { useTranslation } from 'react-i18next'
import { createTranslator, normalizePreference, resolveLocale, templateMessage, translate, type LocaleState, type LocalePreference, type Message } from '../i18n/core'

export const i18n = createTranslator()
let state: LocaleState = { preference: 'system', locale: 'en' }
export const getLocaleState = () => state
export function t(strings: TemplateStringsArray, ...values: unknown[]): string {
  return translate(i18n, templateMessage(strings, values))
}
export function tr(key: string, values?: Message['values']): string {
  return translate(i18n, { key, values })
}
export function useI18n() {
  useTranslation(undefined, { i18n, useSuspense: false })
  return { t, tr, ...state, setLanguage }
}
async function applyLanguage(next: LocaleState) {
  state = next
  document.documentElement.lang = next.locale
  await i18n.changeLanguage(next.locale)
}
export async function setLanguage(preference: LocalePreference) {
  const next = window.electronAPI?.setLocale
    ? await window.electronAPI.setLocale(preference)
    : { preference, locale: resolveLocale(preference, navigator.language) }
  await applyLanguage(next)
}
export async function initializeLanguage() {
  const fallback: LocaleState = { preference: 'system', locale: resolveLocale('system', navigator.language) }
  try {
    const next = await window.electronAPI?.getLocale?.()
    await applyLanguage(next ? { preference: normalizePreference(next.preference), locale: next.locale } : fallback)
  } catch {
    await applyLanguage(fallback)
  }
  return window.electronAPI?.onLocaleChanged?.(next => { void applyLanguage(next) })
}

// Keep messages in state as descriptors; resolve only at their presentation boundary.
export const message = (key: string, values?: Message['values']): Message => ({ key, values })
export const renderMessage = (value: string | Message): string => translate(i18n, value)

export const msg = (strings: TemplateStringsArray, ...values: unknown[]): Message => templateMessage(strings, values)

export function translator(locale: 'en' | 'zh-CN') {
  const fixed = i18n.getFixedT(locale)
  return {
    tr: (key: string) => fixed(key, { defaultValue: key }),
    t: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const m = templateMessage(strings, values)
      return fixed(m.key, { ...m.values, defaultValue: m.key })
    },
  }
}
