import { Color } from 'three'
import { dayFactor, duskFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixPalette, mixRgb, type GradeLook, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// MIAMI'26: a Florida beach house in the colors of the Miami '26 editor themes (see
// themes/miami26.ts), in two moods that share their materials and differ by their colors.
// - BAY, the noon waterfront: lavender and peach stucco, aqua pool, a soft pastel blue sky, a
//   lavender-pink sunset; at night, aqua neon with pink windows as the counterpoint.
// - SUNSET, the golden hour: pink stucco, an orange-to-pink horizon under a purple zenith, warm
//   light, pushed saturation; at night, magenta partitions and paths, periwinkle windows, cyan pool.

type Rgb = readonly [number, number, number]
type Sky = { zenith: Rgb; horizon: Rgb }

interface Mood {
  night: PaletteSpec
  day: PaletteSpec
  sky: { night: Sky & { ground: Rgb }; day: Sky & { ground: Rgb }; dusk: Sky & { sun: Rgb } }
  /** The orange sun turns a green lawn brown: at the sunset, the grass leans toward this color. */
  duskGrass: number
  /** Sun, hemisphere sky and ground: night, day, then the sunset tint for the first two. */
  sun: [number, number, number]
  hemiSky: [number, number, number]
  hemiGround: [number, number]
  /** Grading gain at night, by day and at the sunset; blacks lift at night. */
  gain: { night: Rgb; day: Rgb; dusk: Rgb }
  lift: Rgb
  saturation: number
  garden: { night: [number, number, number]; day: [number, number, number]; accent: number }
}

const SURFACES: SurfaceLooks = {
  wall: { texture: 'plaster', roughness: 0.85, relief: 0.8 },
  // the rooms are lit in neon at night: the partition gives part of it back
  wallInterior: { texture: 'plaster', roughness: 0.8, emissive: 0.3 },
  floor: { texture: 'tile', roughness: 0.4 },
  floors: {
    wood: { texture: 'wood', roughness: 0.55 },
    tile: { texture: 'tile', roughness: 0.3 },
    carpet: { texture: 'carpet', roughness: 0.9 },
    concrete: { texture: 'concrete', roughness: 0.6 },
  },
  roof: { texture: 'roof', roughness: 0.75 },
  // a watered lawn all around: the green that sets the stucco off
  terrain: { texture: 'grass', roughness: 0.9 },
  zones: {
    lawn: { texture: 'grass', roughness: 0.9 },
    pool: { texture: 'water', roughness: 0.03, metalness: 0.4, emissive: 0.35 },
    driveway: { texture: 'concrete', roughness: 0.55 },
    path: { texture: 'pavers', roughness: 0.4, emissive: 0.5 },
    bed: { texture: 'soil', roughness: 1 },
    terrace: { texture: 'tile', roughness: 0.3 },
    other: { texture: 'concrete', roughness: 0.6 },
  },
}

const BAY: Mood = {
  night: {
    wall: '#2a3a5e',
    wallInterior: '#2ed3c6',
    floor: '#182238',
    floors: { wood: '#2a2a38', tile: '#1c2a40', carpet: '#2a2446', concrete: '#1e2a3c' },
    glass: '#ff9cc2',
    roof: '#24324e',
    terrain: '#145a50',
    zones: {
      lawn: '#186050', pool: '#00e5d4', driveway: '#1e2a3c', path: '#8fe9e1',
      bed: '#101820', terrace: '#2a2a3a', other: '#1c2434',
    },
    slat: '#4a6a8a',
    device: '#8aa0b8',
  },
  day: {
    wall: '#b9a6ff',
    wallInterior: '#f6c6b4',
    floor: '#e6e2da',
    floors: { wood: '#b08a64', tile: '#eef0ee', carpet: '#c8c0e0', concrete: '#d6d6d2' },
    glass: '#a8e8ec',
    roof: '#eef2f6',
    terrain: '#5fae7a',
    zones: {
      lawn: '#4fae74', pool: '#2ed3c6', driveway: '#e4e6ea', path: '#f2c2a8',
      bed: '#5a4a3a', terrace: '#a07a5a', other: '#d4d6d8',
    },
    slat: '#ffffff',
    device: '#e4e8ee',
  },
  sky: {
    night: { zenith: [0.005, 0.012, 0.04], horizon: [0.05, 0.12, 0.25], ground: [0.005, 0.01, 0.015] },
    day: { zenith: [0.25, 0.45, 0.85], horizon: [0.6, 0.75, 0.95], ground: [0.1, 0.11, 0.1] },
    dusk: { zenith: [0.3, 0.25, 0.55], horizon: [1.0, 0.6, 0.7], sun: [1, 0.7, 0.6] },
  },
  duskGrass: 0x2fb89a,
  sun: [0x9ad8ff, 0xfff6e6, 0xffb090],
  hemiSky: [0x2a4a8a, 0xb8d8ff, 0xff9ac0],
  hemiGround: [0x0a3a40, 0xd8e8d8],
  gain: { night: [0.96, 1, 1.08], day: [0.98, 1, 1.04], dusk: [1.06, 0.97, 1] },
  lift: [0, 0.01, 0.03],
  saturation: 1.12,
  garden: { night: [0x0f3a40, 0x123a4a, 0x16402e], day: [0x3f9a8a, 0x2f8a6a, 0x6abf8a], accent: 0xff9e7a },
}

const SUNSET: Mood = {
  night: {
    wall: '#4a2a5e',
    wallInterior: '#ff4fa3',
    floor: '#2a1838',
    floors: { wood: '#3a2238', tile: '#2c1f44', carpet: '#4a1a46', concrete: '#2a2240' },
    glass: '#8e9bff',
    roof: '#3a2450',
    // greener than it needs to be at night: the sunset blends it with the day's green
    terrain: '#145a40',
    zones: {
      lawn: '#1a5a40', pool: '#00e0e8', driveway: '#2a2240', path: '#ff2e93',
      bed: '#1a1020', terrace: '#3a2450', other: '#241a34',
    },
    slat: '#6a4a8a',
    device: '#9a8ab0',
  },
  day: {
    wall: '#f2aebb',
    wallInterior: '#bfe8dc',
    floor: '#e8dccb',
    floors: { wood: '#c49a6c', tile: '#f2ebe0', carpet: '#e7b0b8', concrete: '#d8d0c4' },
    glass: '#7fd8e0',
    roof: '#f6efe4',
    terrain: '#6fae5a',
    zones: {
      lawn: '#4fb36a', pool: '#19d3d0', driveway: '#e9e1d6', path: '#f2a7a0',
      bed: '#6b4a3a', terrace: '#f0e4d4', other: '#d8cfc2',
    },
    slat: '#ffffff',
    device: '#e8e4ea',
  },
  sky: {
    night: { zenith: [0.01, 0.006, 0.04], horizon: [0.25, 0.03, 0.18], ground: [0.01, 0.005, 0.015] },
    day: { zenith: [0.12, 0.35, 0.9], horizon: [0.75, 0.85, 0.95], ground: [0.12, 0.1, 0.08] },
    // overshoot above 1 on the horizon: it is what glows
    dusk: { zenith: [0.18, 0.06, 0.35], horizon: [1.6, 0.45, 0.25], sun: [1, 0.5, 0.25] },
  },
  duskGrass: 0x1fa88a,
  sun: [0x7ad8ff, 0xfff2dc, 0xff8a50],
  hemiSky: [0x6a2a8a, 0x9fd0ff, 0xff7ab0],
  hemiGround: [0x0a3040, 0xe8d8b8],
  gain: { night: [1.02, 0.96, 1.06], day: [1.05, 1, 0.95], dusk: [1.12, 0.94, 0.9] },
  lift: [0.015, 0, 0.035],
  saturation: 1.18,
  garden: { night: [0x0f4a3a, 0x123a44, 0x1a3a2a], day: [0x2f9e4f, 0x1f8a5a, 0x5cbf3a], accent: 0xff4fa3 },
}

const lerpHex = (a: number, b: number, t: number) => new Color(a).lerp(new Color(b), t)

function moodLook(m: Mood, a: SceneAmbience): StyleLook {
  const day = dayFactor(a)
  // an overcast sky has no sunset color
  const dusk = duskFactor(a) * (1 - 0.7 * a.cloudiness)
  const palette = mixPalette(m.night, m.day, day)
  const grass = new Color(m.duskGrass)
  palette.terrain.lerp(grass, dusk * 0.7)
  palette.zones.lawn.lerp(grass, dusk * 0.7)
  const { sky } = m
  const grade: GradeLook = {
    lift: mixRgb(m.lift, [0, 0, 0.01], day),
    gamma: [1.02, 1, 0.98],
    gain: mixRgb(mixRgb(m.gain.night, m.gain.day, day), m.gain.dusk, dusk),
    saturation: m.saturation + 0.07 * (1 - day) + 0.1 * dusk,
  }
  return {
    palette,
    surfaces: SURFACES,
    glass: { opacity: 0.4, roughness: 0.04, metalness: 0.25, emissive: mix(0.75, 0.03, day) },
    sky: {
      zenith: mixRgb(mixRgb(sky.night.zenith, sky.day.zenith, day), sky.dusk.zenith, dusk * 0.8),
      horizon: mixRgb(mixRgb(sky.night.horizon, sky.day.horizon, day), sky.dusk.horizon, dusk),
      ground: mixRgb(sky.night.ground, sky.day.ground, day),
      sunGlare: mix(4, 12, day),
      sunColor: mixRgb(mixRgb([0.6, 0.9, 1], [1, 0.95, 0.85], day), sky.dusk.sun, dusk),
      intensity: mix(1.3, 1.05, day),
    },
    lighting: {
      sunColor: lerpHex(m.sun[0], m.sun[1], day).lerp(new Color(m.sun[2]), dusk),
      sunIntensity: mix(0.8, 2.3, day),
      hemiSky: lerpHex(m.hemiSky[0], m.hemiSky[1], day).lerp(new Color(m.hemiSky[2]), dusk * 0.6),
      hemiGround: lerpHex(m.hemiGround[0], m.hemiGround[1], day),
      hemiIntensity: mix(0.9, 0.85, day),
      ambientIntensity: mix(0.1, 0.16, day),
      shadowOpacity: mix(0.55, 0.9, day),
    },
    post: {
      toneMapping: 'aces',
      exposure: mix(1.4, 1.05, day),
      bloom: { strength: mix(1.4, 0.35, day) + 0.3 * dusk, radius: 0.75, threshold: mix(0.5, 0.9, day) },
      ao: { intensity: 1.1, radius: 0.4 },
      vignette: mix(0.55, 0.3, day),
      grade,
    },
    glow: { scale: mix(1.5, 1, day), opacity: mix(0.95, 0.3, day), lightIntensity: mix(18, 7, day), emissive: mix(2.8, 1.4, day) },
    // garden: tropical greens by day, dark with glowing flowers at night
    garden: {
      leaf: m.garden.night.map((n, i) => lerpHex(n, m.garden.day[i]!, day)),
      bark: lerpHex(0x1a1420, 0x8a6a4a, day),
      stone: palette.zones.driveway.clone(),
      accent: new Color(m.garden.accent),
      emissive: mix(0.25, 0, day),
    },
  }
}

export const miamiBayStyle: RenderStyle = {
  id: 'miamiBay',
  labelKey: 'render.styles.miamiBay',
  look: (a) => moodLook(BAY, a),
}

export const miamiSunsetStyle: RenderStyle = {
  id: 'miamiSunset',
  labelKey: 'render.styles.miamiSunset',
  look: (a) => moodLook(SUNSET, a),
}
