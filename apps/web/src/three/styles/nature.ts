import { Color } from 'three'
import { dayFactor, duskFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixRgb, toPalette, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// NATURE : bois, pierre et verdure, lumière chaude, matières mates. Le contraire du réaliste sur un
// point précis — ici rien ne brille. Pas de métal, pas d'eau miroir, une occlusion marquée qui pose
// les volumes, et une vignette douce. La maison a l'air d'être en matériaux, pas en rendu.

const PALETTE: PaletteSpec = {
  wall: '#d9cdb8',
  wallInterior: '#e6dcc9',
  floor: '#c2ab8c',
  floors: { wood: '#b07d4c', tile: '#cbc3b1', carpet: '#b8a58e', concrete: '#bdb5a6' },
  glass: '#b6cfc4',
  roof: '#7a6a55',
  terrain: '#6d8f4e',
  zones: {
    lawn: '#6d8f4e', pool: '#3f8f8a', driveway: '#a99c88', path: '#b9a98f',
    bed: '#5a4530', terrace: '#b9a186', other: '#a89e8c',
  },
  slat: '#c4b49a',
  device: '#7b7466',
}

const SURFACES: SurfaceLooks = {
  wall: { texture: 'stone', roughness: 1 },
  wallInterior: { texture: 'plaster', roughness: 1 },
  floor: { texture: 'wood', roughness: 0.75 },
  floors: {
    wood: { texture: 'wood', roughness: 0.7 },
    tile: { texture: 'stone', roughness: 0.85 },
    carpet: { texture: 'carpet', roughness: 1 },
    concrete: { texture: 'stone', roughness: 0.95 },
  },
  roof: { texture: 'stone', roughness: 1 },
  terrain: { texture: 'grass', roughness: 1 },
  zones: {
    lawn: { texture: 'grass', roughness: 1 },
    pool: { texture: 'water', roughness: 0.2, metalness: 0.15 },
    driveway: { texture: 'pavers', roughness: 0.95 },
    path: { texture: 'pavers', roughness: 0.95 },
    bed: { texture: 'soil', roughness: 1 },
    terrace: { texture: 'wood', roughness: 0.85 },
    other: { texture: 'soil', roughness: 1 },
  },
}

const SKY_NIGHT = { zenith: [0.01, 0.014, 0.02], horizon: [0.05, 0.055, 0.05], ground: [0.006, 0.007, 0.005], sunGlare: 2, sunColor: [0.8, 0.85, 1] } as const
const SKY_DAY = { zenith: [0.2, 0.34, 0.58], horizon: [0.85, 0.86, 0.8], ground: [0.12, 0.13, 0.09], sunGlare: 12, sunColor: [1, 0.92, 0.78] } as const

export const natureStyle: RenderStyle = {
  id: 'nature',
  labelKey: 'render.styles.nature',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a)
    const dusk = duskFactor(a)
    const clear = 1 - a.cloudiness
    return {
      palette: toPalette(PALETTE),
      surfaces: SURFACES,
      glass: { opacity: 0.32, roughness: 0.2, metalness: 0, emissive: 0 },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        horizon: mixRgb(mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day), [0.9, 0.55, 0.28], dusk * 0.6 * clear),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day) * clear,
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: mix(1, 1.15, day),
      },
      lighting: {
        sunColor: new Color(0xa8bcd8).lerp(new Color(0xffeccd), day).lerp(new Color(0xffa860), dusk * 0.8 * clear),
        sunIntensity: mix(0.3, 2.6, day) * mix(0.4, 1, clear),
        hemiSky: new Color(0x33415a).lerp(new Color(0xd3e3f6), day),
        hemiGround: new Color(0x141810).lerp(new Color(0x6f7a46), day),
        hemiIntensity: mix(0.35, 1, day) * mix(1.5, 1, clear),
        ambientIntensity: mix(0.04, 0.2, day),
        shadowOpacity: mix(0.3, 1, day) * clear,
      },
      post: {
        toneMapping: 'agx',                              // plus doux qu'ACES : il ne sature pas les verts
        exposure: mix(1.5, 1.05, day),
        bloom: { strength: mix(0.5, 0.12, day), radius: 0.5, threshold: mix(0.8, 1.1, day) },
        ao: { intensity: mix(1.2, 1.1, day), radius: 0.45 },
        vignette: mix(0.4, 0.22, day),
      },
      glow: { scale: mix(1.2, 0.85, day), opacity: mix(0.7, 0.2, day), lightIntensity: mix(13, 5, day), emissive: mix(1.9, 1.1, day) },
    }
  },
}
