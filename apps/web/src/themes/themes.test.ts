import { describe, expect, it } from 'vitest'
import { cssVars, DEFAULT_THEME_ID, onAccent, resolveVariant, THEME_LIST, themeById, type Palette } from './index'

// Registry guardrails: what a theme added tomorrow must respect.

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

describe('theme registry', () => {
  it('has unique identifiers and a default that exists', () => {
    const ids = THEME_LIST.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(DEFAULT_THEME_ID)
  })

  it('gives every theme at least one complete variant', () => {
    for (const t of THEME_LIST) {
      expect(t.light ?? t.dark, t.id).toBeTruthy()
      for (const p of [t.light, t.dark].filter((x): x is Palette => !!x)) {
        for (const role of ROLES) expect(p[role], `${t.id}.${role}`).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  it('always returns a variant, even when the theme lacks the requested one', () => {
    for (const t of THEME_LIST) {
      for (const wantDark of [false, true]) {
        const v = resolveVariant(t.id, wantDark)
        expect(v.palette, t.id).toBeTruthy()
        // The requested variant wins if it exists; otherwise the theme imposes its own.
        expect(v.isDark, `${t.id} ${wantDark}`).toBe(t.dark && (wantDark || !t.light) ? true : false)
      }
    }
    expect(themeById('inconnu').id).toBe(THEME_LIST[0]!.id)
  })

  it('puts readable text on the accent', () => {
    for (const t of THEME_LIST) {
      for (const p of [t.light, t.dark].filter((x): x is Palette => !!x)) {
        expect(contrast(p.accent, onAccent(p)), `${t.id} on-accent`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  // `muted` carries real information (device subtitles, search rows): it must
  // hold AA 4.5:1 like the main text, on the surface as on the page background.
  it('holds AA 4.5:1 for text and secondary text, on the surface and the background', () => {
    for (const t of THEME_LIST) {
      for (const [mode, p] of [['clair', t.light], ['sombre', t.dark]] as const) {
        if (!p) continue
        for (const role of ['text', 'muted'] as const) {
          for (const ground of ['surface', 'bg'] as const) {
            expect(contrast(p[role], p[ground]), `${t.id} ${mode} ${role}/${ground}`).toBeGreaterThanOrEqual(4.5)
          }
        }
      }
    }
  })

  it('produces all the CSS tokens that styles/tokens.css declares', () => {
    const declared = ['--bg', '--surface', '--surface2', '--text', '--muted', '--line', '--accent', '--accent-soft',
      '--on-accent', '--shadow', '--cat-light', '--cat-cover', '--cat-camera', '--cat-media', '--cat-other']
    expect(Object.keys(cssVars(resolveVariant(DEFAULT_THEME_ID, false).palette, false)).sort()).toEqual([...declared].sort())
  })
})
