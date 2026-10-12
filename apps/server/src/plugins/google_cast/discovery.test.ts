import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { createMdnsDiscovery } from './discovery'

// Hors du réseau local, l'interface mDNS configurée (`CAST_MDNS_INTERFACE`) n'existe plus : le bind
// échoue (EADDRNOTAVAIL) et bonjour-service, qui n'écoute pas les erreurs de son socket, laissait
// l'`error` remonter jusqu'au processus — tout le serveur tombait au démarrage. Vrai socket ici :
// 203.0.113.7 est une adresse réservée à la documentation, aucune machine ne la porte.

const settle = () => new Promise((r) => setTimeout(r, 300))

describe('google_cast — découverte mDNS sans l’interface configurée', () => {
  it('ne fait pas tomber le processus : un avertissement, une seule fois, et refresh réessaie sans planter', async () => {
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
