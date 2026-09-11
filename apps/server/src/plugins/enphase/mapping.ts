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
 *
 * RAMENÉE À ZÉRO quand elle passe sous zéro : la nuit, la pince de production lit quelques watts à
 * l'envers (−7 W relevés sur la vraie passerelle), le courant de veille des onduleurs qui remonte la
 * chaîne. Le contrat compte la production en positif ; « −7 W · Production » n'a pas de sens, et
 * cette veille est déjà comptée dans la consommation.
 */
export function productionW(report: ProductionReport): number {
  const entry = pick(report.production, 'eim', 'production') ?? pick(report.production, 'inverters')
  return Math.max(0, Math.round(entry?.wNow ?? 0))
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

/** Milliwatts → watts. `livedata` compte en mW, `production.json` en W. */
const mw = (v: number) => Math.round(v / 1000) || 0

/**
 * Instantané du site : production, consommation, réseau, batterie.
 *
 * La source est `livedata`, et c'est une décision de PERFORMANCE mesurée sur la vraie passerelle :
 * elle répond en 0,2 s, là où `production.json` a mis jusqu'à 10,8 s pour les mêmes compteurs. Ce
 * dernier sert de repli, pour une passerelle qui ne servirait pas `livedata`.
 *
 * Signes : `grid` est déjà celui du contrat, négatif en injection ; `storage` est l'INVERSE, le
 * fabricant le comptant positif en décharge.
 */
export function toSitePatch(live: Livedata | undefined, report?: ProductionReport): StatePatch {
  const m = live?.meters
  const total = report && pick(report.consumption, 'eim', 'total-consumption')
  const net = report && pick(report.consumption, 'eim', 'net-consumption')
  // `Math.max(0, …)` pour la même raison que dans `productionW` : la pince passe sous zéro la nuit
  const production = m?.pv ? Math.max(0, mw(m.pv.agg_p_mw)) : report ? productionW(report) : undefined
  const consumption = m?.load ? mw(m.load.agg_p_mw) : total ? Math.round(total.wNow) : undefined
  const grid = m?.grid ? mw(m.grid.agg_p_mw) : net ? Math.round(net.wNow) : undefined
  return {
    kind: 'energy',
    ...(production !== undefined ? { productionW: production } : {}),
    ...(consumption !== undefined ? { consumptionW: consumption } : {}),
    ...(grid !== undefined ? { gridW: grid } : {}),
    ...(m?.storage ? { batteryW: batteryW(m.storage.agg_p_mw) } : {}),
    ...(m?.enc_agg_soc !== undefined ? { batterySoc: Math.round(m.enc_agg_soc) } : {}),
  } as StatePatch
}

/**
 * Totaux du jour : seul `production.json` les porte, et il est lent — d'où sa relecture à la
 * cadence lente. `net-consumption` publie un `whToday` à zéro : c'est la consommation TOTALE qu'il
 * faut lire, sous peine d'afficher une journée sans consommation.
 */
export function toDailyPatch(report: ProductionReport): StatePatch {
  const eim = pick(report.production, 'eim', 'production')
  const total = pick(report.consumption, 'eim', 'total-consumption')
  return {
    kind: 'energy',
    ...(eim?.whToday !== undefined ? { todayProductionWh: Math.round(eim.whToday) } : {}),
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
