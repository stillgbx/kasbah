import { createSurfaceTextures, type SurfaceRole } from './procedural'

// Pour les tests de la scène 3D, importé pour son seul effet : cuit toutes les matières à l'import.
// Cuites à la demande, elles tombaient dans le premier test qui construit des matériaux : 1,4 s
// seul (12 rôles du style par défaut), 3 à 7 s sous la suite complète, au-delà du délai de 5 s
// d'un test, alors que l'import d'un fichier n'est pas chronométré.

/** Tous les rôles : `satisfies` fait échouer le typecheck si le catalogue gagne une matière. */
const ALL = {
  plaster: true, wood: true, tile: true, poolTile: true, carpet: true, concrete: true,
  grass: true, water: true, pavers: true, soil: true, roof: true,
  metal: true, grid: true, gloss: true, stone: true, gravel: true, siding: true,
} satisfies Record<SurfaceRole, true>

createSurfaceTextures(Object.keys(ALL) as SurfaceRole[])
