import type { Theme } from './index'

// Catppuccin (github.com/catppuccin) : Latte en clair, Mocha en sombre — les deux déclinaisons
// officielles aux extrémités des quatre parfums. Accent « mauve », la couleur emblématique.
export const catppuccin = {
  id: 'catppuccin',
  label: 'Catppuccin',
  lightLabel: 'Latte',
  darkLabel: 'Mocha',
  light: {
    bg: '#dce0e8', surface: '#eff1f5', surface2: '#e6e9ef', bright: '#ffffff',
    text: '#4c4f69', muted: '#6c6f85', accent: '#8839ef',
    error: '#d20f39', warning: '#df8e1d', info: '#1e66f5', success: '#40a02b',
    catLight: '#df8e1d', catCover: '#209fb5', catCamera: '#ea76cb', catMedia: '#1e66f5',
  },
  dark: {
    bg: '#181825', surface: '#1e1e2e', surface2: '#313244', bright: '#45475a',
    text: '#cdd6f4', muted: '#a6adc8', accent: '#cba6f7',
    error: '#f38ba8', warning: '#f9e2af', info: '#89b4fa', success: '#a6e3a1',
    catLight: '#f9e2af', catCover: '#74c7ec', catCamera: '#f5c2e7', catMedia: '#89b4fa',
  },
} as const satisfies Theme
