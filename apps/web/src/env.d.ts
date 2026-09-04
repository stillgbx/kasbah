/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' → simulation in-process (aucun serveur), pour les tests et la démo statique. */
  readonly VITE_INPROCESS_MOCK?: string
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
