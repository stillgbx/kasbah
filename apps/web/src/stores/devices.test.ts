import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { ApiRequestError, createMockTransport, setTransport, type Transport } from '../api'
import { useDevicesStore } from './devices'
import { useNotificationsStore } from './notifications'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('devices store', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(null) })

  it('receives the snapshot and pushes states through the mock transport', async () => {
    const mock = createMockTransport({ seed: 1 })
    setTransport(mock)
    const store = useDevicesStore()
    store.start()
    expect(store.connection).toBe('online')
    expect(store.count).toBeGreaterThan(15)
    const before = store.states['mock:cover-living'] as StateFor<'cover'>
    expect(before).toMatchObject({ position: 100, motion: 'stopped' })
    const ok = await store.sendCommand('mock:cover-living', { type: 'cover.close' })
    expect(ok).toBe(true)
    // l'état optimiste puis réel remplace l'objet (nouvelle référence)
    const after = store.states['mock:cover-living'] as StateFor<'cover'>
    expect(after).not.toBe(before)
    expect(after.motion).toBe('closing')
    expect(store.isPending('mock:cover-living')).toBe(false)
    store.stop()
  })

  it('applies an optimistic patch and rolls back on failure with a notification', async () => {
    const mock = createMockTransport({ seed: 1 })
    const failing: Transport = { ...mock, sendCommand: vi.fn(async () => { throw new ApiRequestError(502, 'UPSTREAM_ERROR', 'boom') }) }
    setTransport(failing)
    const store = useDevicesStore()
    const notifications = useNotificationsStore()
    store.start()
    const before = store.states['mock:light-living'] as StateFor<'light'>
    expect(before.on).toBe(false)
    const p = store.sendCommand('mock:light-living', { type: 'light.set', on: true })
    expect((store.states['mock:light-living'] as StateFor<'light'>).on).toBe(true)   // optimiste
    expect(store.isPending('mock:light-living')).toBe(true)
    expect(await p).toBe(false)
    expect(store.states['mock:light-living']).toBe(before)                           // retour arrière
    expect(notifications.queue).toHaveLength(1)
    expect(notifications.queue[0]!.color).toBe('error')
    store.stop()
  })

  // ---- position visee d'un ouvrant ------------------------------------------------------------
  // Le besoin : une box qui ne publie la position qu'a la FIN de la course reemet l'ancienne
  // valeur pendant tout le mouvement. Le curseur doit rester sur la cible, et n'y renoncer que si
  // l'ouvrant s'arrete ailleurs.
  describe('cible dun ouvrant', () => {
    const ID = 'tahoma:v'
    const DESC: DeviceDescriptor = {
      id: ID, pluginId: 'tahoma', externalId: 'v', kind: 'cover', name: 'Volet',
      capabilities: ['open_close', 'position', 'stop'], meta: {},
    }
    const cover = (position: number, motion: StateFor<'cover'>['motion'], updatedAt = 1): StateFor<'cover'> =>
      ({ kind: 'cover', updatedAt, available: true, position, motion })

    /** Transport muet : c'est le test qui decide de CHAQUE etat, pas la simulation. */
    const seeded = (send: Transport['sendCommand'] = vi.fn(async () => {})) => {
      setTransport({ ...createMockTransport({ seed: 1 }), sendCommand: send })
      const store = useDevicesStore()
      store.setEntries([{ descriptor: DESC, state: cover(100, 'stopped') }])
      return store
    }
    const push = (store: ReturnType<typeof useDevicesStore>, state: StateFor<'cover'>) =>
      store.applyMessage({ type: 'state', deviceId: ID, state })

    it('pose la cible a la commande et la tient malgre une position perimee', async () => {
      const store = seeded()
      await store.sendCommand(ID, { type: 'cover.set_position', position: 40 })
      expect(store.targetPosition(ID)).toBe(40)
      push(store, cover(100, 'closing', 2))   // la box bouge sans publier de position
      expect(store.targetPosition(ID)).toBe(40)
    })

    it('abandonne la cible quand la position est atteinte', async () => {
      const store = seeded()
      await store.sendCommand(ID, { type: 'cover.close' })
      expect(store.targetPosition(ID)).toBe(0)
      push(store, cover(60, 'closing', 2))
      expect(store.targetPosition(ID)).toBe(0)
      push(store, cover(0, 'stopped', 3))
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    it('rend la main quand louvrant sarrete ailleurs (obstacle, stop, refus du moteur)', async () => {
      const store = seeded()
      await store.sendCommand(ID, { type: 'cover.close' })
      push(store, cover(80, 'closing', 2))    // le mouvement a bien demarre
      push(store, cover(55, 'stopped', 3))    // puis il sarrete a mi-chemin
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    it('un stopped recu AVANT le demarrage neffacé pas la cible', async () => {
      const store = seeded()
      await store.sendCommand(ID, { type: 'cover.close' })
      // trame typique dune box TaHoma : la cible arrive seule, le moteur na pas encore demarre
      push(store, cover(100, 'stopped', 2))
      expect(store.targetPosition(ID)).toBe(0)
    })

    it('viser la position deja atteinte ne pose aucune cible', async () => {
      const store = seeded()                       // volet ouvert (position 100)
      await store.sendCommand(ID, { type: 'cover.open' })
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    // Sequence rapportee par l'utilisateur : le curseur revenait a sa position d'AVANT le geste
    // avant de se poser sur la vraie. Le stop gele donc l'affichage jusqu'a la premiere trame.
    it('stop en pleine course : le curseur ne revient jamais en arriere', async () => {
      const store = seeded()
      // position de depart : 40 (soit 60 % de fermeture a l'ecran)
      push(store, cover(40, 'stopped', 1))
      expect(store.targetPosition(ID)).toBeUndefined()

      // on vise 70 (30 % de fermeture)
      await store.sendCommand(ID, { type: 'cover.set_position', position: 70 })
      expect(store.targetPosition(ID)).toBe(70)
      push(store, cover(40, 'closing', 2))       // la box bouge, sans publier de position
      expect(store.targetPosition(ID)).toBe(70)

      // stop : la valeur MONTREE (70) est gelee, pas remplacee par la position perimee (40)
      await store.sendCommand(ID, { type: 'cover.stop' })
      expect(store.targetPosition(ID)).toBe(70)

      // la premiere trame leve le gel, quoi qu'elle dise
      push(store, cover(53, 'stopped', 3))
      expect(store.targetPosition(ID)).toBeUndefined()
      expect((store.states[ID] as StateFor<'cover'>).position).toBe(53)
    })

    it('stop leve le gel meme si la trame dit encore que ca bouge', async () => {
      const store = seeded()
      await store.sendCommand(ID, { type: 'cover.close' })
      push(store, cover(80, 'closing', 2))
      await store.sendCommand(ID, { type: 'cover.stop' })
      push(store, cover(61, 'closing', 3))       // la box n'a pas encore dit `stopped`
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    // Signale par l'utilisateur : le curseur ne rejoignait la position perso qu'a la FIN de la
    // course. Le rappel vise la memoire du moteur comme n'importe quelle position.
    it('le rappel de la position perso pose la cible tout de suite', async () => {
      const store = seeded()
      push(store, { ...cover(100, 'stopped', 1), presetPosition: 35 })
      await store.sendCommand(ID, { type: 'cover.preset' })
      expect(store.targetPosition(ID)).toBe(35)
      push(store, { ...cover(100, 'closing', 2), presetPosition: 35 })   // position encore perimee
      expect(store.targetPosition(ID)).toBe(35)
      push(store, { ...cover(35, 'stopped', 3), presetPosition: 35 })
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    it('rappel sans valeur publiee : aucune cible a viser', async () => {
      const store = seeded()
      await store.sendCommand(ID, { type: 'cover.preset' })
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    it('une commande refusee efface la cible', async () => {
      const store = seeded(vi.fn(async () => { throw new ApiRequestError(502, 'UPSTREAM_ERROR', 'boom') }))
      expect(await store.sendCommand(ID, { type: 'cover.open' })).toBe(false)
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    it('perdre la disponibilite efface la cible', async () => {
      const store = seeded()
      await store.sendCommand(ID, { type: 'cover.close' })
      store.applyMessage({ type: 'availability', deviceIds: [ID], available: false })
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    it('une cible trop vieille est laissee tomber', async () => {
      vi.useFakeTimers()
      try {
        const store = seeded()
        await store.sendCommand(ID, { type: 'cover.close' })
        expect(store.targetPosition(ID)).toBe(0)
        vi.advanceTimersByTime(120_000)          // horloge du CLIENT, pas `updatedAt`
        push(store, cover(90, 'closing', 2))
        expect(store.targetPosition(ID)).toBeUndefined()
      } finally { vi.useRealTimers() }
    })
  })

  it('applies availability and full-state messages', async () => {
    const mock = createMockTransport({ seed: 1 })
    setTransport(mock)
    const store = useDevicesStore()
    store.start()
    store.applyMessage({ type: 'availability', deviceIds: ['mock:light-living', 'mock:light-kitchen'], available: false })
    expect(store.states['mock:light-living']!.available).toBe(false)
    const s = { ...store.states['mock:light-living']!, available: true, updatedAt: 5 }
    store.applyMessage({ type: 'state', deviceId: 'mock:light-living', state: s })
    expect(store.states['mock:light-living']).toBe(s)
    await flush()
    store.stop()
  })
})
