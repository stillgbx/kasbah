import { config } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { createI18n } from 'vue-i18n'
import fr from '../src/i18n/locales/fr.json'
import en from '../src/i18n/locales/en.json'

// happy-dom ne fournit pas ResizeObserver ni matchMedia complets : stubs minimaux pour Vuetify.
class RO { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (RO as unknown as typeof ResizeObserver)
if (!globalThis.matchMedia) {
  globalThis.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof matchMedia
}
// Vuetify utilise visualViewport pour certains calculs
Object.defineProperty(globalThis, 'visualViewport', { value: globalThis.visualViewport ?? null, configurable: true })

export const vuetify = createVuetify({ components, directives })
export const i18n = createI18n({ legacy: false, locale: 'fr', fallbackLocale: 'en', messages: { fr, en } })

config.global.plugins = [vuetify, i18n]
