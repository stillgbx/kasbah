import type { FetchLike } from '../../core/sse'
import { PluginError } from '../../core/plugin'
import { hueDiscoverySchema } from './types'

export const HUE_DISCOVERY_URL = 'https://discovery.meethue.com/'

/**
 * Bridge discovery through the Signify cloud service (limited to ~1 call / 15 min per IP):
 * pinning HUE_BRIDGE_HOST is then recommended. mDNS (_hue._tcp) will come later.
 */
export async function findBridge(fetchImpl: FetchLike): Promise<{ host: string; bridgeId: string }> {
  let res: Awaited<ReturnType<FetchLike>>
  try { res = await fetchImpl(HUE_DISCOVERY_URL) }
  catch (err) { throw new PluginError('UPSTREAM_ERROR', `Hue discovery failed (${(err as Error).message})`, { cause: err }) }
  if (res.status === 429) throw new PluginError('RATE_LIMITED', 'Hue discovery rate-limited: set HUE_BRIDGE_HOST')
  if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `Hue discovery HTTP ${res.status}`)
  const list = hueDiscoverySchema.parse(await res.json())
  const first = list[0]
  if (!first) throw new PluginError('UPSTREAM_ERROR', 'no Hue bridge found on this network (set HUE_BRIDGE_HOST)')
  return { host: first.internalipaddress, bridgeId: first.id }
}
