import type { Capability, DeviceDescriptor, StatePatch } from '@kasbah/shared'
import {
  ENCHARGE, type EnsembleDevice, type EnsemblePower, type Inverter, type Livedata, type ProductionEntry, type ProductionReport,
} from './types'

// Passerelle IQ → contrat Kasbah. Fonctions PURES, testées sur des réponses capturées.
//
// Trois sortes d'appareils, décidées par ce que l'installation contient vraiment :
//   - UN site `energy` : production, consommation, réseau, et le stockage d'ensemble s'il y a des
//     batteries. C'est lui que la vue Énergie montre ;
//   - UN `sensor` de puissance par micro-onduleur, donc un par panneau : c'est ce que les champs de
//     panneaux de house.json lient, et ce qui colore chaque module dans la scène 3D ;
//   - UN `energy` par batterie IQ, avec la seule capacité `storage` : l'UI leur donne déjà l'icône
//     batterie (`strokeIcons.ts`), et chacune se place dans une pièce.
//
// La borne IQ EV Charger 2 n'est PAS ici : elle ne parle qu'au cloud Enphase.

export const PLUGIN_ID = 'enphase'
/** Identifiant du site : un seul par passerelle, nom stable pour que house.json puisse le lier. */
export const SITE_ID = 'site'

const id = (externalId: string) => `${PLUGIN_ID}:${externalId}`
/** Un numéro de série entier est illisible dans une liste : on garde la fin, qui suffit à distinguer. */
const shortSerial = (serial: string) => serial.slice(-6)

function descriptor(externalId: string, kind: DeviceDescriptor['kind'], name: string, capabilities: Capability[], meta: DeviceDescriptor['meta'] = {}): DeviceDescriptor {
  return { id: id(externalId), pluginId: PLUGIN_ID, externalId, kind, name, capabilities, meta }
}

/** Entrée de mesure d'une famille, par `type` puis par `measurementType`. */
function pick(entries: ProductionEntry[], type: string, measurementType?: string): ProductionEntry | undefined {
  return entries.find((e) => e.type === type && (measurementType === undefined || e.measurementType === measurementType))
}

/**
 * Puissance produite : le CT (`eim`) quand il est là, car il mesure en TEMPS RÉEL. La somme des
 * onduleurs (`inverters`) traîne de plusieurs minutes — 4952 W contre 6456 W sur la capture — et ne
 * sert donc que de repli, pour une passerelle sans compteur.
 */
export function productionW(report: ProductionReport): number {
  const entry = pick(report.production, 'eim', 'production') ?? pick(report.production, 'inverters')
  return Math.round(entry?.wNow ?? 0)
}

/** Batteries IQ de l'inventaire (familles autres que `ENCHARGE` ignorées : Enpower, relais…). */
export function batteriesOf(inventory: { type: string; devices: EnsembleDevice[] }[]): EnsembleDevice[] {
  return inventory.filter((g) => g.type === ENCHARGE).flatMap((g) => g.devices)
}

/** Puissance d'une batterie en watts, SIGNE DU CONTRAT (positif = charge). */
function batteryW(realPowerMw: number): number {
  // le fabricant compte POSITIF en décharge : le bilan `load = pv + storage + grid` ne se ferme
  // qu'avec cette convention, verifiée au milliwatt sur la vraie passerelle et sur l'exemple de sa
  // note technique. Le contrat Kasbah, lui, veut positif = charge.
  // `|| 0` : sans lui une puissance nulle devient `-0`, qui traverse le JSON en `0` mais ne s'y
  // compare pas de la même façon selon l'outil. Une batterie au repos vaut 0, pas moins que rien.
  return Math.round(-realPowerMw / 1000) || 0
}

export interface Inventory {
  report: ProductionReport
  inverters: Inverter[]
  batteries: EnsembleDevice[]
}

