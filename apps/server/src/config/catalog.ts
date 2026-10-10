import type { NewPropertyBody, PropertiesResponse, PropertyMode } from '@kasbah/shared'
import {
  createLocalProperty, duplicateProperty, loadDemoProperties, loadLocalProperties, readModeState, writeModeState,
  type ModeState, type PropertyEntry,
} from './properties'

// Le CATALOGUE d'un serveur sans maison imposée : les démonstrations et les propriétés réelles du
// poste, une seule vivante à la fois. Deux MODES : en démo, on ne voit et ne choisit que les démos ;
// en réel, que les propriétés du poste. Chaque mode retient sa dernière propriété : passer de l'un à
// l'autre rouvre celle-là. Rien ici ne reconstruit le serveur — `main.ts` le fait avec ce qu'on lui rend.
//
// Préparé pour plusieurs maisons réelles : on choisit déjà entre elles ; ce qui manque pour qu'elles
// vivent ensemble (un état et des clés par propriété) est ailleurs.

export interface CatalogDeps {
  demos?: PropertyEntry[]
  locals?: PropertyEntry[]
  state?: ModeState
  /** Écrit le mode et les choix retenus (défaut : `.state/property-mode.json`). */
  persist?: (s: ModeState) => Promise<void>
  /** Relit les propriétés du poste après une création (défaut : `house/properties/`). */
  reloadLocals?: () => Promise<PropertyEntry[]>
  create?: (body: NewPropertyBody, taken: string[]) => Promise<string>
  duplicate?: (source: PropertyEntry, name: string, taken: string[]) => Promise<string>
}

export class PropertyCatalog {
  private demos: PropertyEntry[]
  private locals: PropertyEntry[]
  private state: ModeState
  private readonly deps: CatalogDeps

  private constructor(deps: CatalogDeps) {
    this.deps = deps
    this.demos = deps.demos ?? []
    this.locals = deps.locals ?? []
    this.state = { ...deps.state }
  }

  /** Ouvre le catalogue : démos, propriétés du poste, choix retenus (ou ceux fournis, pour les tests). */
  static async open(deps: CatalogDeps = {}): Promise<PropertyCatalog> {
    return new PropertyCatalog({
      ...deps,
      demos: deps.demos ?? (await loadDemoProperties()).map((d) => ({ ...d, demo: true })),
      locals: deps.locals ?? await loadLocalProperties(),
      state: deps.state ?? await readModeState(),
    })
  }

  /**
   * Le mode montré. Au premier lancement, celui où il y a quelque chose de réel à montrer : une
   * installation neuve démarre en démo, un poste qui a déjà ses propriétés démarre chez lui.
   */
  get mode(): PropertyMode {
    const wanted = this.state.mode ?? (this.locals.length ? 'real' : 'demo')
    return wanted === 'real' && !this.locals.length ? 'demo' : wanted
  }

  private of(mode: PropertyMode): PropertyEntry[] { return mode === 'demo' ? this.demos : this.locals }
  private all(): PropertyEntry[] { return [...this.locals, ...this.demos] }

  /** La propriété qui vit : celle retenue dans le mode, sinon la première du mode. */
  get active(): PropertyEntry {
    const list = this.of(this.mode)
    return list.find((p) => p.id === this.state[this.mode]) ?? list[0]!
  }

  list(): PropertiesResponse {
    return {
      activeId: this.active.id, switchable: true, canCreate: true, mode: this.mode, realAvailable: this.locals.length > 0,
      properties: this.of(this.mode).map(({ id, name, kind, demo }) => ({ id, name, kind, ...(demo ? { demo: true } : {}) })),
    }
  }

  find(id: string): PropertyEntry | undefined { return this.all().find((p) => p.id === id) }

  /** Choisit une propriété, de l'un ou l'autre mode : son mode devient celui montré. Rend la nouvelle active. */
  async choose(id: string): Promise<PropertyEntry | null> {
    const entry = this.find(id)
    if (!entry) return null
    const mode: PropertyMode = entry.demo ? 'demo' : 'real'
    await this.save({ ...this.state, mode, [mode]: id })
    return entry
  }

  /** Passe en démo ou en réel ; `null` si le réel n'a encore aucune propriété. Rend la nouvelle active. */
  async chooseMode(mode: PropertyMode): Promise<PropertyEntry | null> {
    if (!this.of(mode).length) return null
    await this.save({ ...this.state, mode })
    return this.active
  }

  /** Crée une propriété réelle ; rend son id (la choisir est un `choose` à part). */
  async create(body: NewPropertyBody): Promise<string> {
    const id = await (this.deps.create ?? ((b, t) => createLocalProperty(b, t)))(body, this.all().map((p) => p.id))
    await this.refresh()
    return id
  }

  /** Copie réelle d'une propriété (une démo, le plus souvent) ; rend l'id de la copie. */
  async duplicate(id: string, name: string): Promise<string> {
    const source = this.find(id)
    if (!source) throw Object.assign(new Error(`unknown property "${id}"`), { statusCode: 404, code: 'NOT_FOUND' })
    const copy = await (this.deps.duplicate ?? ((s, n, t) => duplicateProperty(s, n, t)))(source, name, this.all().map((p) => p.id))
    await this.refresh()
    return copy
  }

  private async refresh(): Promise<void> { this.locals = await (this.deps.reloadLocals ?? (() => loadLocalProperties()))() }
  private async save(next: ModeState): Promise<void> {
    this.state = next
    await (this.deps.persist ?? writeModeState)(next)
  }
}
