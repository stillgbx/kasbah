import type { Theme } from './index'

// Night Owl and Light Owl by Sarah Drasner (github.com/sdras/night-owl-vscode-theme). The dark
// surface steps reuse the theme's deep blues (#011627 → #0b2942 → #1d3b53 → #234d70).
// The secondary text is the comment color of each variant (#989fb1, #637777), darkened or
// lightened at equal hue up to 4.5:1 on the surface and the background: the original fell to
// 2.3-3.2.
export const nightOwl = {
  id: 'night-owl',
  label: 'Night Owl',
  lightLabel: 'Light Owl',
  darkLabel: 'Night Owl',
  light: {
    bg: '#f0f0f0', surface: '#fbfbfb', surface2: '#f0f0f0', bright: '#ffffff',
    text: '#403f53', muted: '#656c7c', accent: '#0c969b',
    error: '#de3d3b', warning: '#daaa01', info: '#4876d6', success: '#2aa298',
    catLight: '#daaa01', catCover: '#2aa298', catCamera: '#994cc3', catMedia: '#4876d6',
  },
  dark: {
    bg: '#011627', surface: '#0b2942', surface2: '#1d3b53', bright: '#234d70',
    text: '#d6deeb', muted: '#7f9494', accent: '#7fdbca',
    error: '#ef5350', warning: '#ecc48d', info: '#82aaff', success: '#addb67',
    catLight: '#ecc48d', catCover: '#addb67', catCamera: '#c792ea', catMedia: '#82aaff',
  },
} as const satisfies Theme
