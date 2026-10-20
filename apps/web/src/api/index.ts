import { parseHouse } from '@kasbah/shared'
import { createHttpTransport } from './httpTransport'
import { createMockTransport } from './mockTransport'
import { activeDemoProperty, demoPropertiesResponse, rememberDemoProperty } from './demoProperties'
import type { Transport } from './transport'

export * from './transport'
export { createHttpTransport, createMockTransport }

let current: Transport | null = null

/**
 * Application transport: in-process simulation if VITE_INPROCESS_MOCK=1 (demo mode, on the
 * demo property remembered by this browser), otherwise HTTP + WS.
 */
export function getTransport(): Transport {
  if (!current) current = import.meta.env.VITE_INPROCESS_MOCK === '1' ? demoTransport() : createHttpTransport()
  return current
}

function demoTransport(): Transport {
  const p = activeDemoProperty()
  return createMockTransport({
    timeScale: 30, scenario: p.scenario, house: parseHouse(p.house),
    properties: { list: () => demoPropertiesResponse(activeDemoProperty().id), select: rememberDemoProperty },
  })
}

/** Replaces the transport (tests). */
export function setTransport(t: Transport | null): void { current = t }
