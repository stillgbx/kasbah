import type { GardenKind } from '@kasbah/shared'
import type { IconName } from './strokeIcons'

/** The icon of each family of garden elements (house panel section, sheet). */
export const GARDEN_ICON: Record<GardenKind, IconName> = {
  broadleaf: 'treeBroadleaf', fruit: 'treeFruit', conifer: 'treeConifer', palm: 'treePalm', bamboo: 'bamboo', shrub: 'shrub', rock: 'rock', hedge: 'hedge',
}