/** Les descripteurs que le plugin publie, d'après ce que l'installation contient. */
export function toDescriptors(inv: Inventory): DeviceDescriptor[] {
  const hasStorage = inv.batteries.length > 0
  const site = descriptor(
    SITE_ID, 'energy', 'Installation solaire',
    ['production', 'consumption', 'grid', ...(hasStorage ? (['storage'] as const) : [])],
    { manufacturer: 'Enphase', model: 'IQ Gateway' },
  )
  const panels = inv.inverters.map((i) => descriptor(
    i.serialNumber, 'sensor', `Onduleur ${shortSerial(i.serialNumber)}`, ['measure'],
    { manufacturer: 'Enphase', sensor: { unit: 'W', deviceClass: 'power', precision: 0 } },
  ))
  const batteries = inv.batteries.map((b) => descriptor(
    b.serial_num, 'energy', `Batterie ${shortSerial(b.serial_num)}`, ['storage'],
    { manufacturer: 'Enphase', ...(b.part_num ? { model: b.part_num } : {}) },
  ))
  return [site, ...panels, ...batteries]
}

/**
 * État du site. La production, la consommation et le réseau viennent des compteurs
 * (`production.json`) ; la batterie vient de `livedata`, seule route à la donner. `net-consumption`
 * est déjà au signe du contrat : positif en soutirage, négatif en injection.
 */
export function toSitePatch(report: ProductionReport, live: Livedata | undefined): StatePatch {
  const total = pick(report.consumption, 'eim', 'total-consumption')
  const net = pick(report.consumption, 'eim', 'net-consumption')
  const eim = pick(report.production, 'eim', 'production')
  const storage = live?.meters?.storage
  const soc = live?.meters?.enc_agg_soc
  return {
    kind: 'energy',
    productionW: productionW(report),
    consumptionW: Math.round(total?.wNow ?? 0),
    gridW: Math.round(net?.wNow ?? 0),
    ...(storage ? { batteryW: batteryW(storage.agg_p_mw) } : {}),
    ...(soc !== undefined ? { batterySoc: Math.round(soc) } : {}),
    ...(eim?.whToday !== undefined ? { todayProductionWh: Math.round(eim.whToday) } : {}),
    // `net-consumption` publie un `whToday` a 0 : c'est la consommation TOTALE qu'il faut lire
    ...(total?.whToday !== undefined ? { todayConsumptionWh: Math.round(total.whToday) } : {}),
  } as StatePatch
}

/**
 * Au-delà, un onduleur est considéré muet. Ils rapportent toutes les ~5 min ; la nuit ils se
 * taisent, et une demi-heure sans rapport est donc la nuit tombée ou une vraie panne.
 */
export const PANEL_STALE_MS = 30 * 60_000

/** État d'un panneau : la puissance de son dernier rapport, telle quelle. */
export function toPanelPatch(inverter: Inverter): StatePatch {
  return { kind: 'sensor', value: Math.round(inverter.lastReportWatts) } as StatePatch
}

/**
 * Vrai si l'onduleur n'a plus rapporté depuis `PANEL_STALE_MS`. Il devient alors INDISPONIBLE et
 * garde sa dernière valeur, grisée : inventer un zéro serait affirmer une mesure qu'on n'a pas.
 */
export function isPanelStale(inverter: Inverter, now: number, staleAfterMs = PANEL_STALE_MS): boolean {
  return now - inverter.lastReportDate * 1000 > staleAfterMs
}

/**
 * État d'une batterie : sa charge et sa puissance. `percentFull` de l'inventaire et `soc` de
 * `/ivp/ensemble/power` disent la même chose ; on prend l'inventaire, qui porte aussi la température.
 * Les trois autres champs de l'état `energy` sont à zéro : une batterie ne produit ni ne soutire.
 */
export function toBatteryPatch(battery: EnsembleDevice, power: EnsemblePower | undefined): StatePatch {
  const entry = power?.['devices:']?.find((d) => d.serial_num === battery.serial_num)
  const soc = battery.percentFull ?? entry?.soc
  return {
    kind: 'energy',
    productionW: 0,
    consumptionW: 0,
    gridW: 0,
    ...(entry ? { batteryW: batteryW(entry.real_power_mw) } : {}),
    ...(soc !== undefined ? { batterySoc: Math.round(soc) } : {}),
  } as StatePatch
}

/** Une batterie qui ne communique plus garde ses dernières valeurs, grisées côté UI. */
export function isBatteryAvailable(battery: EnsembleDevice): boolean {
  return battery.communicating !== false
}
