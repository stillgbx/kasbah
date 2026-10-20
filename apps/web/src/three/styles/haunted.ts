import { Color } from 'three'
import { dayFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixPalette, mixRgb, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// HAUNTED HOUSE: washed-out wood, slate, dead grass, a greenish moon and windows glowing
// with a light nobody turned on. Day never quite comes: `dayFactor` is crushed,
// a summer noon stays a low gray sky — but the house can be seen, otherwise the style only serves at night. The relief is pushed everywhere — nothing is new.

const NIGHT: PaletteSpec = {
  wall: '#7a7a84',
  wallInterior: '#7a6474',
  floor: '#5e4a3c',
  floors: { wood: '#5e4a3c', tile: '#62635f', carpet: '#633a4c', concrete: '#5c5d62' },
  glass: '#b8d46a',
  roof: '#3a3a44',
  terrain: '#5a6044',
  zones: {
    lawn: '#555a3c', pool: '#3f8a60', driveway: '#5c5a55', path: '#68645c',
    bed: '#3f3024', terrace: '#5e4e40', other: '#55524a',
  },
  slat: '#7e7a72',
  device: '#6b6a70',
}

/** The same place in broad daylight: discolored, not warmed. */
const DAY: PaletteSpec = {
  wall: '#8a8a8c',
  wallInterior: '#85757e',
  floor: '#6e5c4c',
  floors: { wood: '#6e5c4c', tile: '#7a7a76', carpet: '#6e4c58', concrete: '#77787a' },
  glass: '#a9b7a0',
  roof: '#45454c',
  terrain: '#5f6146',
  zones: {
    lawn: '#6b6a48', pool: '#4f7a60', driveway: '#77746c', path: '#827c70',
    bed: '#4a3c2e', terrace: '#6e5f50', other: '#6a665c',
  },
  slat: '#8c877e',
  device: '#8a8990',
}

const SURFACES: SurfaceLooks = {
  wall: { texture: 'wood', roughness: 1, relief: 1.6 },
  wallInterior: { texture: 'plaster', roughness: 1, relief: 1.8 },
  floor: { texture: 'wood', roughness: 0.9, relief: 1.4 },
  floors: {
    wood: { texture: 'wood', roughness: 0.9, relief: 1.4 },
    tile: { texture: 'stone', roughness: 0.95, relief: 1.5 },
    carpet: { texture: 'carpet', roughness: 1 },
    concrete: { texture: 'stone', roughness: 1, relief: 1.3 },
  },
  roof: { texture: 'roof', roughness: 0.9, relief: 1.5 },
  terrain: { texture: 'grass', roughness: 1 },
  zones: {
    lawn: { texture: 'grass', roughness: 1 },
    // stagnant water that glows a little, and barely moves
    pool: { texture: 'water', roughness: 0.1, metalness: 0.2, emissive: 0.35, flow: 0.3 },
    driveway: { texture: 'gravel', roughness: 1 },
    path: { texture: 'gravel', roughness: 1 },
    bed: { texture: 'soil', roughness: 1 },
    terrace: { texture: 'wood', roughness: 0.95, relief: 1.6 },
    other: { texture: 'soil', roughness: 1 },
  },
}

const SKY_NIGHT = { zenith: [0.012, 0.008, 0.022], horizon: [0.06, 0.09, 0.07], ground: [0.006, 0.008, 0.006], sunGlare: 5, sunColor: [0.75, 0.95, 0.8] } as const
const SKY_DAY = { zenith: [0.2, 0.21, 0.23], horizon: [0.52, 0.54, 0.52], ground: [0.08, 0.08, 0.07], sunGlare: 1, sunColor: [0.85, 0.88, 0.85] } as const

export const hauntedStyle: RenderStyle = {
  id: 'haunted',
  labelKey: 'render.styles.haunted',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a) * 0.8                      // the day never quite rises
    return {
      palette: mixPalette(NIGHT, DAY, day),
      surfaces: SURFACES,
      // the windows glow greenish, even when nobody is there
      glass: { opacity: 0.45, roughness: 0.35, metalness: 0, emissive: mix(0.55, 0.15, day) },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        horizon: mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day),
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: mix(0.9, 1, day),
      },
      lighting: {
        sunColor: new Color(0x9fc9b0).lerp(new Color(0xc9cfcc), day),
        sunIntensity: mix(1.2, 2.1, day),
        hemiSky: new Color(0x4a3f6b).lerp(new Color(0x8a8e94), day),
        hemiGround: new Color(0x16261b).lerp(new Color(0x3a3c30), day),
        hemiIntensity: mix(1.2, 1, day),
        ambientIntensity: mix(0.1, 0.22, day),
        shadowOpacity: mix(0.7, 0.5, day),
      },
      post: {
        toneMapping: 'aces',
        exposure: mix(1.3, 1.25, day),
        bloom: { strength: mix(0.9, 0.35, day), radius: 0.8, threshold: mix(0.55, 0.85, day) },
        ao: { intensity: mix(1.5, 1.15, day), radius: 0.45 },
        vignette: mix(0.75, 0.4, day),
      },
      glow: { scale: mix(1.4, 1, day), opacity: mix(0.8, 0.4, day), lightIntensity: mix(11, 6, day), emissive: mix(2.2, 1.3, day) },
      // garden: half-dead trees: dull, sparse foliage, almost black trunks, phosphorescent fruit
      garden: { leaf: [new Color(0x33332a), new Color(0x2b2531), new Color(0x3d3a33)], bark: new Color(0x1e1a1f), stone: new Color(0x57555c), accent: new Color(0x9cff57), emissive: 0.6, foliage: 0.45 },
      // a swarm at night, two or three strays in broad daylight; purplish gray at night (the garden is
      // black then), black against the gray day
      bats: { count: Math.round(mix(12, 3, day)), color: new Color(0x5a4d6b).lerp(new Color(0x141018), day / 0.8) },
    }
  },
}
