import { Color } from 'three'
import { dayFactor, duskFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixRgb, toPalette, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// INDIGO: the monochrome isometric illustration — the whole house is cut from the same blue,
// matte, and only the windows are warm. Reference: a generated mockup (cubic blue house
// on a midnight-blue background, amber glazing). The style does not tell of materials: a single
// hue, barely marked relief, and it is the LIGHT of the windows that makes the contrast. The
// day is a bright "blue hour", never a white noon — that is what keeps it readable at any
// hour where candy and cyberpunk only hold for part of the day.

const PALETTE: PaletteSpec = {
  wall: '#4a63c4',
  wallInterior: '#7288d8',
  floor: '#5b6fc0',
  floors: { wood: '#6f7fcf', tile: '#7d8fd6', carpet: '#6a78c4', concrete: '#6474c6' },
  // the glazing is the only WARM element of the palette: it is what lights up at night
  glass: '#f6e7cf',
  roof: '#3f57bc',
  terrain: '#33438f',
  zones: {
    lawn: '#3c5a94', pool: '#66d2ff', driveway: '#3f51a3', path: '#5a6ec0',
    bed: '#2f3f8a', terrace: '#6379cc', other: '#4353a6',
  },
  slat: '#a5b4ec',
  device: '#b3beee',
}

/** An almost smooth material: the procedural relief is there to catch the light, not to be seen. */
const matte = (texture: SurfaceLooks['wall']['texture'], roughness = 0.85) => ({ texture, roughness, relief: 0.3 })

const SURFACES: SurfaceLooks = {
  wall: matte('plaster'),
  wallInterior: matte('plaster', 0.9),
  floor: matte('concrete'),
  floors: { wood: matte('wood', 0.7), tile: matte('tile', 0.6), carpet: matte('carpet', 1), concrete: matte('concrete') },
  roof: matte('plaster', 0.8),
  terrain: matte('grass', 1),
  zones: {
    lawn: matte('grass', 1),
    pool: { texture: 'water', roughness: 0.08, metalness: 0.3 },
    driveway: matte('concrete'),
    path: matte('pavers'),
    bed: matte('soil', 1),
    terrace: matte('pavers', 0.8),
    other: matte('concrete'),
  },
}

const SKY_NIGHT = { zenith: [0.004, 0.006, 0.03], horizon: [0.02, 0.03, 0.1], ground: [0.006, 0.008, 0.03], sunGlare: 3, sunColor: [0.75, 0.82, 1] } as const
/** The day stays a blue hour: the sky brightens, it does not turn white. */
const SKY_DAY = { zenith: [0.12, 0.18, 0.55], horizon: [0.36, 0.44, 0.82], ground: [0.06, 0.08, 0.26], sunGlare: 8, sunColor: [0.95, 0.96, 1] } as const
/** Twilight adds a magenta edge, like the pink rim of the reference. */
const DUSK_HORIZON = [0.6, 0.28, 0.6] as const

export const indigoStyle: RenderStyle = {
  id: 'indigo',
  labelKey: 'render.styles.indigo',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a)
    const dusk = duskFactor(a)
    const clear = 1 - a.cloudiness
    return {
      palette: toPalette(PALETTE),
      surfaces: SURFACES,
      // the windows light up with the night: it is the only place where the warm color appears
      glass: { opacity: mix(0.55, 0.35, day), roughness: 0.1, metalness: 0.05, emissive: mix(0.7, 0, day) },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        horizon: mixRgb(mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day), DUSK_HORIZON, dusk * 0.5 * clear),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day) * clear,
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: mix(1.1, 1.2, day),
      },
      lighting: {
        // a COLD light at every hour: warmth is reserved for the windows and the lamps
        sunColor: new Color(0xb4c4ff).lerp(new Color(0xe6ebff), day).lerp(new Color(0xffb0d8), dusk * 0.5 * clear),
        sunIntensity: mix(1.0, 2.2, day) * mix(0.5, 1, clear),
        hemiSky: new Color(0x4a5fc0).lerp(new Color(0xb9c6ff), day),
        hemiGround: new Color(0x1a2050).lerp(new Color(0x3a4a9a), day),
        hemiIntensity: mix(0.95, 0.8, day) * mix(1.4, 1, clear),
        ambientIntensity: mix(0.16, 0.12, day),
        shadowOpacity: mix(0.6, 0.9, day) * clear,
      },
      post: {
        toneMapping: 'agx',                              // soft: it keeps the blue blue instead of pushing it to cyan
        exposure: mix(1.25, 1.0, day),
        bloom: { strength: mix(0.9, 0.3, day), radius: 0.6, threshold: mix(0.7, 0.95, day) },
        ao: { intensity: 1.0, radius: 0.5 },
        vignette: mix(0.4, 0.25, day),
      },
      glow: { scale: mix(1.3, 1, day), opacity: mix(0.7, 0.25, day), lightIntensity: mix(14, 6, day), emissive: mix(2.4, 1.4, day) },
    }
  },
}
