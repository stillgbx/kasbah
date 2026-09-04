import { createHttpTransport } from './httpTransport'
import { createMockTransport } from './mockTransport'
import type { Transport } from './transport'

export * from './transport'
export { createHttpTransport, createMockTransport }

let current: Transport | null = null

/** Transport de l'application : simulation in-process si VITE_INPROCESS_MOCK=1, sinon HTTP + WS. */
export function getTransport(): Transport {
  if (!current) current = import.meta.env.VITE_INPROCESS_MOCK === '1' ? createMockTransport({ timeScale: 30 }) : createHttpTransport()
  return current
}

/** Remplace le transport (tests). */
export function setTransport(t: Transport | null): void { current = t }
