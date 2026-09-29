import type { GardenKind } from '@kasbah/shared'
import type { IconName } from './strokeIcons'

/** L'icône de chaque famille d'éléments du jardin (section du panneau de la maison, fiche). */
export const GARDEN_ICON: Record<GardenKind, IconName> = {
  broadleaf: 'treeBroadleaf', fruit: 'treeFruit', conifer: 'treeConifer', palm: 'treePalm', bamboo: 'bamboo', shrub: 'shrub', rock: 'rock', hedge: 'hedge',
}
