import type { Capability, CoverClass } from '@kasbah/shared'
import { SimError, type SimDevice } from '../types'
import { clamp, descriptor } from './common'

export interface CoverOptions { name: string; deviceClass: CoverClass; position?: number; tilt?: boolean; speedPctPerS?: number; preset?: number }

/**
 * Modèle annoncé pour chaque nature. Un vrai plugin lit ce que le fabricant déclare (`uiClass` chez
 * Overkiz) ; la simulation ne peut que le décider, mais elle le décide DEVICE PAR DEVICE, jamais
 * d'après le nom : un coffret de portail ne s'annonce pas « Roller shutter ».
 */
const MODELS: Record<CoverClass, string> = {
  shutter: 'Roller shutter', awning: 'Awning', blind: 'Venetian blind', curtain: 'Curtain rail',
  gate: 'Gate operator', garage: 'Garage door opener', window: 'Window opener',
}

/**
 * Ouvrant : se déplace vers une cible à vitesse constante (5 %/s par défaut), `stop` fige.
 *
 * `deviceClass` est OBLIGATOIRE, comme chez un vrai plugin : c'est elle qui voyage dans
 * `meta.cover.deviceClass` et décide du vocabulaire, de la forme dessinée et de l'état au repos
 * (`apps/web/src/lib/cover.ts`). Sans elle, toutes ces règles retomberaient sur le cas du volet et
 * seraient invérifiables en simulation.
 */
export function cover(externalId: string, o: CoverOptions): SimDevice<'cover'> {
  const caps: Capability[] = ['open_close', 'position', 'stop']
  if (o.tilt) caps.push('tilt')
  // position favorite mémorisée « dans le moteur » : la simulation la connaît, donc elle la montre,
  // et elle sait la réécrire — d'où les deux capacités, comme un moteur io-homecontrol
  if (o.preset !== undefined) caps.push('preset', 'preset_set')
  // la mémoire est MUTABLE : `cover.set_preset` la réécrit, et `cover.preset` suit la nouvelle valeur
  let preset = o.preset
  const speed = o.speedPctPerS ?? 5
  let target: number | null = null
  const dev: SimDevice<'cover'> = {
    descriptor: descriptor(externalId, 'cover', o.name, caps, {
      manufacturer: 'Mock', model: MODELS[o.deviceClass], cover: { deviceClass: o.deviceClass },
    }),
    state: {
      kind: 'cover', updatedAt: 0, available: true, position: o.position ?? 100, motion: 'stopped',
      ...(o.tilt ? { tilt: 50 } : {}), ...(preset !== undefined ? { presetPosition: preset } : {}),
    },
    // `position` est optionnelle dans le contrat (une radio unidirectionnelle ne la connaît pas),
    // mais la simulation la pose au démarrage et ne l'efface jamais : d'où les `!` ci-dessous.
    tick(ctx) {
      if (target === null) return
      const delta = target - dev.state.position!
      const step = speed * ctx.dtS
      if (Math.abs(delta) <= step) {
        dev.state.position = target
        dev.state.motion = 'stopped'
        target = null
      } else {
        dev.state.position = clamp(Math.round((dev.state.position! + Math.sign(delta) * step) * 100) / 100, 0, 100)
        dev.state.motion = delta > 0 ? 'opening' : 'closing'
      }
      if (dev.state.motion !== 'stopped') ctx.world.loadsW += 120
    },
    apply(cmd) {
      switch (cmd.type) {
        case 'cover.open': target = 100; break
        case 'cover.close': target = 0; break
        case 'cover.stop': target = null; dev.state.motion = 'stopped'; break
        case 'cover.set_position': target = cmd.position; break
        case 'cover.preset':
          if (preset === undefined) throw new SimError('UNSUPPORTED_COMMAND', 'no preset')
          target = preset
          break
        case 'cover.set_preset':
          if (preset === undefined) throw new SimError('UNSUPPORTED_COMMAND', 'no preset')
          // réécrire la mémoire ne DÉPLACE pas l'ouvrant : c'est un réglage, pas une manœuvre
          preset = cmd.position
          dev.state.presetPosition = cmd.position
          return
        case 'cover.set_tilt':
          if (!o.tilt) throw new SimError('UNSUPPORTED_COMMAND', 'no tilt')
          dev.state.tilt = cmd.tilt
          break
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on cover`)
      }
      if (target !== null && Math.abs(target - dev.state.position!) < 1e-9) { target = null; dev.state.motion = 'stopped' }
      else if (target !== null) dev.state.motion = target > dev.state.position! ? 'opening' : 'closing'
    },
  }
  return dev
}
