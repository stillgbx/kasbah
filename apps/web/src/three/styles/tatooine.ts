import { Color } from 'three'
import { dayFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixPalette, mixRgb, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// TATOOINE : la ferme d'humidité dans le désert — celles des films sont tournées dans les ksour du
// sud tunisien, ce qui va bien à une Kasbah. Murs d'adobe ocre au relief poussé, toit du même
// enduit, pas un brin d'herbe : sable partout, la piscine est la réserve d'eau. Soleil écrasant et
// blanc chaud, ciel poussiéreux, ombres franches. Des X-wings passent au-dessus (`StyleLook.parade`).
// Le ciel n'a qu'un soleil : un second disque demanderait de toucher `core/sky.ts`.

const PALETTE: PaletteSpec = {
  wall: '#d9b98c',
  wallInterior: '#e6d2ae',
  floor: '#b08a5e',
  floors: { wood: '#9a6b3f', tile: '#cfae7e', carpet: '#a0522d', concrete: '#c9a878' },
  glass: '#2a3a44',
  roof: '#d2b083',
  terrain: '#e2c28e',
  zones: {
    lawn: '#dcbb86', pool: '#4fa3b5', driveway: '#c7a472', path: '#d4b27c',
    bed: '#b08a5a', terrace: '#cba676', other: '#d0b080',
  },
  slat: '#8a6b4a',
  device: '#b8b0a0',
}

/** La nuit : le même sable sous deux lunes, bleui. */
const NIGHT: PaletteSpec = { ...PALETTE, terrain: '#9a8a78', zones: { ...PALETTE.zones, lawn: '#968672' } }

const adobe = { texture: 'plaster' as const, roughness: 0.95, relief: 1.5 }
const sand = { texture: 'soil' as const, roughness: 1, relief: 0.6 }

const SURFACES: SurfaceLooks = {
  wall: adobe,
  wallInterior: { texture: 'plaster', roughness: 0.9, relief: 1.2 },
  floor: { texture: 'tile', roughness: 0.8, relief: 1.2 },
  floors: {
    wood: { texture: 'wood', roughness: 0.85, relief: 1.2 },
    tile: { texture: 'tile', roughness: 0.8, relief: 1.2 },
    carpet: { texture: 'carpet', roughness: 0.95 },
    concrete: { texture: 'concrete', roughness: 0.9, relief: 1.3 },
  },
  roof: adobe,
  roofFlat: adobe,
  terrain: sand,
  zones: {
    lawn: sand,
    pool: { texture: 'water', roughness: 0.05, metalness: 0.1 },
    driveway: { texture: 'pavers', roughness: 0.95, relief: 1.2 },
    path: { texture: 'stone', roughness: 0.9, relief: 1.3 },
    bed: sand,
    terrace: { texture: 'tile', roughness: 0.85, relief: 1.2 },
    other: sand,
  },
}

// le ciel poussiéreux d'un désert : un zénith pâle, un horizon presque blanc et chaud
const SKY_NIGHT = { zenith: [0.01, 0.014, 0.045], horizon: [0.12, 0.09, 0.08], ground: [0.03, 0.025, 0.02], sunGlare: 6, sunColor: [0.9, 0.85, 1] } as const
const SKY_DAY = { zenith: [0.32, 0.46, 0.72], horizon: [0.95, 0.82, 0.62], ground: [0.32, 0.24, 0.15], sunGlare: 14, sunColor: [1, 0.92, 0.75] } as const

export const tatooineStyle: RenderStyle = {
  id: 'tatooine',
  labelKey: 'render.styles.tatooine',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a)
    return {
      palette: mixPalette(NIGHT, PALETTE, day),
      surfaces: SURFACES,
      glass: { opacity: 0.55, roughness: 0.15, metalness: 0.2, emissive: mix(0.5, 0, day) },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        horizon: mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day),
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: mix(0.9, 1, day),
      },
      lighting: {
        sunColor: new Color(0x9aa8d8).lerp(new Color(0xffe2b0), day),
        // un soleil écrasant : c'est lui qui fait le désert, avec des ombres franches
        sunIntensity: mix(0.5, 2.8, day),
        hemiSky: new Color(0x2a3050).lerp(new Color(0xbcd4ff), day),
        hemiGround: new Color(0x3a3028).lerp(new Color(0xc29060), day),
        hemiIntensity: mix(0.6, 0.7, day),
        ambientIntensity: mix(0.08, 0.15, day),
        shadowOpacity: mix(0.6, 1, day),
      },
      post: {
        toneMapping: 'aces',
        exposure: mix(1.2, 0.95, day),
        bloom: { strength: mix(0.5, 0.3, day), radius: 0.6, threshold: 0.9 },
        ao: { intensity: 1.1, radius: 0.45 },
        vignette: mix(0.45, 0.3, day),
        // une chaleur jaune dans les hautes lumières, des couleurs un peu brûlées
        grade: { lift: [0.015, 0.008, 0], gamma: [1.02, 1, 0.97], gain: [1.06, 1, 0.88], saturation: 0.92 },
      },
      glow: { scale: mix(1.4, 1, day), opacity: mix(0.8, 0.3, day), lightIntensity: mix(12, 6, day), emissive: mix(2.2, 1.3, day) },
      parade: { kind: 'tatooine' },
      // jardin : la végétation rare d'un désert, olive poussiéreuse et à moitié sèche
      garden: { leaf: [new Color(0x7a7a4a), new Color(0x8c8456), new Color(0xa39461)], bark: new Color(0x6b5238), stone: new Color(0xcdb38a), accent: null, foliage: 0.6 },
    }
  },
}
