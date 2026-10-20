import { Bonjour, type Browser, type Service, type ServiceConfig } from 'bonjour-service'
import type { Logger } from 'pino'
import { castTxtSchema, type CastService } from './types'

// Discovery of Cast receivers: they all announce `_googlecast._tcp` over mDNS, with their stable id,
// their Google Home name and their model in the TXT record. Nothing else to configure.

export interface CastDiscovery {
  /**
   * Starts listening; `onUp` is called on EVERY announcement, repeated ones included. The caller does
   * the comparing: an identical announcement says nothing new, but a changing address or name (DHCP
   * lease, rename in Google Home) must reach it, and a repeated announcement proves that a device we
   * thought was off is back.
   */
  start(onUp: (service: CastService) => void): void
  /** Sends a new mDNS query (devices switched back on, lost announcements). */
  refresh(): void
  stop(): void
}

/** Translates an mDNS service; `undefined` if its TXT does not have the expected shape (logged by the caller). */
export function toCastService(s: Pick<Service, 'txt' | 'addresses' | 'host' | 'port'>): CastService | undefined {
  const txt = castTxtSchema.safeParse(s.txt ?? {})
  if (!txt.success) return undefined
  // IPv4 first: Nest Hubs also announce global and link-local IPv6 addresses, useless here
  const host = s.addresses?.find((a) => a.includes('.')) ?? s.addresses?.[0] ?? s.host
  return { host, port: s.port, txt: txt.data }
}

/**
 * @param iface IPv4 of the interface to use for multicast. A machine with several network cards
 * (VPN, virtual machines) may send the mDNS query on the wrong one: without this option, the
 * announcement never comes back and the list stays empty.
 */
export function createMdnsDiscovery(opts: { iface?: string; logger: Logger }): CastDiscovery {
  let bonjour: Bonjour | null = null
  let browser: Browser | null = null
  let listener: ((service: CastService) => void) | null = null
  /** A failure already reported: the following attempts only repeat it at `debug`. */
  let failing = false

  function close(): void {
    browser?.stop()
    bonjour?.destroy()
    browser = null
    bonjour = null
  }

  function open(): void {
    const onUp = listener
    if (!onUp) return
    // the options go as is to multicast-dns, `interface` included: bonjour-service's typings do not know it
    const b = new Bonjour(opts.iface ? ({ interface: opts.iface } as unknown as Partial<ServiceConfig>) : undefined)
    // bonjour-service does NOT listen to its multicast socket's errors: without this listener, a
    // missing interface (`CAST_MDNS_INTERFACE` outside the local network: EADDRNOTAVAIL on bind)
    // raises an unhandled `error` that brings down the WHOLE server. We close, and the next `refresh`
    // retries.
    const mdns = (b as unknown as { server?: { mdns?: { on(ev: 'error', fn: (err: Error) => void): void } } }).server?.mdns
    mdns?.on('error', (err) => {
      if (bonjour !== b) return
      const log = { err: err.message, iface: opts.iface ?? null }
      if (failing) opts.logger.debug(log, 'mDNS still unavailable, Cast discovery paused')
      else opts.logger.warn(log, 'mDNS unavailable (network interface missing?), Cast discovery paused until it comes back')
      failing = true
      close()
    })
    bonjour = b
    browser = b.find({ type: 'googlecast' }, (s) => {
      failing = false
      const service = toCastService(s)
      if (!service) { opts.logger.warn({ name: s.name, txt: s.txt }, 'googlecast service with an unexpected TXT record ignored'); return }
      onUp(service)
    })
  }

  return {
    start(onUp) {
      listener = onUp
      open()
    },
    refresh() {
      if (browser) browser.update()
      else open()
    },
    stop() {
      listener = null
      close()
    },
  }
}
