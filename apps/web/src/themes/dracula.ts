import type { Theme } from './index'

// Dracula and its official light counterpart Alucard (draculatheme.com/spec). Both palettes only
// publish the editor background: the surface steps are neighboring shades. The dark secondary
// text is the "comment" blue (#6272a4) lightened at equal hue: the original fell to 3:1 on the
// surface, below the 4.5:1 required of text that carries information.
export const dracula = {
  id: 'dracula',
  label: 'Dracula',
  lightLabel: 'Alucard',
  darkLabel: 'Dracula',
  light: {
    bg: '#f7f2de', surface: '#fffbeb', surface2: '#f2edd8', bright: '#ffffff',
    text: '#1f1f1f', muted: '#6c664b', accent: '#644ac9',
    error: '#cb3a2a', warning: '#846e15', info: '#036a96', success: '#14710a',
    catLight: '#846e15', catCover: '#14710a', catCamera: '#a3144d', catMedia: '#036a96',
  },
  dark: {
    bg: '#21222c', surface: '#282a36', surface2: '#343746', bright: '#44475a',
    text: '#f8f8f2', muted: '#8192c6', accent: '#bd93f9',
    error: '#ff5555', warning: '#ffb86c', info: '#8be9fd', success: '#50fa7b',
    catLight: '#f1fa8c', catCover: '#50fa7b', catCamera: '#ff79c6', catMedia: '#8be9fd',
  },
} as const satisfies Theme
