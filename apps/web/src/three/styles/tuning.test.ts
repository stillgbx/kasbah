import { describe, expect, it } from 'vitest'
import { defaultLook, hourGrade, NEUTRAL_GRADE, styleById } from './index'
import { applyTuning, NEUTRAL_TUNING, resolveTuning, sameTuning, TUNING_PRESETS, TUNING_RANGES } from './tuning'
import { resolveAmbience } from '../core/ambience'

describe('étalonnage de l’heure', () => {
  const dusk = resolveAmbience({ mode: 'dusk' })                       // soleil rasant à l'OUEST
  it('neutre en plein jour et en pleine nuit', () => {
    expect(hourGrade(resolveAmbience({ mode: 'day' }))).toEqual(NEUTRAL_GRADE)
    expect(hourGrade(resolveAmbience({ mode: 'night' }))).toEqual(NEUTRAL_GRADE)
  })
  it('orangé au couchant, bleuté à l’aube, atténué sous un ciel couvert', () => {
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
  it('le banc le transmet tel quel', () => {
    const look = styleById('realistic').look(dusk)
    expect(applyTuning(look, NEUTRAL_TUNING).post.grade).toEqual(look.post.grade)
  })
})

describe('banc de réglage de la lumière', () => {
  it('ne change rien au réglage neutre', () => {
    const look = defaultLook()
    expect(applyTuning(look, NEUTRAL_TUNING)).toEqual(look)
  })

  it('multiplie la chaîne d’image et le halo, sans toucher au reste du look', () => {
    const look = defaultLook()
    const out = applyTuning(look, { ...NEUTRAL_TUNING, exposure: 0.5, bloomThreshold: 1.4, glowOpacity: 0.5, toneMapping: 'agx' })
    expect(out.post.exposure).toBeCloseTo(look.post.exposure * 0.5)
    expect(out.post.bloom!.threshold).toBeCloseTo(look.post.bloom!.threshold * 1.4)
    expect(out.post.bloom!.strength).toBe(look.post.bloom!.strength)
    expect(out.glow.opacity).toBeCloseTo(look.glow.opacity * 0.5)
    expect(out.post.toneMapping).toBe('agx')
    // la palette, les matières et l'éclairage ne sont pas du ressort du banc
    expect(out.palette).toBe(look.palette)
    expect(out.lighting).toBe(look.lighting)
    expect(look.post.exposure).toBe(defaultLook().post.exposure)   // le look du style n'est pas modifié
  })

  it('complète un réglage partiel, et rend le neutre d’un brouillon abîmé', () => {
    expect(resolveTuning(null)).toEqual(NEUTRAL_TUNING)
    expect(resolveTuning({ exposure: 0.8 })).toEqual({ ...NEUTRAL_TUNING, exposure: 0.8 })
    // hors bornes : le brouillon entier est jeté plutôt que de faire tomber la vue
    expect(resolveTuning({ exposure: Number.NaN, ringThrough: false })).toEqual(NEUTRAL_TUNING)
    expect(resolveTuning({ ringWidth: 12 })).toEqual(NEUTRAL_TUNING)
  })

  it('n’ajoute la passe de tilt-shift que si elle a quelque chose à faire', () => {
    const look = defaultLook()
    expect(applyTuning(look, NEUTRAL_TUNING).post.tiltShift).toBeUndefined()
    const on = applyTuning(look, { ...NEUTRAL_TUNING, tiltShift: 0.8, tiltWidth: 0.2, tiltPills: 0.5 })
    expect(on.post.tiltShift).toEqual({ strength: 0.8, center: 0.5, width: 0.2, pills: 0.5 })
  })

  it('les préréglages sont complets, distincts, et dans les bornes des curseurs', () => {
    expect(new Set(TUNING_PRESETS.map((p) => p.id)).size).toBe(TUNING_PRESETS.length)
    for (const p of TUNING_PRESETS) {
      // un préréglage n'est jamais le neutre : il aurait alors le même effet que « Réinitialiser »
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
