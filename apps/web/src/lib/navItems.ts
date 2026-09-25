import type { IconName } from './strokeIcons'
import type { LocalPluginId } from '../stores/localPlugins'

// Les vues du rail, dans leur ordre d'affichage. Hors du composant parce que la recherche de la vue
// Maison y emmène aussi (taper « météo » ouvre la page Météo) : une seule liste, deux lectures.

/** `local` : l'entrée n'existe que sur le poste où ce plugin local est activé (voir `stores/localPlugins`). */
export interface NavItem { name: string; icon: IconName; label: string; local?: LocalPluginId }

export const NAV_ITEMS: NavItem[] = [
  { name: 'home', icon: 'home', label: 'nav.home' },
  // la météo juste après la maison : ce qu'on regarde en arrivant, avant de piloter quoi que ce soit
  { name: 'weather', icon: 'cloudSun', label: 'nav.weather' },
  // musique juste après la météo : on lance un titre, on voit l'enceinte dans la 3D
  { name: 'music', icon: 'music', label: 'nav.music' },
  { name: 'lights', icon: 'light', label: 'nav.lights' },
  { name: 'covers', icon: 'shutter', label: 'nav.covers' },
  { name: 'media', icon: 'cast', label: 'nav.media' },
  { name: 'cameras', icon: 'camera', label: 'nav.cameras' },
  { name: 'energy', icon: 'bolt', label: 'nav.energy' },
  // équipement technique de la maison, comme l'énergie — pas un média, pas un véhicule
  { name: 'water', icon: 'droplet', label: 'nav.water' },
  // le chauffage suit l'eau : deux installations techniques qu'on consulte, voisines dans la tête
  // comme dans la chaufferie
  { name: 'heating', icon: 'radiator', label: 'nav.heating' },
  { name: 'vehicles', icon: 'vehicle', label: 'nav.vehicles' },
  { name: 'robots', icon: 'mower', label: 'nav.robots' },
  // les animaux après les robots : deux familles d'appareils qui vivent leur vie dans la maison et
  // qu'on vient consulter, pas piloter au quotidien
  { name: 'pets', icon: 'paw', label: 'nav.pets' },
  // le TENS est personnel et n'apparaît que sur le poste qui l'a activé ; il vient avant les
  // automatisations, qui ne peuvent justement pas le toucher
  { name: 'tens', icon: 'pulse', label: 'nav.tens', local: 'tens' },
  // ce que la maison fait TOUTE SEULE vient en dernier, juste avant les Réglages : on le règle et on
  // vient le vérifier, on ne le pilote pas au quotidien
  { name: 'automations', icon: 'automation', label: 'nav.automations' },
  { name: 'settings', icon: 'gear', label: 'nav.settings' },
]

/** Les entrées visibles sur ce poste : les plugins locaux non activés n'y figurent pas. */
export const visibleNavItems = (isEnabled: (id: LocalPluginId) => boolean) => NAV_ITEMS.filter((it) => !it.local || isEnabled(it.local))
