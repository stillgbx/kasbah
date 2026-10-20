import { createSurfaceTextures, type SurfaceRole } from './procedural'

// For the 3D scene tests, imported for its side effect only: bakes every material at import.
// Baked on demand, they landed in the first test that builds materials: 1.4 s
// alone (12 roles of the default style), 3 to 7 s under the full suite, beyond a test's 5 s
// timeout, whereas importing a file is not timed.

/** Every role: `satisfies` fails the typecheck if the catalog gains a material. */
const ALL = {
  plaster: true, wood: true, tile: true, poolTile: true, carpet: true, concrete: true,
  grass: true, water: true, pavers: true, soil: true, roof: true,
  metal: true, grid: true, gloss: true, stone: true, gravel: true, siding: true,
} satisfies Record<SurfaceRole, true>

createSurfaceTextures(Object.keys(ALL) as SurfaceRole[])
