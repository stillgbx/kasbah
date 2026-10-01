import { resolveAmbience, type SceneAmbience } from '../core/ambience'
import { defaultUiTheme, resolveSceneTheme, type SceneTheme } from '../core/theme'
import { akiraStyle } from './akira'
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

// Le catalogue des styles de rendu. UNE ligne à ajouter pour en offrir un de plus, plus deux clés
// i18n (`scene.styles.<id>`) : ni la scène, ni les builders, ni les réglages ne connaissent la liste.

export const RENDER_STYLES: readonly RenderStyle[] = [realisticStyle, natureStyle, indigoStyle, maquetteStyle, cyberpunkStyle, candyStyle, hauntedStyle, discoStyle, halloweenStyle, noelStyle, tatooineStyle, akiraStyle]

/** Celui de la maquette, et le défaut de l'application. */
export const DEFAULT_STYLE_ID = realisticStyle.id

export function styleById(id: string | null | undefined): RenderStyle {
  return RENDER_STYLES.find((s) => s.id === id) ?? realisticStyle
}

/** L'ambiance de départ, avant qu'on sache où est la maison : la nuit de la maquette. */
export const defaultAmbience = (): SceneAmbience => resolveAmbience({ mode: 'night' })

/** Le rendu par défaut : le style de la maquette, à son heure de nuit. Valeur initiale, et des tests. */
export const defaultLook = () => realisticStyle.look(defaultAmbience())

/** Thème de scène par défaut (tests, et avant le premier rendu). */
export function defaultSceneTheme(): SceneTheme {
  const a = defaultAmbience()
  return resolveSceneTheme(defaultUiTheme(), realisticStyle.look(a).palette, a)
}

export * from './types'
