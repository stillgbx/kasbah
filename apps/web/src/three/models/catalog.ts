// The 3D car bodies shipped with the app. Pure data, no network access: the catalog says WHAT
// EXISTS, the loader fetches it. That indirection is what will let us move the files some day
// (plugin folder served by the server, CDN…) without touching either the scene or the UI.
//
// The `<pluginId>/<model>` identifier is ALSO the path under `public/models/`: a file
// is added by dropping the .glb in the right folder and adding a line here. The prefix serves
// for filtering — a vehicle's card only offers the car bodies of ITS plugin.

export interface CarModel {
  /** `<pluginId>/<model>`: identifier stored in the house AND path of the file. */
  id: string
  pluginId: string
  /**
   * Manufacturer, as plugins publish it in `meta.manufacturer`. It serves as a SECOND key:
   * the same car can be read by a plugin other than its brand's — the simulation
   * (`pluginId: 'mock'`) thus publishes a Tesla and a Renault, and a generic plugin would do it
   * too. Without this fallback, those vehicles would never have a car body.
   */
  brand: string
  /** Commercial name of the model. A proper name is not translated: no i18n key here. */
  label: string
  /** Dimensions of the file (m, house reference frame): width X, length Y, height Z. */
  size: readonly [number, number, number]
}

export const CAR_MODELS: readonly CarModel[] = [
  { id: 'renault/r5-e-tech', pluginId: 'renault', brand: 'Renault', label: 'R5 E-Tech', size: [2.05, 3.92, 1.59] },
  { id: 'tesla/model-s', pluginId: 'tesla', brand: 'Tesla', label: 'Model S', size: [2.32, 4.98, 1.52] },
]

/** Value of `model3d` that explicitly requests the generic silhouette rather than a car body. */
export const NO_MODEL = 'none'

/**
 * `base: './'` in the Vite configuration: URLs must stay RELATIVE so that the build
 * works as well served at the root by Fastify as from a subfolder.
 */
export const modelUrl = (id: string): string => `${import.meta.env.BASE_URL}models/${id}.glb`

export const modelById = (id: string): CarModel | undefined => CAR_MODELS.find((m) => m.id === id)

/**
 * What a vehicle's card offers: the car bodies of ITS plugin — you don't park a
 * Model S in an R5's garage — and, failing that, those of its brand, for the vehicle a
 * generic plugin publishes.
 */
export function modelsFor(pluginId: string | undefined, manufacturer?: string): readonly CarModel[] {
  const byPlugin = CAR_MODELS.filter((m) => m.pluginId === pluginId)
  if (byPlugin.length) return byPlugin
  const brand = manufacturer?.trim().toLowerCase()
  return brand ? CAR_MODELS.filter((m) => m.brand.toLowerCase() === brand) : []
}

/**
 * The car body to draw for a vehicle: its choice if it made one, otherwise the only one its
 * plugin (or its brand) brings — a brand plugin covers only one model today, and
 * the user will decide from its card the day there are two.
 *
 * `undefined` = generic silhouette, either because it is requested (`'none'`), or because
 * no car body matches.
 */
export function resolveModel(model3d: string | undefined, pluginId: string | undefined, manufacturer?: string): CarModel | undefined {
  if (model3d === NO_MODEL) return undefined
  if (model3d) return modelById(model3d)
  return modelsFor(pluginId, manufacturer)[0]
}
