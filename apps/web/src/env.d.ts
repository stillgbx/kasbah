/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' → in-process simulation (no server), for tests and the static demo. */
  readonly VITE_INPROCESS_MOCK?: string
}

/** Build identifier (`vite.config.ts`); empty in dev. */
declare const __KASBAH_BUILD__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
