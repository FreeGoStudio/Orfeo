import { createInstance, type i18n } from 'i18next'
import en from './locales/en.json'
import zh from './locales/zh-CN.json'

export type Locale = 'en' | 'zh-CN'
export type LocalePreference = 'system' | Locale
export interface LocaleState { preference: LocalePreference; locale: Locale }
export type Message = { key: string; values?: Record<string, string | number> }
export function normalizePreference(value: unknown): LocalePreference {
  return value === 'en' || value === 'zh-CN' ? value : 'system'
}
export function resolveLocale(preference: LocalePreference, system: string): Locale {
  return preference === 'system' ? (/^zh(?:[-_]|$)/i.test(system) ? 'zh-CN' : 'en') : preference
}
export function createTranslator(locale: Locale = 'en'): i18n {
  const instance = createInstance()
  void instance.init({
    lng: locale, fallbackLng: 'en', supportedLngs: ['en', 'zh-CN'],
    resources: { en: { translation: en }, 'zh-CN': { translation: zh } },
    initAsync: false, keySeparator: false, nsSeparator: false,
    interpolation: { escapeValue: false }, returnEmptyString: false,
  })
  return instance
}
export function templateMessage(strings: TemplateStringsArray, values: unknown[]): Message {
  return {
    key: strings.reduce((key, part, i) => key + part + (i < values.length ? `{{v${i}}}` : ''), ''),
    values: Object.fromEntries(values.map((value, i) => [`v${i}`, String(value)])),
  }
}
export function translate(instance: i18n, message: string | Message): string {
  const { key, values } = typeof message === 'string' ? { key: message, values: undefined } : message
  return instance.t(key, { ...values, defaultValue: key })
}
