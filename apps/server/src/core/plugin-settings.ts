import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pluginSettingsSchema, type PluginSettings } from '@kasbah/shared'
import type { Logger } from 'pino'

// Réglages PAR PLUGIN, décidés depuis l'UI et persistés côté serveur : le concept de scène est
// commun, les réglages ne le sont pas (on peut vouloir les palettes animées sur les lampes et pas
// sur un autre parc). Côté serveur et non dans la tablette parce qu'ils gouvernent une réaction du
// serveur (l'initialisation d'une ambiance qui apparaît) et doivent valoir pour toutes les tablettes.
// Un fichier JSON minuscule, écrit atomiquement ; absent = tout aux valeurs par défaut.

const DEFAULTS: PluginSettings = pluginSettingsSchema.parse({})

export class PluginSettingsStore {
  private byPlugin = new Map<string, PluginSettings>()

  constructor(private readonly path: string, private readonly logger?: Logger) {}

  async load(): Promise<void> {
    let raw: string
    try { raw = await readFile(this.path, 'utf8') }
    catch { return }                                    // pas encore de fichier : valeurs par défaut
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const [pluginId, value] of Object.entries(parsed)) {
        const check = pluginSettingsSchema.safeParse(value)
        if (check.success) this.byPlugin.set(pluginId, check.data)
        else this.logger?.warn({ pluginId, issues: check.error.issues }, 'plugin settings ignored')
      }
    } catch (err) {
      this.logger?.warn({ err, path: this.path }, 'unreadable plugin settings file, defaults used')
    }
  }

  get(pluginId: string): PluginSettings { return this.byPlugin.get(pluginId) ?? DEFAULTS }

  all(): Record<string, PluginSettings> {
    return Object.fromEntries(this.byPlugin)
  }

  async set(pluginId: string, settings: PluginSettings): Promise<PluginSettings> {
    this.byPlugin.set(pluginId, settings)
    const text = `${JSON.stringify(Object.fromEntries(this.byPlugin), null, 2)}\n`
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(`${this.path}.tmp`, text, 'utf8')
    await rename(`${this.path}.tmp`, this.path)
    return settings
  }
}
