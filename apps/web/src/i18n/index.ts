import { createI18n, type I18n } from 'vue-i18n'
import en from './locales/en.json'
import fr from './locales/fr.json'

export const LOCALES = ['fr', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const LOCALE_LABELS: Record<Locale, string> = { fr: 'Français', en: 'English' }

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
}

/** Choix explicite (persisté par le store) sinon langues du navigateur, sinon anglais. */
export function detectLocale(saved: string | null, languages: readonly string[] = navigator.languages ?? [navigator.language]): Locale {
  if (isLocale(saved)) return saved
  for (const l of languages) {
    const base = l.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return 'en'
}

const numberFormats = {
  fr: {
    integer: { maximumFractionDigits: 0 },
    decimal1: { minimumFractionDigits: 1, maximumFractionDigits: 1 },
    percent: { style: 'percent', maximumFractionDigits: 0 },
  },
  en: {
    integer: { maximumFractionDigits: 0 },
    decimal1: { minimumFractionDigits: 1, maximumFractionDigits: 1 },
    percent: { style: 'percent', maximumFractionDigits: 0 },
  },
} as const

const datetimeFormats = {
  fr: {
    time: { hour: '2-digit', minute: '2-digit' }, short: { weekday: 'short', hour: '2-digit', minute: '2-digit' },
    date: { weekday: 'short', day: 'numeric', month: 'short' }, weekday: { weekday: 'short' }, hour: { hour: 'numeric' },
    month: { month: 'short' }, long: { day: 'numeric', month: 'long', year: 'numeric' },
  },
  en: {
    time: { hour: '2-digit', minute: '2-digit' }, short: { weekday: 'short', hour: '2-digit', minute: '2-digit' },
    date: { weekday: 'short', day: 'numeric', month: 'short' }, weekday: { weekday: 'short' }, hour: { hour: 'numeric' },
    month: { month: 'short' }, long: { day: 'numeric', month: 'long', year: 'numeric' },
  },
} as const

export const i18n: I18n<{ fr: typeof fr; en: typeof en }, typeof datetimeFormats, typeof numberFormats, Locale, false> = createI18n({
  legacy: false,
  globalInjection: true,
  locale: detectLocale(null),
  fallbackLocale: 'en',
  messages: { fr, en },
  numberFormats,
  datetimeFormats,
})

/** Traduction hors composant (stores, scène 3D). */
export function t(key: string, named?: Record<string, unknown>): string {
  const fn = i18n.global.t as unknown as (k: string, n?: Record<string, unknown>) => string
  return named ? fn(key, named) : fn(key)
}
