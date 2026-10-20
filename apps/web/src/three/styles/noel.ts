import { Color } from 'three'
import { dayFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixPalette, mixRgb, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// CHRISTMAS: the chalet under snow. Red-sided facades, roof, terrain and lawn white with
// snow (the snow is PAINTED by the palette: it holds even without snowy weather), windows with a
// warm light visible from afar, blue night and moonlight. Santa's sleigh circles
// above the roof (`StyleLook.parade`).

const NIGHT: PaletteSpec = {
  wall: '#7a2420',
  wallInterior: '#e8d6bc',
  floor: '#7a5334',
  floors: { wood: '#7a5334', tile: '#2f5e40', carpet: '#8e1e26', concrete: '#8a8680' },
  glass: '#ffc36b',
  roof: '#dfe7f2',
  terrain: '#d6e0ee',
  zones: {
    lawn: '#d9e3f0', pool: '#6a9cc8', driveway: '#a8b2c2', path: '#c2cbd8',
    bed: '#cdd7e6', terrace: '#b8c2d0', other: '#c4cedc',
  },
  slat: '#f2efe8',
  device: '#e8e2d8',
}

const DAY: PaletteSpec = {
  wall: '#9a2e28',
  wallInterior: '#f2e4cc',
  floor: '#9a6a44',
  floors: { wood: '#9a6a44', tile: '#3f7a52', carpet: '#a8242e', concrete: '#a8a49e' },
  glass: '#ffd9a0',
  roof: '#f4f7fb',
  terrain: '#eef2f7',
  zones: {
    lawn: '#eff3f8', pool: '#8ab8dc', driveway: '#c4ccd8', path: '#dce2ea',
    bed: '#e4eaf2', terrace: '#d4dae4', other: '#dde3ec',
  },
  slat: '#ffffff',
  device: '#f2ede4',
}

// the snow: a matte, fine-grained white that keeps a little relief
const snow = { texture: 'plaster' as const, roughness: 0.9, relief: 0.5 }

const SURFACES: SurfaceLooks = {
  wall: { texture: 'siding', roughness: 0.7, relief: 1.1 },
  wallInterior: { texture: 'plaster', roughness: 0.85 },
  floor: { texture: 'wood', roughness: 0.6 },
  floors: {
    wood: { texture: 'wood', roughness: 0.6 },
    tile: { texture: 'tile', roughness: 0.4 },
    carpet: { texture: 'carpet', roughness: 0.95 },
    concrete: { texture: 'concrete', roughness: 0.8 },
  },
  roof: snow,
  roofFlat: snow,
  terrain: snow,
  zones: {
    lawn: snow,
    // skating-rink ice, smooth and bluish, that does not move
    pool: { texture: 'water', roughness: 0.05, metalness: 0.3, flow: 0 },
    driveway: { texture: 'gravel', roughness: 0.9, relief: 0.5 },
    path: snow,
    bed: snow,
    terrace: snow,
    other: snow,
  },
}

// blue night under the moon; pale winter day
const SKY_NIGHT = { zenith: [0.008, 0.015, 0.06], horizon: [0.07, 0.09, 0.18], ground: [0.02, 0.025, 0.04], sunGlare: 5, sunColor: [0.8, 0.88, 1] } as const
const SKY_DAY = { zenith: [0.3, 0.42, 0.65], horizon: [0.78, 0.82, 0.9], ground: [0.3, 0.32, 0.36], sunGlare: 7, sunColor: [1, 0.95, 0.88] } as const

export const noelStyle: RenderStyle = {
  id: 'noel',
  labelKey: 'render.styles.noel',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a)
    return {
      palette: mixPalette(NIGHT, DAY, day),
      surfaces: SURFACES,
      // the windows of a winter evening gathering: warm and visible from afar, especially at night
      glass: { opacity: 0.45, roughness: 0.08, metalness: 0.1, emissive: mix(0.8, 0.1, day) },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        horizon: mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day),
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: mix(1.2, 0.9, day),
      },
      lighting: {
        // bluish moonlight at night; low, white sun by day
        sunColor: new Color(0xa8c0ff).lerp(new Color(0xfff2e0), day),
        sunIntensity: mix(0.6, 1.9, day),
        hemiSky: new Color(0x2a3a6a).lerp(new Color(0xc8d8f0), day),
        hemiGround: new Color(0x6a7890).lerp(new Color(0xe0e6ee), day),   // the snow bounces the light back
        hemiIntensity: mix(0.7, 0.8, day),
        ambientIntensity: mix(0.1, 0.22, day),
        shadowOpacity: mix(0.55, 0.85, day),
      },
      post: {
        toneMapping: 'agx',                              // the white of the snow must not burn out
        exposure: mix(1.3, 0.95, day),
        bloom: { strength: mix(0.8, 0.25, day), radius: 0.7, threshold: mix(0.6, 0.95, day) },
        ao: { intensity: mix(1.1, 0.9, day), radius: 0.4 },
        vignette: mix(0.45, 0.2, day),
        grade: { lift: [0, 0.005, 0.02], gamma: [1, 1, 1.02], gain: [1.02, 1, 1.03], saturation: 1.05 },
      },
      glow: { scale: mix(1.7, 1.1, day), opacity: mix(1, 0.35, day), lightIntensity: mix(18, 7, day), emissive: mix(2.8, 1.4, day) },
      parade: { kind: 'noel' },
      // garden: dark firs and frost; the fruits are red baubles
      garden: { leaf: [new Color(0x1f4d2e), new Color(0x2b5e3a), new Color(0xdfe8ee)], bark: new Color(0x4a3222), stone: new Color(0xe6ecf2), accent: new Color(0xd81f26) },
    }
  },
}
