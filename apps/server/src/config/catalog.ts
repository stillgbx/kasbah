import type { NewPropertyBody, PropertiesResponse, PropertyMode } from '@kasbah/shared'
import {
  createLocalProperty, duplicateProperty, loadDemoProperties, loadLocalProperties, readModeState, writeModeState,
  type ModeState, type PropertyEntry,
} from './properties'

// The CATALOG of a server without an imposed house: the demos and the machine's real properties, a
// single one live at a time. Two MODES: in demo, you only see and choose the demos; in real, only
// the machine's properties. Each mode remembers its last property: switching from one to the other
// reopens that one. Nothing here rebuilds the server — `main.ts` does it with what it gets back.
//
// Ready for several real houses: you can already choose between them; what is missing for them to
// live together (a state and keys per property) is elsewhere.

export interface CatalogDeps {
  demos?: PropertyEntry[]
  locals?: PropertyEntry[]
  state?: ModeState
  /** Writes the mode and the remembered choices (default: `.state/property-mode.json`). */
  persist?: (s: ModeState) => Promise<void>
  /** Re-reads the machine's properties after a creation (default: `house/properties/`). */
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

  /** Opens the catalog: demos, the machine's properties, remembered choices (or those provided, for tests). */
  static async open(deps: CatalogDeps = {}): Promise<PropertyCatalog> {
    return new PropertyCatalog({
      ...deps,
      demos: deps.demos ?? (await loadDemoProperties()).map((d) => ({ ...d, demo: true })),
      locals: deps.locals ?? await loadLocalProperties(),
      state: deps.state ?? await readModeState(),
    })
  }

  /**
   * The mode shown. On first launch, the one where there is something real to show: a fresh
   * installation starts in demo, a machine that already has its properties starts at home.
   */
  get mode(): PropertyMode {
    const wanted = this.state.mode ?? (this.locals.length ? 'real' : 'demo')
    return wanted === 'real' && !this.locals.length ? 'demo' : wanted
  }

  private of(mode: PropertyMode): PropertyEntry[] { return mode === 'demo' ? this.demos : this.locals }
  private all(): PropertyEntry[] { return [...this.locals, ...this.demos] }

  /** The live property: the one remembered in the mode, otherwise the first of the mode. */
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

  /** Chooses a property, from either mode: its mode becomes the one shown. Returns the new active one. */
  async choose(id: string): Promise<PropertyEntry | null> {
    const entry = this.find(id)
    if (!entry) return null
    const mode: PropertyMode = entry.demo ? 'demo' : 'real'
    await this.save({ ...this.state, mode, [mode]: id })
    return entry
  }

  /** Switches to demo or real; `null` if real has no property yet. Returns the new active one. */
  async chooseMode(mode: PropertyMode): Promise<PropertyEntry | null> {
    if (!this.of(mode).length) return null
    await this.save({ ...this.state, mode })
    return this.active
  }

  /** Creates a real property; returns its id (choosing it is a separate `choose`). */
  async create(body: NewPropertyBody): Promise<string> {
    const id = await (this.deps.create ?? ((b, t) => createLocalProperty(b, t)))(body, this.all().map((p) => p.id))
    await this.refresh()
    return id
  }

  /** Real copy of a property (a demo, most often); returns the copy's id. */
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
