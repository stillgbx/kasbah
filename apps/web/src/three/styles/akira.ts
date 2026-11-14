import { Color } from 'three'
import { dayFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixPalette, mixRgb, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// AKIRA: Neo-Tokyo 2019. Blue-gray concrete and wet asphalt that reflects the sky, and a single
// color that matters: Kaneda's red — windows, paths and interior partitions emit it. The
// cyan of the pool and the moon as a counterpoint, as in the film. At night, the horizon glows red
// (a burning city); by day, a clear image under a milky sky, where the red remains the vivid spot.
// The image is that of an '80s cel: crushed blacks, pushed colors, big halo.
// Kaneda's bike circles the house, its tail light trailing (`StyleLook.parade`).
// And DRAWN as a cel (`StyleLook.shading`): one step of sun — a face is lit or in shade, nothing in
// between — flat paint instead of concrete grain, thin blue-black lines. A cel's shade is a colour,
// never a grey: a face in shade only gets the sky and the ground (`hemiSky`, `hemiGround`), pushed
// toward violet by day. And the backlight line along the edges facing the moon (`PostLook.rim`).

const NIGHT: PaletteSpec = {
  wall: '#6e7888',
  wallInterior: '#6a2220',
  floor: '#2a2d36',
  floors: { wood: '#3a2420', tile: '#262a34', carpet: '#4a1a1c', concrete: '#2a2e38' },
  glass: '#ff3a20',
  roof: '#5a6070',
  terrain: '#3c414c',
  zones: {
    lawn: '#2a3832', pool: '#1fb5c8', driveway: '#383c46', path: '#d42a1a',
    bed: '#1a1416', terrace: '#2a2e38', other: '#22252e',
  },
  slat: '#5a6070',
  device: '#8a8f9a',
}

/**
 * The same neighborhood by day, as the film paints it: a BRIGHT image — pale concrete, grey-green
 * metal, sage verges — where the red keeps its strength. A first "noon smog" palette in mid greys
 * (terrain #5a5e66) made the whole day dark: the film's day scenes are not.
 */
const DAY: PaletteSpec = {
  wall: '#d2d6d2',
  wallInterior: '#d8ccc6',
  floor: '#a8acae',
  floors: { wood: '#a07a62', tile: '#b4bcbe', carpet: '#b0706a', concrete: '#aab0b2' },
  glass: '#c25a4e',                                     // the windows keep a red reflection: the signature stays on the house
  roof: '#a6b4b0',
  // the ground a step darker and greener than the buildings: the house stands out of it
  terrain: '#7a8a86',
  zones: {
    lawn: '#6f9068', pool: '#5ab8c4', driveway: '#8c969a', path: '#d0402e',
    bed: '#6a5a50', terrace: '#b8bebe', other: '#a4aaac',
  },
  slat: '#c4ccd0',
  device: '#c0c6ca',
}

const SURFACES: SurfaceLooks = {
  wall: { texture: 'concrete', roughness: 0.85, relief: 1.2 },
  // the rooms are lit red: the partition gives back part of it
  wallInterior: { texture: 'plaster', roughness: 0.8, emissive: 0.3 },
  floor: { texture: 'concrete', roughness: 0.6 },
  floors: {
    wood: { texture: 'wood', roughness: 0.6 },
    tile: { texture: 'tile', roughness: 0.4 },
    carpet: { texture: 'carpet', roughness: 0.9 },
    concrete: { texture: 'concrete', roughness: 0.6 },
  },
  roof: { texture: 'metal', roughness: 0.7, metalness: 0.1 },
  // the asphalt after rain: a little shine, not too much — a floor that reflects a black sky is black
  terrain: { texture: 'concrete', roughness: 0.6 },
  zones: {
    lawn: { texture: 'grass', roughness: 0.9 },
    pool: { texture: 'water', roughness: 0.03, metalness: 0.5, emissive: 0.3 },
    driveway: { texture: 'gloss', roughness: 0.45 },
    path: { texture: 'grid', roughness: 0.3, emissive: 0.6 },
    bed: { texture: 'soil', roughness: 1 },
    terrace: { texture: 'tile', roughness: 0.35, metalness: 0.2 },
    other: { texture: 'concrete', roughness: 0.6 },
  },
}

const SKY_NIGHT = { zenith: [0.006, 0.016, 0.03], horizon: [0.14, 0.025, 0.03], ground: [0.01, 0.006, 0.008], sunGlare: 5, sunColor: [0.6, 0.9, 1] } as const
const SKY_DAY = { zenith: [0.5, 0.52, 0.55], horizon: [0.85, 0.82, 0.78], ground: [0.08, 0.08, 0.09], sunGlare: 8, sunColor: [1, 0.96, 0.92] } as const

export const akiraStyle: RenderStyle = {
  id: 'akira',
  labelKey: 'render.styles.akira',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a)
    return {
      palette: mixPalette(NIGHT, DAY, day),
      surfaces: SURFACES,
      glass: { opacity: 0.45, roughness: 0.05, metalness: 0.3, emissive: mix(0.8, 0.05, day) },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        horizon: mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day),
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: mix(1.3, 1, day),
      },
      lighting: {
        // the moon is cyan, the sky that reflects the city is red: the film's two colors
        // The night is lit by the city (the red sky) and the moon, enough to READ the house: the film's
        // Neo-Tokyo is dark but alive, a first night (moon 1.2, sky 1, ambient 0.12) was murky
        sunColor: new Color(0x5a9cbc).lerp(new Color(0xf2efe8), day),
        sunIntensity: mix(1.7, 2, day),
        // by day the shade is the film's blue-green (the tank, the rooftops), never a grey
        hemiSky: new Color(0x7a2a34).lerp(new Color(0x9ec4c8), day),
        hemiGround: new Color(0x123446).lerp(new Color(0x3a4c50), day),
        hemiIntensity: mix(1.35, 0.9, day),
        ambientIntensity: mix(0.2, 0.16, day),
        shadowOpacity: mix(0.6, 0.9, day),
      },
      post: {
        toneMapping: 'aces',
        exposure: mix(1.6, 1.05, day),
        // by day only the lamps glow: the pale flat concrete would cross 0.9 and fog the drawing
        bloom: { strength: mix(1.3, 0.4, day), radius: 0.7, threshold: mix(0.5, 1.3, day) },
        ao: { intensity: mix(1.2, 0.8, day), radius: 0.35 },
        vignette: mix(0.6, 0.3, day),
        // the night cel: contrast, pushed red, strong saturation. The day is a CLEAR image: it no
        // longer crushes its blacks nor darkens its midtones (gamma < 1), which made the whole day dark
        grade: {
          lift: [0, 0, 0],
          gamma: mixRgb([0.97, 0.95, 0.96], [1.02, 1.02, 1.02], day),
          gain: mixRgb([1.08, 0.97, 0.96], [1.03, 1, 0.98], day),
          saturation: mix(1.25, 1.12, day),
        },
        // a cel's line is thin and dark blue, not a comic book's black stroke
        outline: { color: [0.006, 0.008, 0.022], strength: 0.75 },
        // the cel's backlight: a cyan moon line on the night edges, a pale one under the noon smog —
        // kept under the bloom threshold (0.5 by night, 0.9 by day): painted, it does not glow
        rim: { color: mixRgb([0.35, 0.95, 1.3], [0.9, 0.86, 0.8], day), strength: mix(0.42, 0.3, day), width: 3 },
      },
      shading: { bands: 1, flat: true },
      glow: { scale: mix(1.5, 1, day), opacity: mix(0.9, 0.3, day), lightIntensity: mix(16, 7, day), emissive: mix(2.6, 1.4, day) },
      parade: { kind: 'akira' },
      // garden: almost black foliage at night, red fruit and flowers that glow a little; sage and
      // blue-green leaves by day (they stayed black at noon too, and darkened the whole day)
      garden: {
        leaf: [[0x14201c, 0x5f8a6a], [0x1c1a1e, 0x4f7a64], [0x22181a, 0x7a9a6c]].map(([n, d]) => new Color(n).lerp(new Color(d), day)),
        bark: new Color(0x0c0c0e).lerp(new Color(0x6a5a4c), day),
        stone: new Color(0x2a2e36).lerp(new Color(0x9aa0a2), day),
        accent: new Color(0xff2a1a),
        emissive: mix(0.15, 0, day),
      },
    }
  },
}
