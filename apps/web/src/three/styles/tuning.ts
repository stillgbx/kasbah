import { NEUTRAL_TUNING, sceneTuningSchema, type SceneTuning } from '@kasbah/shared'
import type { PostLook, StyleLook } from './types'

// THE light TUNING BENCH. A style already says everything an hour is worth — exposure, bloom,
// lamp halo — but those numbers were found by eye, one lamp at a time, and the night ends up
// burning out: the bloom threshold catches the lit walls, the lamps' additive halo then goes
// through the bloom pass again, the selected room's outline is painted above 1.
// Rather than guessing a new set of numbers in the code, we tune them IN FRONT OF the house,
// live, and what we like is saved in the house (`house.render.tuning`).
//
// The CONTRACT of the setting (the fields, their bounds, the neutral one) lives in `@kasbah/shared` with the
// rest of the house; this file only keeps what concerns the screen alone: the bounds of the
// sliders, the presets, and the way a setting is applied to a style's look.

export { NEUTRAL_TUNING, type SceneTuning }

/** Bounds of the bench's sliders. The step states the useful fineness, not the precision of the number. */
export const TUNING_RANGES: Record<Exclude<keyof SceneTuning, 'toneMapping' | 'ringThrough'>, { min: number; max: number; step: number }> = {
  exposure: { min: 0.4, max: 2, step: 0.05 },
  bloomStrength: { min: 0, max: 2, step: 0.05 },
  bloomThreshold: { min: 0.5, max: 2.5, step: 0.05 },
  bloomRadius: { min: 0.3, max: 2, step: 0.05 },
  vignette: { min: 0, max: 2, step: 0.05 },
  glowOpacity: { min: 0, max: 1.5, step: 0.05 },
  glowScale: { min: 0.3, max: 2, step: 0.05 },
  lightIntensity: { min: 0.2, max: 2, step: 0.05 },
  emissive: { min: 0.2, max: 2, step: 0.05 },
  ringWidth: { min: 0.03, max: 0.4, step: 0.01 },
  ringBoost: { min: 0.3, max: 2, step: 0.05 },
  ringWhite: { min: 0, max: 1, step: 0.05 },
  ringOpacity: { min: 0, max: 1, step: 0.02 },
  fillOpacity: { min: 0, max: 0.5, step: 0.01 },
  tiltShift: { min: 0, max: 1, step: 0.05 },
  tiltCenter: { min: 0, max: 1, step: 0.02 },
  tiltWidth: { min: 0.02, max: 1, step: 0.02 },
  tiltPills: { min: 0, max: 1, step: 0.05 },
}

/**
 * Completes a partial setting (a field added since it was written) with the neutral values.
 * A DAMAGED local draft — out-of-bounds value, field from another era — goes back to neutral entirely
 * rather than bringing the view down: it is only a draft, and it is redone in three gestures.
 * The house file, for its part, is validated strictly by `houseSchema` like everything else.
 */
export const resolveTuning = (raw: unknown): SceneTuning => {
  const parsed = sceneTuningSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : NEUTRAL_TUNING
}

/** Whether two settings say the same thing. Used to recognize the current preset, and the neutral one. */
export const sameTuning = (a: SceneTuning, b: SceneTuning): boolean =>
  (Object.keys(NEUTRAL_TUNING) as (keyof SceneTuning)[]).every((k) => a[k] === b[k])

export interface TuningPreset {
  readonly id: string
  readonly tuning: SceneTuning
}

const preset = (id: string, tuning: Partial<SceneTuning>): TuningPreset => ({ id, tuning: { ...NEUTRAL_TUNING, ...tuning } })

