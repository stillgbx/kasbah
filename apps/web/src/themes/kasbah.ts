import type { Theme } from './index'

// Palette d'origine du projet (maquette de référence, cf. doc/4_ui/4_0_langage-visuel.md), avec
// l'accent « Lagon » des quatre accents d'avant. C'est le thème par défaut.
export const kasbah = {
  id: 'kasbah',
  label: 'Kasbah',
  light: {
    bg: '#e9edf1', surface: '#ffffff', surface2: '#f2f5f8', bright: '#ffffff',
    text: '#141a22', muted: '#66717f', accent: '#1f6f78',
    error: '#d24a43', warning: '#d38b22', info: '#3f7fbf', success: '#4f7a4a',
    catLight: '#d18f0a', catCover: '#5b7086', catCamera: '#7a4fcf', catMedia: '#1a73d8',
  },
  dark: {
    bg: '#0d1420', surface: '#161e2d', surface2: '#1d2839', bright: '#243044',
    text: '#e8edf3', muted: '#8d9ab0', accent: '#4fb3bd',
    error: '#e57373', warning: '#e0a24a', info: '#7fb3e6', success: '#8cc27f',
    catLight: '#f0b429', catCover: '#97abbf', catCamera: '#ab8fff', catMedia: '#5aaeff',
  },
} as const satisfies Theme
