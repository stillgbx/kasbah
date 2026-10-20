import { Color } from 'three'
import { dayFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixPalette, mixRgb, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// HALLOWEEN: not the haunted house (gray, dead, washed out) but the party: black, violet and ORANGE.
// The windows burn like pumpkins (very emissive glass), the pool is a green soup
// that glows, the horizon keeps the orange glow of an autumn moon. Ghosts and skeletons prowl
// (`StyleLook.parade`), bats fly by. The day only half rises.

const NIGHT: PaletteSpec = {
  wall: '#6a5580',
  wallInterior: '#4a3358',
  floor: '#3a2a22',
  floors: { wood: '#4a3222', tile: '#3a3440', carpet: '#5a1f2e', concrete: '#35323a' },
  glass: '#ff8a1c',
  roof: '#3a3046',
  terrain: '#3a3222',
  zones: {
    lawn: '#2c3620', pool: '#6dff3a', driveway: '#2f2a30', path: '#4a3020',
    bed: '#231a14', terrace: '#3a2c24', other: '#2e2830',
  },
  slat: '#1a141e',
  device: '#9a8aa8',
}

const DAY: PaletteSpec = {
  wall: '#8a78a0',
  wallInterior: '#7a6488',
  floor: '#6a5040',
  floors: { wood: '#7a5838', tile: '#6a6470', carpet: '#8a3a4a', concrete: '#65626a' },
  glass: '#ffa24a',
  roof: '#3a3242',
  terrain: '#5a5034',
  zones: {
    lawn: '#5a6a3a', pool: '#8aef5a', driveway: '#5f5a60', path: '#7a5a3a',
    bed: '#4a3a2a', terrace: '#6a5444', other: '#5e5860',
  },
  slat: '#3a3040',
  device: '#b0a2bc',
}

const SURFACES: SurfaceLooks = {
  wall: { texture: 'siding', roughness: 0.85, relief: 1.3 },
  wallInterior: { texture: 'plaster', roughness: 0.9, relief: 1.2 },
  floor: { texture: 'wood', roughness: 0.8, relief: 1.3 },
  floors: {
    wood: { texture: 'wood', roughness: 0.8, relief: 1.3 },
    tile: { texture: 'tile', roughness: 0.6, relief: 1.2 },
    carpet: { texture: 'carpet', roughness: 0.95 },
    concrete: { texture: 'concrete', roughness: 0.85, relief: 1.3 },
  },
  roof: { texture: 'roof', roughness: 0.8, relief: 1.4 },
  terrain: { texture: 'soil', roughness: 1, relief: 1.2 },
  zones: {
    lawn: { texture: 'grass', roughness: 0.95, relief: 1.2 },
    // the witch's soup: it glows and bubbles
    pool: { texture: 'water', roughness: 0.1, metalness: 0.2, emissive: 0.45 },
    driveway: { texture: 'gravel', roughness: 0.95, relief: 1.2 },
    path: { texture: 'stone', roughness: 0.9, relief: 1.4 },
    bed: { texture: 'soil', roughness: 1, relief: 1.3 },
    terrace: { texture: 'wood', roughness: 0.85, relief: 1.3 },
    other: { texture: 'gravel', roughness: 0.95 },
  },
}

// a violet zenith, a purplish horizon tending to orange: all orange, the house melted into it
const SKY_NIGHT = { zenith: [0.03, 0.01, 0.08], horizon: [0.24, 0.08, 0.16], ground: [0.015, 0.008, 0.02], sunGlare: 7, sunColor: [1, 0.6, 0.25] } as const
const SKY_DAY = { zenith: [0.2, 0.14, 0.32], horizon: [0.75, 0.5, 0.35], ground: [0.08, 0.06, 0.06], sunGlare: 8, sunColor: [1, 0.8, 0.6] } as const

export const halloweenStyle: RenderStyle = {
  id: 'halloween',
  labelKey: 'render.styles.halloween',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a) * 0.6                      // an October noon under a low sky
    return {
      palette: mixPalette(NIGHT, DAY, day),
      surfaces: SURFACES,
      // the windows are pumpkins: the glass burns orange, even without a lamp
      glass: { opacity: 0.5, roughness: 0.2, metalness: 0, emissive: mix(0.95, 0.3, day) },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        horizon: mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day),
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: mix(1.1, 0.9, day),
      },
      lighting: {
        sunColor: new Color(0xff9a3c).lerp(new Color(0xffd8b0), day),
        sunIntensity: mix(0.7, 1.6, day),
        hemiSky: new Color(0x5a2c8a).lerp(new Color(0x9a8ab0), day),
        hemiGround: new Color(0x3a1a05).lerp(new Color(0x5a4a3a), day),
        hemiIntensity: mix(0.7, 0.8, day),
        ambientIntensity: mix(0.08, 0.2, day),
        shadowOpacity: mix(0.6, 0.9, day),
      },
      post: {
        toneMapping: 'aces',
        exposure: mix(1.25, 1, day),
        bloom: { strength: mix(1.1, 0.35, day), radius: 0.6, threshold: mix(0.55, 0.9, day) },
        ao: { intensity: mix(1.4, 1.1, day), radius: 0.4 },
        vignette: mix(0.6, 0.35, day),
        grade: { lift: [0.02, 0.005, 0.035], gamma: [1.02, 0.98, 1], gain: [1.08, 0.96, 0.9], saturation: 1.15 },
      },
      glow: { scale: mix(1.6, 1.1, day), opacity: mix(1, 0.35, day), lightIntensity: mix(16, 7, day), emissive: mix(2.6, 1.4, day) },
      bats: { count: 6, color: new Color(0x140c1a) },
      parade: { kind: 'halloween' },
      // garden: autumn pushed further: orange, dark red, near-black violet; the fruits are pumpkins
      garden: { leaf: [new Color(0xe0661a), new Color(0x8a1f12), new Color(0x2a1a33), new Color(0xd9a21a)], bark: new Color(0x120c10), stone: new Color(0x4a4450), accent: new Color(0xff7a0a), foliage: 0.7 },
    }
  },
}
