import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'

// Requests to an address someone else chose (a calendar feed, a cover, an OAuth client's document).
// The server sits inside the house: given `http://192.168.1.1/` or `http://127.0.0.1:8787/…`, it
// would fetch the router, the NAS or its own local-network-only routes for whoever chose the address.
// `publicFetch` only connects to a public address: a literal host is checked, a name is checked
// where it is resolved (the connector's `lookup`, so a name re-resolved between check and connection
// changes nothing), and each redirect is followed by hand to be checked the same way.

const blocked = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked.addSubnet(net, prefix, 'ipv6')

/** Is `ip` an address of the Internet: not the machine, the local network, link-local or multicast? */
export function isPublicIp(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1]
  if (mapped) return isPublicIp(mapped)
  const family = isIP(ip)
  return family !== 0 && !blocked.check(ip, family === 6 ? 'ipv6' : 'ipv4')
}

export class NotPublicError extends Error {
  readonly code = 'NOT_PUBLIC_ADDRESS'
}

/** `dns.lookup` keeping public addresses only, for the `all` form as for the single one. */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, found) => {
    const addresses = (found as LookupAddress[] | undefined)?.filter((a) => isPublicIp(a.address)) ?? []
    const refused = err ?? (addresses.length ? null : new NotPublicError(`${hostname} is not a public address`))
    if (refused) return (callback as (e: Error) => void)(refused)
    if ((options as { all?: boolean }).all) return (callback as (e: null, a: LookupAddress[]) => void)(null, addresses)
    callback(null, addresses[0]!.address, addresses[0]!.family)
  })
}

const dispatcher = new Agent({ connect: { lookup: publicLookup } })
const MAX_REDIRECTS = 5

/** `fetch` that only reaches public addresses, redirects included. `redirect: 'error'` refuses them. */
export async function publicFetch(url: string, init: { signal?: AbortSignal; headers?: Record<string, string>; redirect?: 'follow' | 'error' } = {}) {
  let current = url
  for (let hop = 0; ; hop++) {
    const { hostname } = new URL(current)
    const literal = hostname.replace(/^\[|\]$/g, '')
    if (isIP(literal) && !isPublicIp(literal)) throw new NotPublicError(`${literal} is not a public address`)
    const res = await undiciFetch(current, { ...init, redirect: 'manual', dispatcher })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!location) return res
    if (init.redirect === 'error' || hop >= MAX_REDIRECTS) throw new Error(`redirect refused (${res.status})`)
    current = new URL(location, current).href
  }
}
