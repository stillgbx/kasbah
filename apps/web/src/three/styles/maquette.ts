import { Color } from 'three'
import { dayFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixRgb, toPalette, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// MAQUETTE: the architect's white model. Cardboard, balsa and flocking, everything is almost white and
// almost matte, and it is the SHADOWS and the occlusion that draw the volumes — not the color, not
// the material. It is the most readable style in broad daylight (nothing saturates, nothing shines) and the
// only one that will never need assets: its finesse is the absence of detail. At night, the
// model stays set under a desk lamp, and its own lamps make warm spots.

const PALETTE: PaletteSpec = {
  wall: '#f2f0ea',
  wallInterior: '#f7f5f0',
  // the floors are a tone below the walls: on white, it is this tone that separates plan from elevation
  floor: '#d8d3c8',
  floors: { wood: '#d4c8b2', tile: '#dddcd6', carpet: '#d6d0c8', concrete: '#d5d2cb' },
  glass: '#cfe3ee',
  roof: '#e9e6df',
  // the base board: a foam-board gray-green, not a lawn
  terrain: '#cdd1c2',
  zones: {
    lawn: '#c3cdb2', pool: '#a9d7e6', driveway: '#d1cfc6', path: '#d9d5c8',
    bed: '#c9c1b1', terrace: '#ddd7c8', other: '#d0cdc3',
  },
  slat: '#f4f2ec',
  // the connected objects are the only dark pieces: they read against the white
  device: '#8c8c8c',
}

/** A cardboard grain: very faint relief, full roughness. */
const board = (texture: SurfaceLooks['wall']['texture'], relief = 0.25) => ({ texture, roughness: 0.9, relief })

const SURFACES: SurfaceLooks = {
  wall: board('plaster'),
  wallInterior: board('plaster'),
  floor: board('concrete', 0.2),
  floors: { wood: { texture: 'wood', roughness: 0.8, relief: 0.3 }, tile: board('tile', 0.2), carpet: board('carpet', 0.3), concrete: board('concrete', 0.2) },
  roof: board('plaster'),
  // the base board is SMOOTH cardboard: a lawn's grain, on a pale flat color, only adds noise
  terrain: board('plaster', 0.2),
  zones: {
    lawn: board('plaster', 0.2),
    // resin poured into a cardboard base: it does not move, and that is intended
    pool: { texture: 'water', roughness: 0.15, metalness: 0.1, relief: 0.5, flow: 0 },
    driveway: board('concrete', 0.2),
    path: board('pavers', 0.3),
    bed: board('soil', 0.3),
    terrace: board('pavers', 0.3),
    other: board('concrete', 0.2),
  },
}

// A STUDIO sky: neutral gray, no azure — the model is not outdoors, it is on a table.
const SKY_NIGHT = { zenith: [0.01, 0.012, 0.02], horizon: [0.04, 0.045, 0.06], ground: [0.02, 0.02, 0.025], sunGlare: 3, sunColor: [1, 0.98, 0.95] } as const
const SKY_DAY = { zenith: [0.55, 0.6, 0.7], horizon: [0.9, 0.9, 0.9], ground: [0.35, 0.35, 0.34], sunGlare: 6, sunColor: [1, 0.98, 0.95] } as const

export const maquetteStyle: RenderStyle = {
  id: 'maquette',
  labelKey: 'render.styles.maquette',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a)
    return {
      palette: toPalette(PALETTE),
      surfaces: SURFACES,
      glass: { opacity: 0.3, roughness: 0.1, metalness: 0, emissive: mix(0.25, 0, day) },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        horizon: mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day),
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: 1.1,
      },
      lighting: {
        // at night, the desk lamp: a white, frank source, not a blue moon
        sunColor: new Color(0xd8dce6).lerp(new Color(0xfff8ee), day),
        sunIntensity: mix(1.0, 2.2, day),
        hemiSky: new Color(0x9aa4b8).lerp(new Color(0xe8ecf2), day),
        hemiGround: new Color(0x3a3c44).lerp(new Color(0xa8a49c), day),
        hemiIntensity: 0.9,
        ambientIntensity: mix(0.25, 0.3, day),
        // SHARP, full shadows: on a white model, they are what draws
        shadowOpacity: 0.9,
      },
      post: {
        toneMapping: 'neutral',                          // white must stay white, not cream
        // a white at 0.95 burned out: walls and floors fell on the same value, no volume left
        exposure: mix(1.0, 0.72, day),
        bloom: { strength: mix(0.4, 0.05, day), radius: 0.5, threshold: 0.9 },
        // the occlusion is this style's pencil stroke: strong, at the scale of a room
        ao: { intensity: 1.4, radius: 0.5 },
        vignette: 0.15,
      },
      glow: { scale: mix(1.1, 0.8, day), opacity: mix(0.6, 0.15, day), lightIntensity: mix(9, 3, day), emissive: mix(1.8, 1, day) },
      // garden: architect's model: off-white foliage, balsa trunks, fruit blended into the foliage
      garden: { leaf: [new Color(0xf3f0ea), new Color(0xe9e5dd)], bark: new Color(0xd9c9ab), stone: new Color(0xe2dfd8), accent: new Color(0xefebe4) },
    }
  },
}
