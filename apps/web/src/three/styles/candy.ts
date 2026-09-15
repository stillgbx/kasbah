import { Color } from 'three'
import { dayFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixRgb, toPalette, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// CANDY : la maquette en plastique, pastel et laquée. Tout est `gloss` — une seule matière presque
// lisse — et c'est assumé : ce style-là ne raconte pas des matériaux, il raconte un objet moulé.
// L'éclairage reste clair même la nuit (une maison de poupée sous une lampe de bureau), l'occlusion
// est faible pour ne pas salir les pastels, et il n'y a pas de vignette.

const PALETTE: PaletteSpec = {
  wall: '#ffe9ef',
  wallInterior: '#fff3f6',
  floor: '#ffd9c7',
  floors: { wood: '#ffcba4', tile: '#d9f0ff', carpet: '#ffd1e3', concrete: '#e8e4f5' },
  glass: '#bdeaff',
  roof: '#ff9fb5',
  terrain: '#a8e6a1',
  zones: {
    lawn: '#a8e6a1', pool: '#7fd8f7', driveway: '#dcd6ee', path: '#ffe3c2',
    bed: '#d9a7e0', terrace: '#ffe0b8', other: '#e4e0f0',
  },
  slat: '#ffffff',
  device: '#b9b2d8',
}

const gloss = (roughness: number) => ({ texture: 'gloss' as const, roughness, relief: 0.5 })

const SURFACES: SurfaceLooks = {
  wall: gloss(0.4),
  wallInterior: gloss(0.45),
  floor: gloss(0.4),
  floors: { wood: gloss(0.35), tile: gloss(0.2), carpet: { texture: 'carpet', roughness: 0.9 }, concrete: gloss(0.5) },
  roof: gloss(0.3),
  terrain: { texture: 'grass', roughness: 0.8, relief: 0.4 },
  zones: {
    lawn: { texture: 'grass', roughness: 0.8, relief: 0.4 },
    pool: { texture: 'water', roughness: 0.05, metalness: 0.2 },
    driveway: gloss(0.5),
    path: gloss(0.45),
    bed: gloss(0.6),
    terrace: gloss(0.4),
    other: gloss(0.5),
  },
}

const SKY_NIGHT = { zenith: [0.06, 0.05, 0.12], horizon: [0.3, 0.24, 0.36], ground: [0.04, 0.035, 0.05], sunGlare: 5, sunColor: [1, 0.9, 1] } as const
const SKY_DAY = { zenith: [0.35, 0.5, 0.8], horizon: [1, 0.95, 0.98], ground: [0.22, 0.24, 0.2], sunGlare: 9, sunColor: [1, 0.97, 0.92] } as const

export const candyStyle: RenderStyle = {
  id: 'candy',
  labelKey: 'render.styles.candy',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a)
    return {
      palette: toPalette(PALETTE),
      surfaces: SURFACES,
      glass: { opacity: 0.35, roughness: 0.05, metalness: 0.1, emissive: 0 },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        horizon: mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day),
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: 1.3,
      },
      lighting: {
        sunColor: new Color(0xd8c8ff).lerp(new Color(0xfff6ea), day),
        // même la nuit la lumière reste franche : une maquette posée sous une lampe, pas une maison
        sunIntensity: mix(1.1, 2.4, day),
        hemiSky: new Color(0x6a5f96).lerp(new Color(0xe8f2ff), day),
        hemiGround: new Color(0x40395c).lerp(new Color(0xc0b6a8), day),
        hemiIntensity: mix(0.8, 1.1, day),
        ambientIntensity: mix(0.25, 0.32, day),
        shadowOpacity: 0.8,
      },
      post: {
        toneMapping: 'neutral',                          // il ne doit RIEN faire aux pastels
        exposure: mix(1.15, 1, day),
        bloom: { strength: mix(0.45, 0.2, day), radius: 0.7, threshold: 0.9 },
        ao: { intensity: 0.5, radius: 0.5 },
        vignette: 0,
      },
      glow: { scale: mix(1.3, 1, day), opacity: mix(0.7, 0.3, day), lightIntensity: mix(10, 5, day), emissive: mix(2, 1.3, day) },
    }
  },
}