// THE PRESETS. Four stances, not four variants of the same: each answers a different question
// asked of the same house. They all start from the same observation — the night of the `realistic` style
// makes the LIT walls bleed and not just the lamps (threshold 0.72 in linear), and the lamps' additive
// halo is counted twice since it goes through the bloom pass again.
export const TUNING_PRESETS: readonly TuningPreset[] = [
  // What we wanted: the same image, without the glare. The threshold rises until it only keeps
  // the true sources, the halo is halved (the bloom now does the work), the
  // outline becomes an outline again — thinner, barely above 1, it underlines instead of shouting.
  preset('soft', {
    exposure: 0.95, bloomStrength: 0.55, bloomThreshold: 1.45, bloomRadius: 0.85, vignette: 1.1,
    glowOpacity: 0.5, glowScale: 0.9, lightIntensity: 0.85, emissive: 0.8,
    ringWidth: 0.1, ringBoost: 0.95, ringWhite: 0.1, ringOpacity: 0.75, fillOpacity: 0.08,
  }),
  // AgX instead of ACES: an overexposure KEEPS ITS HUE instead of turning white. An amber
  // lamp stays amber at its core, the outline stays mauve. The curve is softer, hence darker:
  // the aperture opens by a third to compensate, and the vignette deepens — it is a photo.
  preset('cinema', {
    toneMapping: 'agx',
    exposure: 1.35, bloomStrength: 0.7, bloomThreshold: 1.25, bloomRadius: 1.15, vignette: 1.35,
    glowOpacity: 0.6, lightIntensity: 0.95, emissive: 0.9,
    ringWidth: 0.08, ringBoost: 1.05, ringWhite: 0.05, ringOpacity: 0.8, fillOpacity: 0.06,
    // a DISCREET tilt-shift: the sharp band covers the house, only the sky and the foreground
    // go soft — it is the blur of an open lens, not yet the miniature
    tiltShift: 0.45, tiltCenter: 0.52, tiltWidth: 0.3, tiltPills: 0.5,
  }),
  // For a screen in the entrance, in broad daylight, at one meter: almost no bloom, no vignette,
  // a sharp, opaque outline read at a glance. Here the house is a DASHBOARD, and what
  // matters is to see in one step which room is open — not the atmosphere.
  preset('plain', {
    exposure: 1.05, bloomStrength: 0.25, bloomThreshold: 1.8, bloomRadius: 0.8, vignette: 0.5,
    glowOpacity: 0.35, glowScale: 0.8, lightIntensity: 0.9, emissive: 0.7,
    ringWidth: 0.07, ringBoost: 0.9, ringWhite: 0, ringOpacity: 1, fillOpacity: 0.05,
  }),
  // The spirit of the maquette, kept: we want it to shine. Only the threshold rises — enough for the
  // wall to stop bleeding, not enough to put out the lamps, which even gain in diameter.
  preset('model', {
    bloomStrength: 0.9, bloomThreshold: 1.3, bloomRadius: 1.1,
    glowOpacity: 0.7, glowScale: 1.1,
    ringWidth: 0.12, ringBoost: 1.1, ringWhite: 0.15, ringOpacity: 0.9, fillOpacity: 0.12,
    // and there, the MINIATURE fully embraced: narrow band, frank blur, pills that follow — a house
    // photographed up close instead of a house seen from afar
    tiltShift: 0.85, tiltCenter: 0.5, tiltWidth: 0.16, tiltPills: 0.75,
  }),
]

/** The style's look, put through the bench. Modifies nothing: the scene keeps the right to recompute the look. */
export function applyTuning(look: StyleLook, t: SceneTuning): StyleLook {
  const post: PostLook = {
    toneMapping: t.toneMapping === 'style' ? look.post.toneMapping : t.toneMapping,
    exposure: look.post.exposure * t.exposure,
    bloom: look.post.bloom && {
      strength: look.post.bloom.strength * t.bloomStrength,
      radius: look.post.bloom.radius * t.bloomRadius,
      threshold: look.post.bloom.threshold * t.bloomThreshold,
    },
    ao: look.post.ao,
    vignette: look.post.vignette * t.vignette,
    ...(look.post.grade ? { grade: look.post.grade } : {}),
    // The tilt-shift comes from no style: it is born here. Off, the key is ABSENT and not `null` —
    // that is what keeps true the promise of the neutral setting: the style's look, identical.
    ...(t.tiltShift > 0 ? { tiltShift: { strength: t.tiltShift, center: t.tiltCenter, width: t.tiltWidth, pills: t.tiltPills } } : {}),
  }
  return {
    ...look,
    post,
    glow: {
      scale: look.glow.scale * t.glowScale,
      opacity: look.glow.opacity * t.glowOpacity,
      lightIntensity: look.glow.lightIntensity * t.lightIntensity,
      emissive: look.glow.emissive * t.emissive,
    },
  }
}
