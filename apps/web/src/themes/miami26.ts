import type { Theme } from './index'

// Miami'26, the palettes of the Miami '26 editor themes (github.com/stillgbx/miami26-vscode,
// tools/generate-themes.js, the same as github.com/stillgbx/miami26-vs). BAY is a day on the bay:
// turquoise water, sky blue, lavender towers, pink facades. SUNSET is dusk on the ocean front:
// magenta, sunset orange, gold, periwinkle buildings under a violet sky.
// Mapping from the editor colors: bg = editor, surface = sidebar, surface2 = raised, bright =
// border (dark); in light, bg = sidebar and surface = raised, so the cards stand out from the page.
// info and the category tints come from the syntax colors.

export const miamiBay = {
  id: 'miamiBay',
  label: "Miami'26 Bay",
  light: {
    bg: '#d8ecf0', surface: '#ebf6f6', surface2: '#e3f2f2', bright: '#ffffff',
    text: '#17323f', muted: '#45697a', accent: '#0b7f75',
    error: '#c62d58', warning: '#a3561a', info: '#1c65ad', success: '#2a7f47',
    catLight: '#f08a5d', catCover: '#0b7f75', catCamera: '#5e45c4', catMedia: '#bf2f68',
  },
  dark: {
    bg: '#0c1b26', surface: '#10222f', surface2: '#163040', bright: '#1c3a4d',
    text: '#e8f4f6', muted: '#8fb0c2', accent: '#2ed3c6',
    error: '#ff6b8b', warning: '#ffc98f', info: '#7cc4ff', success: '#7edc9e',
    catLight: '#ffc98f', catCover: '#2ed3c6', catCamera: '#b9a6ff', catMedia: '#ff9cc2',
  },
} as const satisfies Theme

export const miamiSunset = {
  id: 'miamiSunset',
  label: "Miami'26 Sunset",
  light: {
    bg: '#f4dee4', surface: '#fcf3ee', surface2: '#fbece4', bright: '#ffffff',
    text: '#2e1a3d', muted: '#74566f', accent: '#c2186a',
    error: '#c9392a', warning: '#845a00', info: '#434bb5', success: '#2e7d4a',
    catLight: '#b5561a', catCover: '#434bb5', catCamera: '#7235ad', catMedia: '#c9392a',
  },
  dark: {
    bg: '#15112a', surface: '#1b1634', surface2: '#241d42', bright: '#2e2652',
    text: '#f6eef6', muted: '#a99fc8', accent: '#ff4fa3',
    error: '#ff5c6c', warning: '#ffd27f', info: '#8e9bff', success: '#7ee0a8',
    catLight: '#ffd27f', catCover: '#a9b4f5', catCamera: '#d39bff', catMedia: '#ff7a5c',
  },
} as const satisfies Theme
