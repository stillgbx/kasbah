import { mirekToRgb, xyToRgb, type StateFor } from '@kasbah/shared'

// Tint of a light that is on, for the background of a list line — the equivalent of a player's cover art:
// we see at a glance the color (or the warmth of the white) and, by the gradient's
// intensity, the brightness. Off → nothing. Same fallback as in 3D (`markers.ts`): warm white ≈ 2700 K
// when the light says neither color nor temperature.

const DEFAULT_MIREK = 366

export function lightTintCss(s: StateFor<'light'>): string | undefined {
  if (!s.on || !s.available) return undefined
  const { r, g, b } = s.color ? xyToRgb(s.color.x, s.color.y) : mirekToRgb(s.colorTempMirek ?? DEFAULT_MIREK)
  const rgb = `${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}`
  // 18 % to 45 % opacity depending on brightness: a light at full blast colors strongly, a night light barely touches
  const alpha = 0.18 + 0.27 * ((s.brightness ?? 100) / 100)
  return `linear-gradient(90deg, rgba(${rgb}, ${alpha.toFixed(2)}) 0%, rgba(${rgb}, ${(alpha * 0.6).toFixed(2)}) 40%, rgba(${rgb}, 0) 75%)`
}
