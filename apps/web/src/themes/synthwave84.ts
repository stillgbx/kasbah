import type { Theme } from './index'

// SynthWave '84 de Robb Owen (github.com/robb0wen/synthwave-vscode) : néon sur violet, SANS
// déclinaison claire — la tablette reste donc en sombre tant qu'il est choisi.
export const synthwave84 = {
  id: 'synthwave84',
  label: "Synthwave '84",
  darkLabel: 'Neon Dream',
  dark: {
    bg: '#241b2f', surface: '#262335', surface2: '#2a2139', bright: '#34294f',
    text: '#ffffff', muted: '#848bbd', accent: '#ff7edb',
    error: '#fe4450', warning: '#fede5d', info: '#36f9f6', success: '#72f1b8',
    catLight: '#fede5d', catCover: '#72f1b8', catCamera: '#ff8b39', catMedia: '#36f9f6',
  },
} as const satisfies Theme
