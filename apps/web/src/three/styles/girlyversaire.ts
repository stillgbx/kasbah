import { Color } from 'three'
import { dayFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixRgb, toPalette, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// GIRLYVERSAIRE : l'anniversaire d'une petite fille, la maison en gâteau de fête. Façades rose
// bonbon au glaçage lisse, toit lilas, touches dorées (volets, allées, terrasse), pelouse bien
// verte, fenêtres d'une lumière dorée. La nuit reste claire et violacée : c'est une fête, pas une
// veillée. Des ballons de toutes les couleurs s'envolent autour de la maison (`StyleLook.parade`).

const PALETTE: PaletteSpec = {
  wall: '#f29bc4',
  wallInterior: '#fde8f2',
  floor: '#e8b98a',
  floors: { wood: '#e0b07e', tile: '#f6dcef', carpet: '#c9a0ee', concrete: '#e8def2' },
  glass: '#ffd98a',
  roof: '#a985dc',
  terrain: '#86d38e',
  zones: {
    lawn: '#86d38e', pool: '#5fd6ea', driveway: '#eadcf4', path: '#f2c45a',
    bed: '#f5a3cc', terrace: '#f6dc94', other: '#ece2f4',
  },
  slat: '#f2c14e',
  device: '#fff4fa',
}

// le glaçage : lisse et un peu brillant, sans être du plastique moulé comme `candy`
const icing = (roughness: number) => ({ texture: 'gloss' as const, roughness, relief: 0.6 })
// l'or : du métal, mais pas trop (sans environnement, une métallicité haute noircit)
const gold = { texture: 'metal' as const, roughness: 0.35, metalness: 0.55, relief: 0.4 }

const SURFACES: SurfaceLooks = {
  wall: icing(0.45),
  wallInterior: { texture: 'plaster', roughness: 0.85 },
  floor: { texture: 'wood', roughness: 0.6 },
  floors: {
    wood: { texture: 'wood', roughness: 0.6 },
    tile: { texture: 'tile', roughness: 0.3 },
    carpet: { texture: 'carpet', roughness: 0.95 },
    concrete: icing(0.5),
  },
  roof: { texture: 'roof', roughness: 0.5, relief: 0.8 },
  terrain: { texture: 'grass', roughness: 0.85 },
  zones: {
    lawn: { texture: 'grass', roughness: 0.85 },
    pool: { texture: 'water', roughness: 0.05, metalness: 0.2 },
    driveway: { texture: 'pavers', roughness: 0.7 },
    path: gold,
    bed: { texture: 'soil', roughness: 0.9 },
    terrace: gold,
    other: icing(0.5),
  },
}

// nuit violette et douce ; jour bleu clair, un rien rosé à l'horizon
const SKY_NIGHT = { zenith: [0.05, 0.03, 0.14], horizon: [0.32, 0.16, 0.36], ground: [0.04, 0.03, 0.06], sunGlare: 5, sunColor: [1, 0.9, 1] } as const
const SKY_DAY = { zenith: [0.28, 0.45, 0.8], horizon: [0.85, 0.78, 0.88], ground: [0.2, 0.2, 0.18], sunGlare: 6, sunColor: [1, 0.96, 0.9] } as const

export const girlyversaireStyle: RenderStyle = {
  id: 'girlyversaire',
  labelKey: 'render.styles.girlyversaire',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a)
    return {
      palette: toPalette(PALETTE),
      surfaces: SURFACES,
      // des fenêtres de fête : dorées et allumées dès que le jour baisse
      glass: { opacity: 0.4, roughness: 0.06, metalness: 0.1, emissive: mix(0.7, 0.05, day) },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        horizon: mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day),
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: mix(1.25, 0.9, day),
      },
      lighting: {
        // une lune lilas qui laisse lire les couleurs ; un soleil franc et chaud le jour
        sunColor: new Color(0xd6b8ff).lerp(new Color(0xfff4e6), day),
        sunIntensity: mix(0.9, 1.8, day),
        hemiSky: new Color(0x5a4690).lerp(new Color(0xe6eeff), day),
        hemiGround: new Color(0x4a3a5c).lerp(new Color(0xc8bca8), day),
        hemiIntensity: mix(0.8, 0.7, day),
        ambientIntensity: mix(0.22, 0.28, day),
        shadowOpacity: mix(0.6, 0.85, day),
      },
      post: {
        toneMapping: 'agx',                              // le rose ne doit pas virer au saumon
        exposure: mix(1.3, 0.95, day),
        bloom: { strength: mix(0.7, 0.25, day), radius: 0.7, threshold: mix(0.65, 0.95, day) },
        ao: { intensity: 0.7, radius: 0.45 },
        vignette: mix(0.3, 0.1, day),
        grade: { lift: [0.01, 0, 0.015], gamma: [1, 1, 1], gain: [1.03, 1, 1.02], saturation: 1.12 },
      },
      glow: { scale: mix(1.5, 1.05, day), opacity: mix(0.9, 0.35, day), lightIntensity: mix(14, 6, day), emissive: mix(2.4, 1.4, day) },
      parade: { kind: 'girlyversaire' },
      // jardin : feuillages tendres, fleurs et fruits roses
      garden: { leaf: [new Color(0x5fbf6a), new Color(0x8ad67a), new Color(0xf5a3cc)], bark: new Color(0x8a5a3c), stone: new Color(0xf2e6f6), accent: new Color(0xff4f9a) },
    }
  },
}
