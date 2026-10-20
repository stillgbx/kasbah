import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { createMdnsDiscovery } from './discovery'

// Outside the local network, the configured mDNS interface (`CAST_MDNS_INTERFACE`) no longer exists:
// the bind fails (EADDRNOTAVAIL) and bonjour-service, which does not listen to its socket's errors,
// let the `error` bubble up to the process — the whole server went down at startup. Real socket here:
// 203.0.113.7 is an address reserved for documentation, no machine carries it.

const settle = () => new Promise((r) => setTimeout(r, 300))

describe('google_cast — mDNS discovery without the configured interface', () => {
  it('does not bring the process down: one warning, only once, and refresh retries without crashing', async () => {
    const logger = pino({ level: 'silent' })
    const warn = vi.spyOn(logger, 'warn')
    const uncaught = vi.fn()
    process.on('uncaughtException', uncaught)
    const discovery = createMdnsDiscovery({ iface: '203.0.113.7', logger })
    try {
      discovery.start(() => {})
      await settle()
      discovery.refresh()
      await settle()
      expect(uncaught).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]![0]).toMatchObject({ iface: '203.0.113.7' })
    } finally {
      discovery.stop()
      process.off('uncaughtException', uncaught)
    }
  })
})
