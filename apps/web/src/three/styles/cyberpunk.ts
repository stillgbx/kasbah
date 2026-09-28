import { Color } from 'three'
import { dayFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixPalette, mixRgb, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// CYBERPUNK : métal brossé, dalles techniques, néon. C'est le style qui éprouve la couture, parce
// qu'il contredit le réaliste sur tout — il ÉMET (les cloisons et les sols rendent de la lumière,
// `SurfaceLook.emissive`), il change de palette avec l'heure (le jour y est blafard, la nuit y est
// violette) et il pousse le bloom jusqu'à baver. Si ces trois-là passent, un style peut tout dire.

const NIGHT: PaletteSpec = {
  wall: '#2b2f48',
  wallInterior: '#3a2f56',
  floor: '#1b1f33',
  floors: { wood: '#3c2a45', tile: '#1f2740', carpet: '#33243f', concrete: '#232839' },
  glass: '#4de0ff',
  roof: '#20243a',
  terrain: '#141726',
  zones: {
    lawn: '#16281f', pool: '#1fd1e8', driveway: '#262b3d', path: '#3a2f56',
    bed: '#1a1424', terrace: '#2c3350', other: '#242838',
  },
  slat: '#7a83a8',
  device: '#8a93bb',
}

/** Le même quartier à midi : le néon ne se voit plus, il ne reste que du béton et de l'acier. */
const DAY: PaletteSpec = {
  wall: '#8b90a4',
  wallInterior: '#9a93ad',
  floor: '#767c90',
  floors: { wood: '#8a7490', tile: '#7e8798', carpet: '#8c7d99', concrete: '#7f8494' },
  glass: '#9fd8e8',
  roof: '#6c7186',
  terrain: '#4e5566',
  zones: {
    lawn: '#4f6b52', pool: '#59b6c8', driveway: '#767c90', path: '#8a8398',
    bed: '#4a4458', terrace: '#7c849c', other: '#767a8a',
  },
  slat: '#aab2cc',
  device: '#9aa3c0',
}

const SURFACES: SurfaceLooks = {
  wall: { texture: 'metal', roughness: 0.4, metalness: 0.8 },
  // la cloison intérieure est la source du violet : elle rend une part de sa couleur
  wallInterior: { texture: 'grid', roughness: 0.35, metalness: 0.5, emissive: 0.35 },
  floor: { texture: 'grid', roughness: 0.3, metalness: 0.6, emissive: 0.12 },
  floors: {
    wood: { texture: 'gloss', roughness: 0.25, metalness: 0.2, emissive: 0.1 },
    tile: { texture: 'grid', roughness: 0.2, metalness: 0.5, emissive: 0.15 },
    carpet: { texture: 'carpet', roughness: 0.9 },
    concrete: { texture: 'grid', roughness: 0.4, metalness: 0.4, emissive: 0.08 },
  },
  roof: { texture: 'metal', roughness: 0.45, metalness: 0.9 },
  terrain: { texture: 'grid', roughness: 0.5, metalness: 0.4, emissive: 0.05 },
  zones: {
    lawn: { texture: 'grass', roughness: 0.9 },
    pool: { texture: 'water', roughness: 0.03, metalness: 0.6, emissive: 0.5 },
    driveway: { texture: 'grid', roughness: 0.35, metalness: 0.6, emissive: 0.08 },
    path: { texture: 'grid', roughness: 0.3, metalness: 0.5, emissive: 0.25 },
    bed: { texture: 'soil', roughness: 1 },
    terrace: { texture: 'metal', roughness: 0.35, metalness: 0.85 },
    other: { texture: 'metal', roughness: 0.5, metalness: 0.7 },
  },
}

const SKY_NIGHT = { zenith: [0.015, 0.008, 0.04], horizon: [0.14, 0.05, 0.22], ground: [0.01, 0.004, 0.018], sunGlare: 6, sunColor: [0.9, 0.4, 1] } as const
const SKY_DAY = { zenith: [0.16, 0.18, 0.3], horizon: [0.55, 0.55, 0.62], ground: [0.06, 0.06, 0.07], sunGlare: 10, sunColor: [1, 0.95, 0.95] } as const

export const cyberpunkStyle: RenderStyle = {
  id: 'cyberpunk',
  labelKey: 'render.styles.cyberpunk',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a)
    return {
      palette: mixPalette(NIGHT, DAY, day),
      surfaces: SURFACES,
      // la vitre est une enseigne : opaque de loin, franchement lumineuse
      glass: { opacity: 0.4, roughness: 0.02, metalness: 0.3, emissive: mix(0.7, 0.05, day) },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        horizon: mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day),
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: mix(1.4, 1, day),                     // les reflets font tout le travail ici
      },
      lighting: {
        sunColor: new Color(0xc86bff).lerp(new Color(0xdfe6f2), day),
        sunIntensity: mix(0.5, 2, day),
        hemiSky: new Color(0x5a2c8a).lerp(new Color(0x9aa6bd), day),
        hemiGround: new Color(0x0a2438).lerp(new Color(0x3a3f4c), day),
        hemiIntensity: mix(0.6, 0.9, day),
        ambientIntensity: mix(0.06, 0.18, day),
        shadowOpacity: mix(0.5, 1, day),
      },
      post: {
        toneMapping: 'aces',
        exposure: mix(1.25, 1, day),
        bloom: { strength: mix(1.5, 0.35, day), radius: 0.75, threshold: mix(0.45, 0.9, day) },
        ao: { intensity: mix(1.3, 1, day), radius: 0.3 },
        vignette: mix(0.6, 0.3, day),
      },
      glow: { scale: mix(1.6, 1, day), opacity: mix(1, 0.3, day), lightIntensity: mix(20, 7, day), emissive: mix(3, 1.4, day) },
      // jardin : néon : le feuillage ÉMET, cyan, magenta, violet ; troncs noirs, fruits jaune fluo
      garden: { leaf: [new Color(0x00e5ff), new Color(0xff2bd6), new Color(0x7c4dff)], bark: new Color(0x121218), stone: new Color(0x1c2030), accent: new Color(0xfff200), emissive: 0.3 },
    }
  },
}
