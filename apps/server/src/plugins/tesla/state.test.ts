import { describe, expect, it } from 'vitest'
import {
  MONTHLY_CREDIT_USD, billableKind, countCall, currentCycle, cycleCostUsd, cycleKey, cycleStart, emptyState, teslaStateSchema,
} from './state'

// Ce que le plugin garde entre deux démarrages : le dernier état des véhicules, et la consommation
// du cycle de facturation. Le cycle suit le mois CALENDAIRE, comme la facturation du fabricant.

const SEPT = Date.UTC(2026, 8, 14, 10)
const OCT = Date.UTC(2026, 9, 1, 0, 5)

describe('cycle de facturation', () => {
  it('la clé est le mois calendaire, en UTC', () => {
    expect(cycleKey(SEPT)).toBe('2026-09')
    expect(cycleKey(OCT)).toBe('2026-10')
    expect(cycleKey(Date.UTC(2026, 11, 31, 23, 59))).toBe('2026-12')
  })

  it('un cycle neuf ne compte rien', () => {
    const s = emptyState()
    expect(currentCycle(s, SEPT)).toEqual({ month: '2026-09', data: 0, wakes: 0, commands: 0 })
    countCall(s, 'data', SEPT)
    expect(s.cycle).toMatchObject({ month: '2026-09', data: 1 })
  })

  it('le cycle commence le 1er du mois, pas le jour de la liaison du compte', () => {
    expect(cycleStart('2026-09')).toBe(Date.UTC(2026, 8, 1))
    expect(cycleStart(cycleKey(SEPT))).toBe(Date.UTC(2026, 8, 1))
    expect(cycleStart(cycleKey(OCT))).toBe(Date.UTC(2026, 9, 1))
  })

  it('le mois change : on repart de zéro, sans toucher au mois écoulé', () => {
    const s = emptyState()
    countCall(s, 'data', SEPT)
    countCall(s, 'wake', SEPT)
    expect(s.cycle).toMatchObject({ data: 1, wakes: 1 })
    countCall(s, 'data', OCT)
    expect(s.cycle).toEqual({ month: '2026-10', data: 1, wakes: 0, commands: 0 })
  })
})

describe('coût estimé', () => {
  it('les trois tarifs du fabricant : une lecture 0,2 ¢, un réveil 2 ¢, une commande 0,1 ¢', () => {
    const s = emptyState()
    for (let i = 0; i < 100; i++) countCall(s, 'data', SEPT)
    expect(cycleCostUsd(s.cycle)).toBeCloseTo(0.2, 3)
    countCall(s, 'wake', SEPT)
    expect(cycleCostUsd(s.cycle)).toBeCloseTo(0.22, 3)
    countCall(s, 'command', SEPT)
    expect(cycleCostUsd(s.cycle)).toBeCloseTo(0.221, 3)
  })

  it('un cycle vide ne coûte rien, et le crédit mensuel est celui du fabricant', () => {
    expect(cycleCostUsd(undefined)).toBe(0)
    expect(MONTHLY_CREDIT_USD).toBe(10)
    // 5000 lectures épuisent exactement le crédit : c'est l'ordre de grandeur à garder en tête
    const s = emptyState()
    s.cycle = { month: '2026-09', data: 5000, wakes: 0, commands: 0 }
    expect(cycleCostUsd(s.cycle)).toBe(MONTHLY_CREDIT_USD)
  })
})

describe('ce qui est facturable', () => {
  it('la LISTE des véhicules ne coûte rien : constaté sur la console du fabricant', () => {
    // 144 listes par jour ne laissaient que 3 requêtes « Données » dans sa facturation : le sondage
    // de la veille est gratuit, et c'est ce qui rend la cadence de dix minutes tenable
    expect(billableKind('/api/1/vehicles')).toBeNull()
    expect(billableKind('/api/1/vehicles?page=2')).toBeNull()
  })
  it('la lecture complète est facturée, et son chemin commence comme celui de la liste', () => {
    expect(billableKind('/api/1/vehicles/5YJ/vehicle_data?endpoints=charge_state')).toBe('data')
  })
  it('réveil et commandes ont leur propre tarif ; les routes partenaires ne touchent aucun véhicule', () => {
    expect(billableKind('/api/1/vehicles/5YJ/wake_up')).toBe('wake')
    expect(billableKind('/api/1/vehicles/5YJ/command/door_lock')).toBe('command')
    expect(billableKind('/api/1/partner_accounts')).toBeNull()
    expect(billableKind('/api/1/users/region')).toBeNull()
  })
})

describe('fichier d’état', () => {
  it('un fichier écrit par une version PRÉCÉDENTE se relit : les états de véhicule sont larges', () => {
    const parsed = teslaStateSchema.safeParse({
      cycle: { month: '2026-09', data: 3, since: SEPT },              // `wakes`/`commands` absents, `since` d'une version précédente
      vehicles: { '5YJ': { soc: 54, champInconnu: 'venu du futur' } },
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data!.cycle).toMatchObject({ wakes: 0, commands: 0 })
    expect(parsed.data!.vehicles['5YJ']).toMatchObject({ soc: 54 })
    expect(parsed.data!.paints).toEqual({})
  })
  it('un fichier avec paints se relit ; un fichier sans paints (ancienne version) repart avec un objet vide', () => {
    const withPaint = teslaStateSchema.safeParse({
      paints: { '5YJ': { color: '#285ac8', finish: 'matte' } },
    })
    expect(withPaint.success).toBe(true)
    expect(withPaint.data!.paints['5YJ']).toEqual({ color: '#285ac8', finish: 'matte' })
    expect(teslaStateSchema.safeParse({ vehicles: {} }).data!.paints).toEqual({})
  })
  it('un fichier vide ou d’une autre forme est rejeté proprement', () => {
    expect(teslaStateSchema.safeParse({}).success).toBe(true)          // ni cycle ni véhicule : état neuf
    expect(teslaStateSchema.safeParse({ vehicles: 'non' }).success).toBe(false)
  })
})
