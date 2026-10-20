import { describe, expect, it } from 'vitest'
import { defaultLook, hourGrade, NEUTRAL_GRADE, styleById } from './index'
import { applyTuning, NEUTRAL_TUNING, resolveTuning, sameTuning, TUNING_PRESETS, TUNING_RANGES } from './tuning'
import { resolveAmbience } from '../core/ambience'

describe('time-of-day grading', () => {
  const dusk = resolveAmbience({ mode: 'dusk' })                       // grazing sun in the WEST
  it('neutral in broad daylight and in the dead of night', () => {
    expect(hourGrade(resolveAmbience({ mode: 'day' }))).toEqual(NEUTRAL_GRADE)
    expect(hourGrade(resolveAmbience({ mode: 'night' }))).toEqual(NEUTRAL_GRADE)
  })
  it('orange at sunset, bluish at dawn, toned down under an overcast sky', () => {
    const evening = hourGrade(dusk)
    expect(evening.gain[0]).toBeGreaterThan(1)
    expect(evening.gain[2]).toBeLessThan(1)
    const dawn = hourGrade({ ...dusk, sunAzimuthDeg: 80 })
    expect(dawn.gain[2]).toBeGreaterThan(1)
    expect(dawn.gain[0]).toBeLessThan(1)
    const overcast = hourGrade({ ...dusk, cloudiness: 1 })
    expect(overcast.gain[0]).toBeLessThan(evening.gain[0])
    expect(overcast.gain[0]).toBeGreaterThan(1)
  })
  it('the bench passes it on as is', () => {
    const look = styleById('realistic').look(dusk)
    expect(applyTuning(look, NEUTRAL_TUNING).post.grade).toEqual(look.post.grade)
  })
})

describe('light tuning bench', () => {
  it('changes nothing at the neutral setting', () => {
    const look = defaultLook()
    expect(applyTuning(look, NEUTRAL_TUNING)).toEqual(look)
  })

  it('multiplies the image chain and the halo, without touching the rest of the look', () => {
    const look = defaultLook()
    const out = applyTuning(look, { ...NEUTRAL_TUNING, exposure: 0.5, bloomThreshold: 1.4, glowOpacity: 0.5, toneMapping: 'agx' })
    expect(out.post.exposure).toBeCloseTo(look.post.exposure * 0.5)
    expect(out.post.bloom!.threshold).toBeCloseTo(look.post.bloom!.threshold * 1.4)
    expect(out.post.bloom!.strength).toBe(look.post.bloom!.strength)
    expect(out.glow.opacity).toBeCloseTo(look.glow.opacity * 0.5)
    expect(out.post.toneMapping).toBe('agx')
    // the palette, the materials and the lighting are not the bench's business
    expect(out.palette).toBe(look.palette)
    expect(out.lighting).toBe(look.lighting)
    expect(look.post.exposure).toBe(defaultLook().post.exposure)   // the style's look is not modified
  })

  it('completes a partial setting, and returns the neutral one for a damaged draft', () => {
    expect(resolveTuning(null)).toEqual(NEUTRAL_TUNING)
    expect(resolveTuning({ exposure: 0.8 })).toEqual({ ...NEUTRAL_TUNING, exposure: 0.8 })
    // out of bounds: the whole draft is thrown away rather than bringing the view down
    expect(resolveTuning({ exposure: Number.NaN, ringThrough: false })).toEqual(NEUTRAL_TUNING)
    expect(resolveTuning({ ringWidth: 12 })).toEqual(NEUTRAL_TUNING)
  })

  it('adds the tilt-shift pass only if it has something to do', () => {
    const look = defaultLook()
    expect(applyTuning(look, NEUTRAL_TUNING).post.tiltShift).toBeUndefined()
    const on = applyTuning(look, { ...NEUTRAL_TUNING, tiltShift: 0.8, tiltWidth: 0.2, tiltPills: 0.5 })
    expect(on.post.tiltShift).toEqual({ strength: 0.8, center: 0.5, width: 0.2, pills: 0.5 })
  })

  it('the presets are complete, distinct, and within the sliders\' bounds', () => {
    expect(new Set(TUNING_PRESETS.map((p) => p.id)).size).toBe(TUNING_PRESETS.length)
    for (const p of TUNING_PRESETS) {
      // a preset is never the neutral one: it would then have the same effect as "Reset"
      expect(sameTuning(p.tuning, NEUTRAL_TUNING)).toBe(false)
      expect(resolveTuning(p.tuning)).toEqual(p.tuning)
      for (const [key, range] of Object.entries(TUNING_RANGES)) {
        const v = p.tuning[key as keyof typeof TUNING_RANGES]
        expect(v, `${p.id}.${key}`).toBeGreaterThanOrEqual(range.min)
        expect(v, `${p.id}.${key}`).toBeLessThanOrEqual(range.max)
      }
    }
  })
})
