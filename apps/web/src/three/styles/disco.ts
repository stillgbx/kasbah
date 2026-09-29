import { Color } from 'three'
import { dayFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixPalette, mixRgb, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// DISCO : la boule à facettes et la piste de danse. Les murs sont de l'argent poli qui renvoie un
// ciel bleu nuit à l'horizon magenta, le toit est en or, les sols sont des dalles laquées qui ÉMETTENT
// (magenta, or, cyan selon le revêtement), et deux projecteurs de couleurs opposées se partagent la maison : le
// ciel de l'hémisphère est cyan, son sol magenta. Comme la maison hantée, le style refuse en partie
// le jour (`dayFactor` écrasé) : à midi la fête baisse d'un ton, elle ne s'arrête pas.
// La boule à facettes au-dessus du toit et les projecteurs qui balaient la maison sont un EFFET animé
// (`effects/disco.ts`), demandé par `StyleLook.disco`.

const NIGHT: PaletteSpec = {
  wall: '#c9c4dc',
  wallInterior: '#4a1f5e',
  floor: '#6a1a5c',
  floors: { wood: '#7a5314', tile: '#8a1670', carpet: '#5a1846', concrete: '#154a66' },
  glass: '#ffc93d',
  roof: '#f0b83a',
  terrain: '#0c0812',
  zones: {
    lawn: '#1f1235', pool: '#19d8ff', driveway: '#2a1a3d', path: '#7a1f6e',
    bed: '#1a0f22', terrace: '#6d4a12', other: '#2a1c3a',
  },
  slat: '#e6e2f2',
  device: '#e0d8ff',
}

/** La même piste au grand jour : les couleurs restent franches, l'argent se refroidit. */
const DAY: PaletteSpec = {
  wall: '#dcd9e8',
  wallInterior: '#a878bd',
  floor: '#c255a8',
  floors: { wood: '#c9973a', tile: '#d04aae', carpet: '#a8488a', concrete: '#3f97c0' },
  glass: '#ffe08a',
  roof: '#e6be5c',
  terrain: '#2e2638',
  zones: {
    lawn: '#5a4a86', pool: '#5fe0ff', driveway: '#6a5a80', path: '#c060b0',
    bed: '#4a3a52', terrace: '#b89040', other: '#6a5a7a',
  },
  slat: '#f2f0fa',
  device: '#ece6ff',
}

const SURFACES: SurfaceLooks = {
  // l'argent : presque un miroir, c'est le ciel (bleu nuit, horizon magenta) qui lui donne ses reflets
  wall: { texture: 'metal', roughness: 0.18, metalness: 0.95, relief: 0.6 },
  wallInterior: { texture: 'gloss', roughness: 0.3, metalness: 0.4, emissive: 0.3 },
  // la piste : des dalles de 60 cm laquées qui rendent leur couleur
  floor: { texture: 'tile', roughness: 0.12, metalness: 0.3, emissive: 0.4 },
  floors: {
    wood: { texture: 'tile', roughness: 0.12, metalness: 0.5, emissive: 0.35 },
    tile: { texture: 'tile', roughness: 0.1, metalness: 0.3, emissive: 0.45 },
    carpet: { texture: 'carpet', roughness: 0.85, emissive: 0.15 },
    concrete: { texture: 'tile', roughness: 0.12, metalness: 0.3, emissive: 0.4 },
  },
  // l'or : moins miroir que l'argent, et il rend un peu sa couleur, sinon il ne renvoie que le ciel
  roof: { texture: 'metal', roughness: 0.3, metalness: 0.6, emissive: 0.15, relief: 0.6 },
  terrain: { texture: 'gloss', roughness: 0.35, metalness: 0.3, relief: 0.5 },
  zones: {
    lawn: { texture: 'grass', roughness: 0.8 },
    pool: { texture: 'water', roughness: 0.03, metalness: 0.5, emissive: 0.5 },
    driveway: { texture: 'gloss', roughness: 0.25, metalness: 0.5 },
    path: { texture: 'tile', roughness: 0.12, metalness: 0.3, emissive: 0.4 },
    bed: { texture: 'soil', roughness: 1 },
    terrace: { texture: 'tile', roughness: 0.15, metalness: 0.6, emissive: 0.25 },
    other: { texture: 'gloss', roughness: 0.3, metalness: 0.5 },
  },
}

// le ciel est la carte d'environnement : c'est LUI qui colore l'argent des murs
const SKY_NIGHT = { zenith: [0.015, 0.025, 0.16], horizon: [0.32, 0.05, 0.36], ground: [0.02, 0.005, 0.03], sunGlare: 8, sunColor: [1, 0.75, 0.3] } as const
const SKY_DAY = { zenith: [0.12, 0.2, 0.55], horizon: [0.75, 0.5, 0.8], ground: [0.08, 0.05, 0.1], sunGlare: 10, sunColor: [1, 0.9, 0.7] } as const

export const discoStyle: RenderStyle = {
  id: 'disco',
  labelKey: 'render.styles.disco',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a) * 0.7                      // la fête baisse d'un ton à midi, elle ne s'arrête pas
    return {
      palette: mixPalette(NIGHT, DAY, day),
      surfaces: SURFACES,
      // la vitre dorée d'une boîte de nuit : on devine la fête derrière
      glass: { opacity: 0.45, roughness: 0.03, metalness: 0.4, emissive: mix(0.8, 0.2, day) },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        horizon: mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day),
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: mix(1.6, 1.1, day),                   // les reflets de l'argent font le style
      },
      lighting: {
        // le soleil est un projecteur doré ; l'hémisphère, deux gélatines opposées
        sunColor: new Color(0xffb13d).lerp(new Color(0xfff0d8), day),
        sunIntensity: mix(0.9, 1.8, day),
        hemiSky: new Color(0x19c8ff).lerp(new Color(0x9ab8e8), day),
        hemiGround: new Color(0xff1fa8).lerp(new Color(0x8a4a7a), day),
        hemiIntensity: mix(0.9, 0.8, day),
        ambientIntensity: mix(0.08, 0.2, day),
        shadowOpacity: mix(0.6, 0.9, day),
      },
      post: {
        toneMapping: 'aces',
        exposure: mix(1.3, 1, day),
        bloom: { strength: mix(1.3, 0.5, day), radius: 0.6, threshold: mix(0.5, 0.85, day) },
        ao: { intensity: mix(1.2, 1, day), radius: 0.3 },
        vignette: mix(0.55, 0.3, day),
        grade: { lift: [0.02, 0, 0.035], gamma: [1, 0.98, 1.02], gain: [1.05, 0.98, 1.05], saturation: 1.25 },
      },
      disco: { spots: 4, colors: [new Color(0xff1fa8), new Color(0x19c8ff), new Color(0xffc21a), new Color(0x9b4dff)] },
      glow: { scale: mix(1.8, 1.1, day), opacity: mix(1, 0.4, day), lightIntensity: mix(22, 8, day), emissive: mix(3.2, 1.5, day) },
      // jardin : paillettes : rose fluo, or, cyan, violet qui émettent ; troncs noirs, fruits argent
      garden: { leaf: [new Color(0xff2bb4), new Color(0xffc21a), new Color(0x19d8ff), new Color(0x9b4dff)], bark: new Color(0x141018), stone: new Color(0xc9c4dc), accent: new Color(0xf2f0ff), emissive: 0.35 },
    }
  },
}
