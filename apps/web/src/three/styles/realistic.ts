import { Color } from 'three'
import { dayFactor, duskFactor, type SceneAmbience } from '../core/ambience'
import { mix, mixRgb, toPalette, type PaletteSpec, type RenderStyle, type StyleLook, type SurfaceLooks } from './types'

// Le style de la MAQUETTE : une maison réelle, de nuit, dont les lampes font toute la lumière.
//
// Un point de méthode qui explique presque tout ce fichier : la palette est une palette d'ALBÉDOS,
// c'est-à-dire la couleur qu'a la matière en plein jour, et elle ne change PAS avec l'heure. Avant
// l'arrivée du tone mapping, la scène peignait ses murs en gris sombre pour « faire nuit » — ce qui
// donnait des murs gris sombre en plein soleil dès qu'une lampe s'allumait. Maintenant c'est la
// LUMIÈRE qui fait la nuit (soleil devenu lune, ciel presque noir, exposition relevée), et un mur
// blanc reste un mur blanc : il est simplement très peu éclairé. C'est la seule façon d'obtenir à la
// fois la flaque chaude de la maquette et un vrai midi.

const PALETTE: PaletteSpec = {
  wall: '#cfc9c0',
  wallInterior: '#dcd7cf',
  floor: '#b9b3a8',
  floors: { wood: '#a9825a', tile: '#cfd2cf', carpet: '#b6a4a6', concrete: '#b3b1ac' },
  glass: '#aac9d8',
  roof: '#6a6f76',
  terrain: '#5c7a4e',
  zones: {
    lawn: '#5c7a4e', pool: '#2f7f9e', driveway: '#8a8f96', path: '#b0a89c',
    bed: '#4a3a2c', terrace: '#bfae97', other: '#9a9a96',
  },
  slat: '#b8bcc0',
  device: '#6d747e',
}

const SURFACES: SurfaceLooks = {
  wall: { texture: 'plaster', roughness: 0.92 },
  wallInterior: { texture: 'plaster', roughness: 0.95 },
  floor: { texture: 'concrete', roughness: 0.9 },
  floors: {
    wood: { texture: 'wood', roughness: 0.45 },
    tile: { texture: 'tile', roughness: 0.35 },
    carpet: { texture: 'carpet', roughness: 1 },
    concrete: { texture: 'concrete', roughness: 0.9 },
  },
  roof: { texture: 'roof', roughness: 0.92 },
  terrain: { texture: 'grass', roughness: 1 },
  zones: {
    lawn: { texture: 'grass', roughness: 1 },
    // l'eau : lisse et un peu métallique, c'est ce qui fait qu'elle attrape le ciel et les lampes
    pool: { texture: 'water', roughness: 0.06, metalness: 0.35 },
    driveway: { texture: 'concrete', roughness: 0.85 },
    path: { texture: 'pavers', roughness: 0.8 },
    bed: { texture: 'soil', roughness: 1 },
    terrace: { texture: 'pavers', roughness: 0.75 },
    other: { texture: 'concrete', roughness: 0.9 },
  },
}

// Ciel de nuit et ciel de jour, en linéaire non borné : le soleil dépasse 1, et de loin.
// Le ciel de nuit est TRÈS sombre, et ce n'est pas un réglage d'ambiance : c'est la condition pour
// que la maison se détache. Premier essai avec un horizon à 0,03 — le fond et les murs éclairés par
// la lune tombaient à deux valeurs près l'une de l'autre (41 contre 45 sur 255), et la maison
// disparaissait dans le ciel. Ce qu'on regarde la nuit, c'est un objet clair sur du noir.
const SKY_NIGHT = { zenith: [0.002, 0.003, 0.009], horizon: [0.012, 0.016, 0.032], ground: [0.001, 0.001, 0.002], sunGlare: 2.5, sunColor: [0.68, 0.78, 1] } as const
const SKY_DAY = { zenith: [0.18, 0.32, 0.62], horizon: [0.72, 0.80, 0.94], ground: [0.09, 0.09, 0.08], sunGlare: 16, sunColor: [1, 0.95, 0.86] } as const
/** Ce que le crépuscule AJOUTE à l'horizon : la bande orange, qui ne s'obtient par aucun mélange des deux autres. */
const DUSK_HORIZON = [0.85, 0.42, 0.20] as const

