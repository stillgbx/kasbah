import { Color } from 'three'
import { dayFactor, duskFactor, type SceneAmbience } from '../core/ambience'
import { hourGrade, mix, mixRgb, toPalette, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// The MAQUETTE style: a real house, at night, whose lamps make all the light.
//
// A point of method that explains almost all of this file: the palette is a palette of ALBEDOS,
// that is the color the material has in broad daylight, and it does NOT change with the hour. Before
// tone mapping arrived, the scene painted its walls dark gray to "make it night" — which
// gave dark gray walls in full sun as soon as a lamp came on. Now it is the
// LIGHT that makes the night (sun turned moon, almost black sky, raised exposure), and a white
// wall stays a white wall: it is simply very dimly lit. It is the only way to get both
// the warm pool of light of the maquette and a true noon.

const PALETTE: PaletteSpec = {
  wall: '#cfc9c0',
  wallInterior: '#dcd7cf',
  floor: '#b9b3a8',
  floors: { wood: '#a9825a', tile: '#cfd2cf', carpet: '#b6a4a6', concrete: '#b3b1ac' },
  glass: '#aac9d8',
  roof: '#6a6f76',
  terrain: '#5c7a4e',
  zones: {
    lawn: '#5c7a4e', pool: '#2f7f9e', driveway: '#8a8f96', path: '#b0a89c',
    bed: '#4a3a2c', terrace: '#bfae97', other: '#9a9a96',
  },
  slat: '#b8bcc0',
  device: '#6d747e',
}

const SURFACES: SurfaceLooks = {
  wall: { texture: 'plaster', roughness: 0.92 },
  wallInterior: { texture: 'plaster', roughness: 0.95 },
  floor: { texture: 'concrete', roughness: 0.9 },
  floors: {
    wood: { texture: 'wood', roughness: 0.45 },
    tile: { texture: 'tile', roughness: 0.35 },
    carpet: { texture: 'carpet', roughness: 1 },
    concrete: { texture: 'concrete', roughness: 0.9 },
  },
  roof: { texture: 'roof', roughness: 0.92 },
  terrain: { texture: 'grass', roughness: 1 },
  zones: {
    lawn: { texture: 'grass', roughness: 1 },
    // the water: smooth and a little metallic, that is what makes it catch the sky and the lamps
    pool: { texture: 'water', roughness: 0.06, metalness: 0.35 },
    driveway: { texture: 'concrete', roughness: 0.85 },
    path: { texture: 'pavers', roughness: 0.8 },
    bed: { texture: 'soil', roughness: 1 },
    terrace: { texture: 'pavers', roughness: 0.75 },
    other: { texture: 'concrete', roughness: 0.9 },
  },
}

// Night sky and day sky, in unbounded linear: the sun exceeds 1, and by far.
// The night sky is VERY dark, and that is not an ambience setting: it is the condition for
// the house to stand out. First attempt with a horizon at 0.03 — the background and the walls lit by
// the moon fell within two values of each other (41 versus 45 out of 255), and the house
// vanished into the sky. What one looks at at night is a light object on black.
const SKY_NIGHT = { zenith: [0.002, 0.003, 0.009], horizon: [0.012, 0.016, 0.032], ground: [0.001, 0.001, 0.002], sunGlare: 2.5, sunColor: [0.68, 0.78, 1] } as const
const SKY_DAY = { zenith: [0.18, 0.32, 0.62], horizon: [0.72, 0.80, 0.94], ground: [0.09, 0.09, 0.08], sunGlare: 16, sunColor: [1, 0.95, 0.86] } as const
/** What twilight ADDS to the horizon: the orange band, which no mix of the other two can produce. */
const DUSK_HORIZON = [0.85, 0.42, 0.20] as const

export const realisticStyle: RenderStyle = {
  id: 'realistic',
  labelKey: 'render.styles.realistic',
  assets: 'photo',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a)
    const dusk = duskFactor(a)
    const clear = 1 - a.cloudiness

    const horizon = mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day)
    return {
      palette: toPalette(PALETTE),
      surfaces: SURFACES,
      glass: { opacity: 0.28, roughness: 0.05, metalness: 0, emissive: 0 },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        // the warm band of sunset is laid ON the current horizon, it does not replace it
        horizon: mixRgb(horizon, DUSK_HORIZON, dusk * 0.7 * clear),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day) * clear,
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: mix(0.9, 1, day),
      },
      lighting: {
        // the moon is cold and weak; the grazing sun of sunset is frankly orange
        sunColor: new Color(0x9fb4e8).lerp(new Color(0xfff4e2), day).lerp(new Color(0xff9d52), dusk * 0.75 * clear),
        // The moon REALLY lights: it must set the house above the black of the sky, otherwise
        // only a silhouette is seen. The night contrast plays out between these two values.
        sunIntensity: mix(1.1, 2.8, day) * mix(0.35, 1, clear),
        // The night FILL is not an ambience detail: in `auto`, the moon falls where it
        // falls, and the faces being looked at can all be in shadow. Without a night sky that
        // really lights, the house no longer exists as soon as the source passes behind it.
        hemiSky: new Color(0x5d7099).lerp(new Color(0xbcd4f2), day),
        hemiGround: new Color(0x141a26).lerp(new Color(0x6a6455), day),
        hemiIntensity: mix(0.9, 0.55, day) * mix(1.6, 1, clear),
        ambientIntensity: mix(0.12, 0.08, day),
        // under an overcast sky, and under the moon, cast shadows soften
        shadowOpacity: mix(0.5, 1, day) * clear,
      },
      post: {
        toneMapping: 'aces',
        // the aperture opens at night: it, and not the color of the walls, is what makes the house readable
        exposure: mix(1.2, 0.9, day),
        bloom: {
          strength: mix(0.8, 0.22, day),
          radius: mix(0.55, 0.4, day),
          threshold: mix(0.72, 1, day),
        },
        // 60 cm: the scale of a ROOM's corners. Shorter, the occlusion only makes a thin line at the
        // foot of the walls; longer, it dirties the large flat surfaces.
        ao: { intensity: mix(1.1, 0.9, day), radius: 0.6 },
        vignette: mix(0.45, 0.18, day),
        grade: hourGrade(a),
      },
      glow: {
        scale: mix(1.2, 0.9, day),
        // The halo and the lamp were tuned WITHOUT tone mapping, for an image that never
        // overflowed: with the filmic curve, a lamp at 16 burned a whole wall section to pure white.
        // What matters is no longer the raw intensity, it is what remains after the curve.
        opacity: mix(0.6, 0.18, day),
        lightIntensity: mix(11, 5, day),
        emissive: mix(2.2, 1.2, day),
      },
    }
  },
}
