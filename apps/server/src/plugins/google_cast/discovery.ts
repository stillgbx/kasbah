import { Bonjour, type Browser, type Service, type ServiceConfig } from 'bonjour-service'
import type { Logger } from 'pino'
import { castTxtSchema, type CastService } from './types'

// Découverte des récepteurs Cast : tous annoncent `_googlecast._tcp` en mDNS, avec leur identifiant
// stable, leur nom Google Home et leur modèle dans l'enregistrement TXT. Rien d'autre à configurer.

export interface CastDiscovery {
  /** Lance l'écoute ; `onUp` est appelé pour chaque appareil, une fois par identifiant. */
  start(onUp: (service: CastService) => void): void
  /** Relance une question mDNS (appareils rallumés, annonces perdues). */
  refresh(): void
  stop(): void
}

/** Traduit un service mDNS ; `undefined` si son TXT n'a pas la forme attendue (journalisé par l'appelant). */
export function toCastService(s: Pick<Service, 'txt' | 'addresses' | 'host' | 'port'>): CastService | undefined {
  const txt = castTxtSchema.safeParse(s.txt ?? {})
  if (!txt.success) return undefined
  // IPv4 d'abord : les Nest Hub annoncent aussi des IPv6 globales et de lien, inutiles ici
  const host = s.addresses?.find((a) => a.includes('.')) ?? s.addresses?.[0] ?? s.host
  return { host, port: s.port, txt: txt.data }
}

/**
 * @param iface IPv4 de l'interface à utiliser pour le multicast. Une machine à plusieurs cartes
 * (VPN, machines virtuelles) peut envoyer la question mDNS sur la mauvaise : sans cette option,
 * l'annonce ne revient jamais et la liste reste vide.
 */
export function createMdnsDiscovery(opts: { iface?: string; logger: Logger }): CastDiscovery {
  let bonjour: Bonjour | null = null
  let browser: Browser | null = null
  const seen = new Set<string>()
  return {
    start(onUp) {
      // les options vont telles quelles à multicast-dns, dont `interface` : le typage de bonjour-service ne la connaît pas
      bonjour = new Bonjour(opts.iface ? ({ interface: opts.iface } as unknown as Partial<ServiceConfig>) : undefined)
      browser = bonjour.find({ type: 'googlecast' }, (s) => {
        const service = toCastService(s)
        if (!service) { opts.logger.warn({ name: s.name, txt: s.txt }, 'googlecast service with an unexpected TXT record ignored'); return }
        if (seen.has(service.txt.id)) return
        seen.add(service.txt.id)
        onUp(service)
      })
    },
    refresh() { browser?.update() },
    stop() {
      browser?.stop()
      bonjour?.destroy()
      browser = null
      bonjour = null
    },
  }
}
