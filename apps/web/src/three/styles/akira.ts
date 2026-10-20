import { Color } from 'three'
import { dayFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixPalette, mixRgb, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// AKIRA: Neo-Tokyo 2019. Blue-gray concrete and wet asphalt that reflects the sky, and a single
// color that matters: Kaneda's red — windows, paths and interior partitions emit it. The
// cyan of the pool and the moon as a counterpoint, as in the film. At night, the horizon glows red
// (a burning city); by day, a milky smog sky where the red remains the only vivid spot.
// The image is that of an '80s cel: crushed blacks, pushed colors, big halo.
// Kaneda's bike circles the house, its tail light trailing (`StyleLook.parade`).

const NIGHT: PaletteSpec = {
  wall: '#6e7888',
  wallInterior: '#6a2220',
  floor: '#2a2d36',
  floors: { wood: '#3a2420', tile: '#262a34', carpet: '#4a1a1c', concrete: '#2a2e38' },
  glass: '#ff3a20',
  roof: '#5a6070',
  terrain: '#3c414c',
  zones: {
    lawn: '#2a3832', pool: '#1fb5c8', driveway: '#383c46', path: '#d42a1a',
    bed: '#1a1416', terrace: '#2a2e38', other: '#22252e',
  },
  slat: '#5a6070',
  device: '#8a8f9a',
}

/** The same neighborhood under the noon smog: washed-out concrete, only the red keeps its strength. */
const DAY: PaletteSpec = {
  wall: '#9a9ea6',
  wallInterior: '#b8a8a4',
  floor: '#7a7c84',
  floors: { wood: '#8a6a5a', tile: '#8a8e98', carpet: '#9a5a56', concrete: '#8a8e96' },
  glass: '#c25a4e',                                     // the windows keep a red reflection: the signature stays on the house
  roof: '#6e727c',
  terrain: '#5a5e66',
  zones: {
    lawn: '#5a6a58', pool: '#5ab0bc', driveway: '#6a6e78', path: '#c43a2a',
    bed: '#4a4244', terrace: '#7a7e88', other: '#70747c',
  },
  slat: '#a0a6b0',
  device: '#a0a4ac',
}

const SURFACES: SurfaceLooks = {
  wall: { texture: 'concrete', roughness: 0.85, relief: 1.2 },
  // the rooms are lit red: the partition gives back part of it
  wallInterior: { texture: 'plaster', roughness: 0.8, emissive: 0.3 },
  floor: { texture: 'concrete', roughness: 0.6 },
  floors: {
    wood: { texture: 'wood', roughness: 0.6 },
    tile: { texture: 'tile', roughness: 0.4 },
    carpet: { texture: 'carpet', roughness: 0.9 },
    concrete: { texture: 'concrete', roughness: 0.6 },
  },
  roof: { texture: 'metal', roughness: 0.7, metalness: 0.1 },
  // the asphalt after rain: a little shine, not too much — a floor that reflects a black sky is black
  terrain: { texture: 'concrete', roughness: 0.6 },
  zones: {
    lawn: { texture: 'grass', roughness: 0.9 },
    pool: { texture: 'water', roughness: 0.03, metalness: 0.5, emissive: 0.3 },
    driveway: { texture: 'gloss', roughness: 0.45 },
    path: { texture: 'grid', roughness: 0.3, emissive: 0.6 },
    bed: { texture: 'soil', roughness: 1 },
    terrace: { texture: 'tile', roughness: 0.35, metalness: 0.2 },
    other: { texture: 'concrete', roughness: 0.6 },
  },
}

const SKY_NIGHT = { zenith: [0.006, 0.016, 0.03], horizon: [0.14, 0.025, 0.03], ground: [0.01, 0.006, 0.008], sunGlare: 5, sunColor: [0.6, 0.9, 1] } as const
const SKY_DAY = { zenith: [0.5, 0.52, 0.55], horizon: [0.85, 0.82, 0.78], ground: [0.08, 0.08, 0.09], sunGlare: 8, sunColor: [1, 0.96, 0.92] } as const

export const akiraStyle: RenderStyle = {
  id: 'akira',
  labelKey: 'render.styles.akira',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a)
    return {
      palette: mixPalette(NIGHT, DAY, day),
      surfaces: SURFACES,
      glass: { opacity: 0.45, roughness: 0.05, metalness: 0.3, emissive: mix(0.8, 0.05, day) },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        horizon: mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day),
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: mix(1.3, 1, day),
      },
      lighting: {
        // the moon is cyan, the sky that reflects the city is red: the film's two colors
        sunColor: new Color(0x4a8aaa).lerp(new Color(0xf2efe8), day),
        sunIntensity: mix(1.2, 2, day),
        hemiSky: new Color(0x5a1c22).lerp(new Color(0xb0b4ba), day),
        hemiGround: new Color(0x0c2430).lerp(new Color(0x3a3c42), day),
        hemiIntensity: mix(1, 0.9, day),
        ambientIntensity: mix(0.12, 0.16, day),
        shadowOpacity: mix(0.6, 0.9, day),
      },
      post: {
        toneMapping: 'aces',
        exposure: mix(1.45, 1, day),
        bloom: { strength: mix(1.3, 0.4, day), radius: 0.7, threshold: mix(0.5, 0.9, day) },
        ao: { intensity: 1.2, radius: 0.35 },
        vignette: mix(0.6, 0.35, day),
        // the cel: contrast, pushed red, strong saturation; the blacks are only crushed by
        // day (negative lift) — at night, they fell into black
        grade: { lift: [-0.01 * day, -0.015 * day, -0.01 * day], gamma: [0.97, 0.95, 0.96], gain: [1.08, 0.97, 0.96], saturation: 1.25 },
      },
      glow: { scale: mix(1.5, 1, day), opacity: mix(0.9, 0.3, day), lightIntensity: mix(16, 7, day), emissive: mix(2.6, 1.4, day) },
      parade: { kind: 'akira' },
      // garden: almost black foliage, red fruit and flowers that glow a little
      garden: { leaf: [new Color(0x14201c), new Color(0x1c1a1e), new Color(0x22181a)], bark: new Color(0x0c0c0e), stone: new Color(0x2a2e36), accent: new Color(0xff2a1a), emissive: 0.15 },
    }
  },
}
