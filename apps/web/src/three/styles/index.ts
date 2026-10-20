import { resolveAmbience, type SceneAmbience } from '../core/ambience'
import { defaultUiTheme, resolveSceneTheme, type SceneTheme } from '../core/theme'
import { akiraStyle } from './akira'
import { girlyversaireStyle } from './girlyversaire'
import { candyStyle } from './candy'
import { cyberpunkStyle } from './cyberpunk'
import { discoStyle } from './disco'
import { halloweenStyle } from './halloween'
import { hauntedStyle } from './haunted'
import { indigoStyle } from './indigo'
import { maquetteStyle } from './maquette'
import { natureStyle } from './nature'
import { noelStyle } from './noel'
import { realisticStyle } from './realistic'
import { tatooineStyle } from './tatooine'
import type { RenderStyle } from './types'

// The catalog of render styles. ONE line to add to offer one more, plus two i18n keys
// (`scene.styles.<id>`): neither the scene, nor the builders, nor the settings know the list.

export const RENDER_STYLES: readonly RenderStyle[] = [realisticStyle, natureStyle, indigoStyle, maquetteStyle, cyberpunkStyle, candyStyle, hauntedStyle, discoStyle, halloweenStyle, noelStyle, tatooineStyle, akiraStyle, girlyversaireStyle]

/** The maquette's, and the application default. */
export const DEFAULT_STYLE_ID = realisticStyle.id

export function styleById(id: string | null | undefined): RenderStyle {
  return RENDER_STYLES.find((s) => s.id === id) ?? realisticStyle
}

/** The starting ambience, before we know where the house is: the maquette's night. */
export const defaultAmbience = (): SceneAmbience => resolveAmbience({ mode: 'night' })

/** The default render: the maquette style, at its night hour. Initial value, and for tests. */
export const defaultLook = () => realisticStyle.look(defaultAmbience())

/** Default scene theme (tests, and before the first render). */
export function defaultSceneTheme(): SceneTheme {
  const a = defaultAmbience()
  return resolveSceneTheme(defaultUiTheme(), realisticStyle.look(a).palette, a)
}

export * from './types'
