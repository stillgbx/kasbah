import { h, type FunctionalComponent } from 'vue'
import type { IconAliases, IconProps, IconSet } from 'vuetify'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import type { IconName } from '../lib/strokeIcons'

// Jeu d'icônes Vuetify adossé au jeu « trait » (lib/strokeIcons.ts) : <v-icon icon="light" /> rend
// exactement le même glyphe que <StrokeIcon name="light" />. Une seule source pour toute l'app.

const StrokeIconSet: FunctionalComponent<IconProps> = (props) =>
  h(props.tag, [h(StrokeIcon, { name: props.icon as IconName, size: '100%' })])
StrokeIconSet.props = ['icon', 'tag'] // déclarés : ils ne doivent pas retomber en attributs DOM

export const strokeIcons: IconSet = { component: StrokeIconSet }

/** Alias internes de Vuetify ($dropdown, $clear…) atteignables depuis les composants utilisés ici. */
export const aliases: Partial<IconAliases> = {
  complete: 'check', cancel: 'close', close: 'close', delete: 'close', clear: 'close',
  success: 'checkCircle', info: 'info', warning: 'alert', error: 'alert',
  prev: 'back', next: 'chevron', expand: 'chevronDown', collapse: 'chevronUp',
  dropdown: 'chevronDown', subgroup: 'chevronDown', menu: 'list', unfold: 'unfold',
  sortAsc: 'arrowUp', sortDesc: 'arrowDown', plus: 'plus', minus: 'minus', eyeDropper: 'eyedropper',
} satisfies Partial<Record<keyof IconAliases, IconName>>
