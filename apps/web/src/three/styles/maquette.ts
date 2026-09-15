import { Color } from 'three'
import { dayFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixRgb, toPalette, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// MAQUETTE : le modèle blanc de l'architecte. Carton, balsa et flocage, tout est presque blanc et
// presque mat, et ce sont les OMBRES et l'occlusion qui dessinent les volumes — pas la couleur, pas
// la matière. C'est le style le plus lisible en plein jour (rien ne sature, rien ne brille) et le
// seul qui n'aura jamais besoin d'assets : sa finesse, c'est l'absence de détail. La nuit, la
// maquette reste posée sous une lampe de bureau, et ses lampes à elle font des taches chaudes.

const PALETTE: PaletteSpec = {
  wall: '#f2f0ea',
  wallInterior: '#f7f5f0',
  // les sols sont un ton sous les murs : sur du blanc, c'est ce ton qui sépare le plan de l'élévation
  floor: '#d8d3c8',
  floors: { wood: '#d4c8b2', tile: '#dddcd6', carpet: '#d6d0c8', concrete: '#d5d2cb' },
  glass: '#cfe3ee',
  roof: '#e9e6df',
  // le plateau : un gris-vert de carton-plume, pas une pelouse
  terrain: '#cdd1c2',
  zones: {
    lawn: '#c3cdb2', pool: '#a9d7e6', driveway: '#d1cfc6', path: '#d9d5c8',
    bed: '#c9c1b1', terrace: '#ddd7c8', other: '#d0cdc3',
  },
  slat: '#f4f2ec',
  // les objets connectés sont les seules pièces sombres : ils se lisent sur le blanc
  device: '#8c8c8c',
}

/** Un grain de carton : du relief très faible, une rugosité pleine. */
const board = (texture: SurfaceLooks['wall']['texture'], relief = 0.25) => ({ texture, roughness: 0.9, relief })

const SURFACES: SurfaceLooks = {
  wall: board('plaster'),
  wallInterior: board('plaster'),
  floor: board('concrete', 0.2),
  floors: { wood: { texture: 'wood', roughness: 0.8, relief: 0.3 }, tile: board('tile', 0.2), carpet: board('carpet', 0.3), concrete: board('concrete', 0.2) },
  roof: board('plaster'),
  // le plateau est du carton LISSE : le grain d'une pelouse, sur un aplat pâle, ne fait que du bruit
  terrain: board('plaster', 0.2),
  zones: {
    lawn: board('plaster', 0.2),
    pool: { texture: 'water', roughness: 0.15, metalness: 0.1, relief: 0.5 },
    driveway: board('concrete', 0.2),
    path: board('pavers', 0.3),
    bed: board('soil', 0.3),
    terrace: board('pavers', 0.3),
    other: board('concrete', 0.2),
  },
}

// Un ciel de STUDIO : gris neutre, sans azur — la maquette n'est pas dehors, elle est sur une table.
const SKY_NIGHT = { zenith: [0.01, 0.012, 0.02], horizon: [0.04, 0.045, 0.06], ground: [0.02, 0.02, 0.025], sunGlare: 3, sunColor: [1, 0.98, 0.95] } as const
const SKY_DAY = { zenith: [0.55, 0.6, 0.7], horizon: [0.9, 0.9, 0.9], ground: [0.35, 0.35, 0.34], sunGlare: 6, sunColor: [1, 0.98, 0.95] } as const

export const maquetteStyle: RenderStyle = {
  id: 'maquette',
  labelKey: 'render.styles.maquette',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a)
    return {
      palette: toPalette(PALETTE),
      surfaces: SURFACES,
      glass: { opacity: 0.3, roughness: 0.1, metalness: 0, emissive: mix(0.25, 0, day) },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        horizon: mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day),
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: 1.1,
      },
      lighting: {
        // la nuit, la lampe de bureau : une source blanche et franche, pas une lune bleue
        sunColor: new Color(0xd8dce6).lerp(new Color(0xfff8ee), day),
        sunIntensity: mix(1.0, 2.2, day),
        hemiSky: new Color(0x9aa4b8).lerp(new Color(0xe8ecf2), day),
        hemiGround: new Color(0x3a3c44).lerp(new Color(0xa8a49c), day),
        hemiIntensity: 0.9,
        ambientIntensity: mix(0.25, 0.3, day),
        // des ombres NETTES et pleines : sur une maquette blanche, ce sont elles qui dessinent
        shadowOpacity: 0.9,
      },
      post: {
        toneMapping: 'neutral',                          // le blanc doit rester blanc, pas crème
        // un blanc à 0,95 brûlait : murs et sols tombaient sur la même valeur, plus aucun volume
        exposure: mix(1.0, 0.72, day),
        bloom: { strength: mix(0.4, 0.05, day), radius: 0.5, threshold: 0.9 },
        // l'occlusion est le trait de crayon de ce style : forte, à l'échelle d'une pièce
        ao: { intensity: 1.4, radius: 0.5 },
        vignette: 0.15,
      },
      glow: { scale: mix(1.1, 0.8, day), opacity: mix(0.6, 0.15, day), lightIntensity: mix(9, 3, day), emissive: mix(1.8, 1, day) },
    }
  },
}
