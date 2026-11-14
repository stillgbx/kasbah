import type { Theme } from './index'

// Miami'26, the palettes of the Miami '26 editor themes, version 1.1 (github.com/stillgbx/miami26-vscode,
// tools/generate-themes.js, the same as github.com/stillgbx/miami26-vs). BAY is the bay: deep water
// and a lilac blue sky at nightfall, mint water and sand in daylight, lavender palm trees and peach
// facades. SUNSET is dusk on the ocean front: magenta, peach horizon, plum palm trees, a violet sky.
// Mapping from the editor colors: bg = editor, surface = sidebar, surface2 = raised, bright =
// border (dark); in light, bg = sidebar and surface = raised, so the cards stand out from the page.
// info and the category tints come from the syntax colors.

export const miamiBay = {
  id: 'miamiBay',
  label: "Miami'26 Bay",
  light: {
    bg: '#d3eee8', surface: '#fef9f0', surface2: '#fbf3e6', bright: '#ffffff',
    text: '#1b3245', muted: '#45627e', accent: '#128079',
    error: '#c62d58', warning: '#a3561a', info: '#23689e', success: '#2a7f47',
    catLight: '#b04f2a', catCover: '#128079', catCamera: '#5853b5', catMedia: '#c2386c',
  },
  dark: {
    bg: '#102230', surface: '#1c2747', surface2: '#1f3448', bright: '#27405a',
    text: '#eaf4f2', muted: '#93afc2', accent: '#5fd6c6',
    error: '#ff6b8b', warning: '#f5c98f', info: '#8ec6ec', success: '#7edc9e',
    catLight: '#f5c98f', catCover: '#5fd6c6', catCamera: '#a9a6f0', catMedia: '#f2a0b4',
  },
} as const satisfies Theme

export const miamiSunset = {
  id: 'miamiSunset',
  label: "Miami'26 Sunset",
  light: {
    bg: '#f8d8e1', surface: '#fef4ec', surface2: '#fdebdb', bright: '#ffffff',
    text: '#2e1a3d', muted: '#6c5277', accent: '#c8287a',
    error: '#c42b3a', warning: '#7f5e00', info: '#4a56b8', success: '#2e7d4a',
    catLight: '#a64f18', catCover: '#4a56b8', catCamera: '#7a3d8c', catMedia: '#b83a28',
  },
  dark: {
    bg: '#231833', surface: '#2a1a3e', surface2: '#33244c', bright: '#3a2a58',
    text: '#f8eef4', muted: '#b3a3c8', accent: '#ff5faa',
    error: '#ff5c6c', warning: '#ffd27f', info: '#9aa6ff', success: '#7ee0a8',
    catLight: '#ffd27f', catCover: '#a9b4f5', catCamera: '#d6a2f2', catMedia: '#ff8a7a',
  },
} as const satisfies Theme
