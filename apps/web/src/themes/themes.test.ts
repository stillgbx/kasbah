import { describe, expect, it } from 'vitest'
import { cssVars, DEFAULT_THEME_ID, onAccent, resolveVariant, THEME_LIST, themeById, type Palette } from './index'

// Garde-fous du registre : ce qu'un thème ajouté demain doit respecter.

const ROLES: (keyof Palette)[] = [
  'bg', 'surface', 'surface2', 'bright', 'text', 'muted', 'accent',
  'error', 'warning', 'info', 'success', 'catLight', 'catCover', 'catCamera', 'catMedia',
]

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)!
  const lin = (c: string) => {
    const v = parseInt(c, 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(m[1]!) + 0.7152 * lin(m[2]!) + 0.0722 * lin(m[3]!)
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe('registre des thèmes', () => {
  it('a des identifiants uniques et un défaut qui existe', () => {
    const ids = THEME_LIST.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(DEFAULT_THEME_ID)
  })

  it('donne à chaque thème au moins une variante complète', () => {
    for (const t of THEME_LIST) {
      expect(t.light ?? t.dark, t.id).toBeTruthy()
      for (const p of [t.light, t.dark].filter((x): x is Palette => !!x)) {
        for (const role of ROLES) expect(p[role], `${t.id}.${role}`).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  it('rend toujours une variante, même quand le thème n’a pas celle demandée', () => {
    for (const t of THEME_LIST) {
      for (const wantDark of [false, true]) {
        const v = resolveVariant(t.id, wantDark)
        expect(v.palette, t.id).toBeTruthy()
        // La variante demandée l'emporte si elle existe ; sinon le thème impose la sienne.
        expect(v.isDark, `${t.id} ${wantDark}`).toBe(t.dark && (wantDark || !t.light) ? true : false)
      }
    }
    expect(themeById('inconnu').id).toBe(THEME_LIST[0]!.id)
  })

  it('pose un texte lisible sur l’accent et le texte sur le fond', () => {
    for (const t of THEME_LIST) {
      for (const p of [t.light, t.dark].filter((x): x is Palette => !!x)) {
        expect(contrast(p.accent, onAccent(p)), `${t.id} on-accent`).toBeGreaterThanOrEqual(3)
        expect(contrast(p.text, p.surface), `${t.id} texte`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('produit tous les jetons CSS que styles/tokens.css déclare', () => {
    const declared = ['--bg', '--surface', '--surface2', '--text', '--muted', '--line', '--accent', '--accent-soft',
      '--on-accent', '--shadow', '--cat-light', '--cat-cover', '--cat-camera', '--cat-media', '--cat-other']
    expect(Object.keys(cssVars(resolveVariant(DEFAULT_THEME_ID, false).palette, false)).sort()).toEqual([...declared].sort())
  })
})
