import type { GardenKind } from '@kasbah/shared'
import type { IconName } from './strokeIcons'

/** L'icône de chaque famille d'éléments du jardin (section du panneau de la maison, fiche). */
export const GARDEN_ICON: Record<GardenKind, IconName> = {
  broadleaf: 'treeBroadleaf', conifer: 'treeConifer', palm: 'treePalm', shrub: 'shrub', rock: 'rock', hedge: 'hedge',
}
