import type { Theme } from './index'

// Tokyo Night d'Enkia, valeurs reprises de tokyonight.nvim (variantes `night` et `day`). Le texte
// du mode clair est un bleu et non un noir : c'est la signature de la déclinaison Day. Ce bleu
// (#3760bf) et `fg_dark` (#6172b0) sont foncés à teinte égale : sur le fond, ils tombaient à 4 et
// 3,2:1, sous le 4,5:1 d'un texte lisible.
export const tokyoNight = {
  id: 'tokyo-night',
  label: 'Tokyo Night',
  lightLabel: 'Day',
  darkLabel: 'Night',
  light: {
    bg: '#d0d5e3', surface: '#e1e2e7', surface2: '#d6dae6', bright: '#eef0f5',
    text: '#2349a6', muted: '#495894', accent: '#2e7de9',
    error: '#f52a65', warning: '#8c6c3e', info: '#007197', success: '#587539',
    catLight: '#8c6c3e', catCover: '#118c74', catCamera: '#9854f1', catMedia: '#007197',
  },
  dark: {
    bg: '#16161e', surface: '#1a1b26', surface2: '#292e42', bright: '#3b4261',
    text: '#c0caf5', muted: '#a9b1d6', accent: '#7aa2f7',
    error: '#f7768e', warning: '#e0af68', info: '#7dcfff', success: '#9ece6a',
    catLight: '#e0af68', catCover: '#1abc9c', catCamera: '#bb9af7', catMedia: '#7dcfff',
  },
} as const satisfies Theme
