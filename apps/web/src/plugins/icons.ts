import { h, type FunctionalComponent } from 'vue'
import type { IconAliases, IconProps, IconSet } from 'vuetify'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import type { IconName } from '../lib/strokeIcons'

// Vuetify icon set backed by the "stroke" set (lib/strokeIcons.ts): <v-icon icon="light" /> renders
// exactly the same glyph as <StrokeIcon name="light" />. A single source for the whole app.

const StrokeIconSet: FunctionalComponent<IconProps> = (props) =>
  h(props.tag, [h(StrokeIcon, { name: props.icon as IconName, size: '100%' })])
StrokeIconSet.props = ['icon', 'tag'] // declared: they must not fall back to DOM attributes

export const strokeIcons: IconSet = { component: StrokeIconSet }

/** Vuetify's internal aliases ($dropdown, $clear…) reachable from the components used here. */
export const aliases: Partial<IconAliases> = {
  complete: 'check', cancel: 'close', close: 'close', delete: 'close', clear: 'close',
  success: 'checkCircle', info: 'info', warning: 'alert', error: 'alert',
  prev: 'back', next: 'chevron', expand: 'chevronDown', collapse: 'chevronUp',
  dropdown: 'chevronDown', subgroup: 'chevronDown', menu: 'list', unfold: 'unfold',
  sortAsc: 'arrowUp', sortDesc: 'arrowDown', plus: 'plus', minus: 'minus', eyeDropper: 'eyedropper',
} satisfies Partial<Record<keyof IconAliases, IconName>>
