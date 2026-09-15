// Les carrosseries 3D livrées avec l'app. Pure donnée, aucun accès réseau : le catalogue dit CE
// QUI EXISTE, le chargeur va le chercher. C'est cette indirection qui permet de déplacer un jour
// les fichiers (dossier du plugin servi par le serveur, CDN…) sans toucher ni la scène ni l'UI.
//
// L'identifiant `<pluginId>/<modèle>` est AUSSI le chemin sous `public/models/` : un fichier
// s'ajoute en déposant le .glb dans le bon dossier et en ajoutant une ligne ici. Le préfixe sert
// au filtrage — la fiche d'un véhicule ne propose que les carrosseries de SON plugin.

export interface CarModel {
  /** `<pluginId>/<modèle>` : identifiant stocké dans la maison ET chemin du fichier. */
  id: string
  pluginId: string
  /**
   * Constructeur, tel que les plugins le publient dans `meta.manufacturer`. Il sert de SECONDE clé :
   * une même voiture peut être lue par un autre plugin que celui de sa marque — la simulation
   * (`pluginId: 'mock'`) publie ainsi une Tesla et une Renault, et un plugin générique le ferait
   * aussi. Sans ce repli, ces véhicules-là n'auraient jamais de carrosserie.
   */
  brand: string
  /** Nom commercial du modèle. Un nom propre ne se traduit pas : pas de clé i18n ici. */
  label: string
  /** Cotes du fichier (m, repère maison) : largeur X, longueur Y, hauteur Z. */
  size: readonly [number, number, number]
}

export const CAR_MODELS: readonly CarModel[] = [
  { id: 'renault/r5-e-tech', pluginId: 'renault', brand: 'Renault', label: 'R5 E-Tech', size: [2.05, 3.92, 1.59] },
  { id: 'tesla/model-s', pluginId: 'tesla', brand: 'Tesla', label: 'Model S', size: [2.32, 4.98, 1.52] },
]

/** Valeur de `model3d` qui demande explicitement la silhouette générique plutôt qu'une carrosserie. */
export const NO_MODEL = 'none'

/**
 * `base: './'` dans la configuration Vite : les URL doivent rester RELATIVES pour que le build
 * fonctionne aussi bien servi à la racine par Fastify que depuis un sous-dossier.
 */
export const modelUrl = (id: string): string => `${import.meta.env.BASE_URL}models/${id}.glb`

export const modelById = (id: string): CarModel | undefined => CAR_MODELS.find((m) => m.id === id)

/**
 * Ce que la fiche d'un véhicule propose : les carrosseries de SON plugin — on ne gare pas une
 * Model S dans le garage d'une R5 — et, à défaut, celles de sa marque, pour le véhicule qu'un
 * plugin générique publie.
 */
export function modelsFor(pluginId: string | undefined, manufacturer?: string): readonly CarModel[] {
  const byPlugin = CAR_MODELS.filter((m) => m.pluginId === pluginId)
  if (byPlugin.length) return byPlugin
  const brand = manufacturer?.trim().toLowerCase()
  return brand ? CAR_MODELS.filter((m) => m.brand.toLowerCase() === brand) : []
}

/**
 * La carrosserie à dessiner pour un véhicule : son choix s'il en a fait un, sinon la seule que son
 * plugin (ou sa marque) apporte — un plugin de marque ne couvre aujourd'hui qu'un modèle, et
 * l'utilisateur tranchera depuis sa fiche le jour où il y en aura deux.
 *
 * `undefined` = silhouette générique, soit parce qu'elle est demandée (`'none'`), soit parce
 * qu'aucune carrosserie ne correspond.
 */
export function resolveModel(model3d: string | undefined, pluginId: string | undefined, manufacturer?: string): CarModel | undefined {
  if (model3d === NO_MODEL) return undefined
  if (model3d) return modelById(model3d)
  return modelsFor(pluginId, manufacturer)[0]
}
