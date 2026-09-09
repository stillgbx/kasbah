import { mirekToRgb, xyToRgb, type StateFor } from '@kasbah/shared'

// Teinte d'une lampe allumée, pour le fond d'une ligne de liste — l'équivalent de la pochette d'un
// lecteur : on voit d'un coup d'œil la couleur (ou la chaleur du blanc) et, par l'intensité du
// dégradé, la luminosité. Éteinte → rien. Même repli qu'en 3D (`markers.ts`) : blanc chaud ≈ 2700 K
// quand la lampe ne dit ni couleur ni température.

const DEFAULT_MIREK = 366

export function lightTintCss(s: StateFor<'light'>): string | undefined {
  if (!s.on || !s.available) return undefined
  const { r, g, b } = s.color ? xyToRgb(s.color.x, s.color.y) : mirekToRgb(s.colorTempMirek ?? DEFAULT_MIREK)
  const rgb = `${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}`
  // 18 % à 45 % d'opacité selon la luminosité : une lampe à fond colore franchement, une veilleuse effleure
  const alpha = 0.18 + 0.27 * ((s.brightness ?? 100) / 100)
  return `linear-gradient(90deg, rgba(${rgb}, ${alpha.toFixed(2)}) 0%, rgba(${rgb}, ${(alpha * 0.6).toFixed(2)}) 40%, rgba(${rgb}, 0) 75%)`
}