export const realisticStyle: RenderStyle = {
  id: 'realistic',
  labelKey: 'render.styles.realistic',
  assets: 'photo',
  look(a: SceneAmbience): StyleLook {
    const day = dayFactor(a)
    const dusk = duskFactor(a)
    const clear = 1 - a.cloudiness

    const horizon = mixRgb(SKY_NIGHT.horizon, SKY_DAY.horizon, day)
    return {
      palette: toPalette(PALETTE),
      surfaces: SURFACES,
      glass: { opacity: 0.28, roughness: 0.05, metalness: 0, emissive: 0 },
      sky: {
        zenith: mixRgb(SKY_NIGHT.zenith, SKY_DAY.zenith, day),
        // la bande chaude du couchant se pose SUR l'horizon du moment, elle ne le remplace pas
        horizon: mixRgb(horizon, DUSK_HORIZON, dusk * 0.7 * clear),
        ground: mixRgb(SKY_NIGHT.ground, SKY_DAY.ground, day),
        sunGlare: mix(SKY_NIGHT.sunGlare, SKY_DAY.sunGlare, day) * clear,
        sunColor: mixRgb(SKY_NIGHT.sunColor, SKY_DAY.sunColor, day),
        intensity: mix(0.9, 1, day),
      },
      lighting: {
        // la lune est froide et faible ; le soleil rasant du couchant est franchement orange
        sunColor: new Color(0x9fb4e8).lerp(new Color(0xfff4e2), day).lerp(new Color(0xff9d52), dusk * 0.75 * clear),
        // La lune éclaire VRAIMENT : elle doit poser la maison au-dessus du noir du ciel, sans quoi
        // on ne voit qu'une silhouette. Le contraste de nuit se joue entre ces deux valeurs.
        sunIntensity: mix(1.1, 2.8, day) * mix(0.35, 1, clear),
        // Le REMPLISSAGE de nuit n'est pas un détail d'ambiance : en `auto`, la lune tombe où elle
        // tombe, et les faces qu'on regarde peuvent toutes être à l'ombre. Sans un ciel nocturne qui
        // éclaire vraiment, la maison n'existe plus dès que la source passe derrière elle.
        hemiSky: new Color(0x5d7099).lerp(new Color(0xbcd4f2), day),
        hemiGround: new Color(0x141a26).lerp(new Color(0x6a6455), day),
        hemiIntensity: mix(0.9, 0.55, day) * mix(1.6, 1, clear),
        ambientIntensity: mix(0.12, 0.08, day),
        // sous un ciel couvert, et sous la lune, les ombres portées s'adoucissent
        shadowOpacity: mix(0.5, 1, day) * clear,
      },
      post: {
        toneMapping: 'aces',
        // le diaphragme s'ouvre la nuit : c'est lui, et non la couleur des murs, qui rend la maison lisible
        exposure: mix(1.2, 0.9, day),
        bloom: {
          strength: mix(0.8, 0.22, day),
          radius: mix(0.55, 0.4, day),
          threshold: mix(0.72, 1, day),
        },
        // 60 cm : l'échelle des angles d'une PIÈCE. Plus court, l'occlusion ne fait qu'un liseré au
        // pied des murs ; plus long, elle salit les grandes surfaces planes.
        ao: { intensity: mix(1.1, 0.9, day), radius: 0.6 },
        vignette: mix(0.45, 0.18, day),
      },
      glow: {
        scale: mix(1.2, 0.9, day),
        // Le halo et la lampe étaient réglés SANS tone mapping, pour une image qui ne débordait
        // jamais : avec la courbe filmique, une lampe à 16 brûlait un pan de mur entier en blanc pur.
        // Ce qui compte n'est plus l'intensité brute, c'est ce qui reste après la courbe.
        opacity: mix(0.6, 0.18, day),
        lightIntensity: mix(11, 5, day),
        emissive: mix(2.2, 1.2, day),
      },
    }
  },
}
