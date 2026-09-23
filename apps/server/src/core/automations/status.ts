import type { Automation, AutomationStatus, Predicate } from '@kasbah/shared'
import type { SceneRegistry } from '../scene-registry'
import type { EvalContext } from './context'
import { isComparableField } from './evaluate'

// Santé d'une automatisation, telle que la montre la liste : ce qui lui MANQUE en ce moment (un
// plugin éteint retire ses appareils, une pièce peut disparaître de la maison, un champ peut ne pas
// exister pour ce kind) et ce qui ne RÉPOND pas. Rien n'est supprimé : l'appareil revient, la santé
// redevient bonne.

type Structural = Pick<AutomationStatus, 'health' | 'missing' | 'unavailableDeviceIds'>
type Missing = AutomationStatus['missing'][number]

export function computeStatus(a: Automation, ctx: EvalContext, scenes: Pick<SceneRegistry, 'get'>): Structural {
  const missing: Missing[] = []
  const unavailable = new Set<string>()
  const seen = new Set<string>()
  const add = (m: Missing) => { const k = `${m.kind}:${m.id}`; if (!seen.has(k)) { seen.add(k); missing.push(m) } }

  const device = (id: string) => {
    const e = ctx.device(id)
    if (!e) add({ kind: 'device', id })
    else if (!e.state.available) unavailable.add(id)
    return e
  }
  const room = (id: string) => { if (!ctx.index.roomsById.has(id)) add({ kind: 'room', id }) }

  const predicate = (p: Predicate): void => {
    switch (p.type) {
      case 'any': p.of.forEach(predicate); return
      case 'device': {
        const e = device(p.deviceId)
        if (e && !isComparableField(e, p.field)) add({ kind: 'field', id: `${p.deviceId}.${p.field}` })
        return
      }
      case 'deviceOn': case 'vehicleOnSite': device(p.deviceId); return
      case 'vehicleParkedAt':
        device(p.deviceId)
        if (!ctx.house.site.parkings.some((pk) => pk.id === p.parkingId)) add({ kind: 'parking', id: p.parkingId })
        return
      case 'anyInRoom': room(p.roomId); return
      default: return
    }
  }

  if (a.trigger.type === 'state') predicate(a.trigger.when)
  a.unless.forEach(predicate)
  for (const action of a.actions) {
    if (action.type === 'recallScene') {
      if (!scenes.get(action.sceneId)) add({ kind: 'scene', id: action.sceneId })
      continue
    }
    const t = action.target
    if (t.type === 'devices') { t.deviceIds.forEach(device); continue }
    t.roomIds?.forEach(room)
    t.levelIds?.forEach((id) => { if (!ctx.index.levelsById.has(id)) add({ kind: 'level', id }) })
    t.zoneIds?.forEach((id) => { if (!ctx.index.zonesById.has(id)) add({ kind: 'zone', id }) })
  }

  const unavailableDeviceIds = [...unavailable]
  const health = missing.length ? 'incomplete' : unavailableDeviceIds.length ? 'unavailable' : 'ok'
  return { health, missing, unavailableDeviceIds }
}
