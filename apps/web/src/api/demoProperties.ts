import type { PropertiesResponse, PropertyKind } from '@kasbah/shared'
import type { ScenarioName } from '@kasbah/mock-sim'
import tilleuls from '../../../../house/demos/tilleuls.json'
import embruns from '../../../../house/demos/embruns.json'
import belvedere from '../../../../house/demos/belvedere.json'

// Les trois propriétés de démonstration (`house/demos/`), pour le mode démo sans serveur
// (VITE_INPROCESS_MOCK=1). Chaque maison dit elle-même quel parc simulé la peuple
// (`meta.demo.scenario`) : le serveur lit le même champ, il n'y a qu'une source.

export interface DemoProperty {
  id: string
  name: string
  kind: PropertyKind
  scenario: ScenarioName
  /** Le JSON brut de la maison, tel que le fichier le porte (parsé à l'usage). */
  house: unknown
}

interface DemoMeta { meta: { demo: { scenario: string; kind: PropertyKind } } }
const property = (raw: { id: string; name: string } & DemoMeta): DemoProperty =>
  ({ id: raw.id, name: raw.name, kind: raw.meta.demo.kind, scenario: raw.meta.demo.scenario as ScenarioName, house: raw })

export const DEMO_PROPERTIES: readonly DemoProperty[] = [property(tilleuls as never), property(embruns as never), property(belvedere as never)]

const KEY = 'kasbah.demoProperty'

/** La propriété démo retenue par CE navigateur ; la première si rien n'est retenu (ou si le stockage manque). */
export function activeDemoProperty(): DemoProperty {
  let id: string | null = null
  try { id = localStorage.getItem(KEY) } catch { /* stockage indisponible : la première */ }
  return DEMO_PROPERTIES.find((p) => p.id === id) ?? DEMO_PROPERTIES[0]!
}

export function rememberDemoProperty(id: string): void {
  try { localStorage.setItem(KEY, id) } catch { /* le choix ne survivra pas au rechargement */ }
}

export function demoPropertiesResponse(activeId: string): PropertiesResponse {
  return { activeId, switchable: true, properties: DEMO_PROPERTIES.map(({ id, name, kind }) => ({ id, name, kind })) }
}
