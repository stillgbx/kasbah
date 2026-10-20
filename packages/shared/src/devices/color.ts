// Pure color conversions: CIE xy (canonical, native Hue) ↔ sRGB ↔ HSV, mirek ↔ kelvin.
// The gamut is not constrained (the bridges correct it themselves); values are clamped.

export interface RGB { r: number; g: number; b: number }   // 0..1
export interface HSV { h: number; s: number; v: number }   // h 0..360, s/v 0..1

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function gammaEncode(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}
function gammaDecode(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** xy (+ luminance Y, default 1) → sRGB normalized on the max channel. */
export function xyToRgb(x: number, y: number, Y = 1): RGB {
  if (y <= 0) return { r: 0, g: 0, b: 0 }
  const z = 1 - x - y
  const X = (Y / y) * x
  const Z = (Y / y) * z
  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.011530
  const max = Math.max(r, g, b, 1e-9)
  r /= max; g /= max; b /= max
  return { r: clamp01(gammaEncode(clamp01(r))), g: clamp01(gammaEncode(clamp01(g))), b: clamp01(gammaEncode(clamp01(b))) }
}

export function rgbToXy(rgb: RGB): { x: number; y: number } {
  const r = gammaDecode(clamp01(rgb.r)), g = gammaDecode(clamp01(rgb.g)), b = gammaDecode(clamp01(rgb.b))
  const X = r * 0.664511 + g * 0.154324 + b * 0.162028
  const Y = r * 0.283881 + g * 0.668433 + b * 0.047685
  const Z = r * 0.000088 + g * 0.072310 + b * 0.986039
  const sum = X + Y + Z
  if (sum === 0) return { x: 0.3127, y: 0.3290 } // white D65
  return { x: X / sum, y: Y / sum }
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const c = v * s
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = v - c
  return { r: r + m, g: g + m, b: b + m }
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export const hsvToXy = (hsv: HSV) => rgbToXy(hsvToRgb(hsv))
export const xyToHsv = (x: number, y: number) => rgbToHsv(xyToRgb(x, y))

export const mirekToKelvin = (mirek: number) => Math.round(1_000_000 / mirek)
export const kelvinToMirek = (kelvin: number) => Math.round(1_000_000 / kelvin)

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}
export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return { r: 1, g: 1, b: 1 }
  return { r: parseInt(m[1]!, 16) / 255, g: parseInt(m[2]!, 16) / 255, b: parseInt(m[3]!, 16) / 255 }
}

/** Warm/cool white approximation of a temperature (mirek) in sRGB (Tanner Helland's algorithm). */
export function mirekToRgb(mirek: number): RGB {
  const k = Math.min(6500, Math.max(2000, mirekToKelvin(mirek))) / 100
  const r = k <= 66 ? 1 : clamp01(1.2929 * Math.pow(k - 60, -0.1332))
  const g = k <= 66 ? clamp01(0.39 * Math.log(k) - 0.6318) : clamp01(1.1298 * Math.pow(k - 60, -0.0755))
  const b = k >= 66 ? 1 : k <= 19 ? 0 : clamp01(0.5432 * Math.log(k - 10) - 1.1963)
  return { r, g, b }
}
