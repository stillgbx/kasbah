import { NEUTRAL_TUNING, sceneTuningSchema, type SceneTuning } from '@kasbah/shared'
import type { PostLook, StyleLook } from './types'

// LE BANC DE RÉGLAGE de la lumière. Un style dit déjà tout ce qu'une heure vaut — exposition, bloom,
// halo des lampes — mais ces nombres ont été trouvés à l'œil, une lampe à la fois, et la nuit finit
// par brûler : le seuil du bloom attrape les murs éclairés, le halo additif des lampes repasse
// ensuite dans la passe de bloom, le trait de la pièce sélectionnée est peint au-dessus de 1.
// Plutôt que de deviner un nouveau jeu de nombres dans le code, on les règle DEVANT la maison, en
// direct, et ce qui plaît s'enregistre dans la maison (`house.render.tuning`).
//
// Le CONTRAT du réglage (les champs, leurs bornes, le neutre) vit dans `@kasbah/shared` avec le
// reste de la maison ; ce fichier n'en garde que ce qui ne regarde que l'écran : les bornes des
// curseurs, les préréglages, et la façon dont un réglage se pose sur le look d'un style.

export { NEUTRAL_TUNING, type SceneTuning }

/** Bornes des curseurs du banc. Le pas dit la finesse utile, pas la précision du nombre. */
export const TUNING_RANGES: Record<Exclude<keyof SceneTuning, 'toneMapping' | 'ringThrough'>, { min: number; max: number; step: number }> = {
  exposure: { min: 0.4, max: 2, step: 0.05 },
  bloomStrength: { min: 0, max: 2, step: 0.05 },
  bloomThreshold: { min: 0.5, max: 2.5, step: 0.05 },
  bloomRadius: { min: 0.3, max: 2, step: 0.05 },
  vignette: { min: 0, max: 2, step: 0.05 },
  glowOpacity: { min: 0, max: 1.5, step: 0.05 },
  glowScale: { min: 0.3, max: 2, step: 0.05 },
  lightIntensity: { min: 0.2, max: 2, step: 0.05 },
  emissive: { min: 0.2, max: 2, step: 0.05 },
  ringWidth: { min: 0.03, max: 0.4, step: 0.01 },
  ringBoost: { min: 0.3, max: 2, step: 0.05 },
  ringWhite: { min: 0, max: 1, step: 0.05 },
  ringOpacity: { min: 0, max: 1, step: 0.02 },
  fillOpacity: { min: 0, max: 0.5, step: 0.01 },
  tiltShift: { min: 0, max: 1, step: 0.05 },
  tiltCenter: { min: 0, max: 1, step: 0.02 },
  tiltWidth: { min: 0.02, max: 1, step: 0.02 },
  tiltPills: { min: 0, max: 1, step: 0.05 },
}

/**
 * Complète un réglage partiel (un champ ajouté depuis qu'il a été écrit) par les valeurs neutres.
 * Un brouillon local ABÎMÉ — valeur hors bornes, champ d'un autre âge — revient au neutre en entier
 * plutôt que de faire tomber la vue : ce n'est qu'un brouillon, et il se refait en trois gestes.
 * Le fichier de la maison, lui, est validé strictement par `houseSchema` comme tout le reste.
 */
export const resolveTuning = (raw: unknown): SceneTuning => {
  const parsed = sceneTuningSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : NEUTRAL_TUNING
}

/** Deux réglages disent-ils la même chose. Sert à reconnaître le préréglage en cours, et le neutre. */
export const sameTuning = (a: SceneTuning, b: SceneTuning): boolean =>
  (Object.keys(NEUTRAL_TUNING) as (keyof SceneTuning)[]).every((k) => a[k] === b[k])

export interface TuningPreset {
  readonly id: string
  readonly tuning: SceneTuning
}

const preset = (id: string, tuning: Partial<SceneTuning>): TuningPreset => ({ id, tuning: { ...NEUTRAL_TUNING, ...tuning } })

// LES PRÉRÉGLAGES. Quatre partis pris, pas quatre variantes du même : chacun répond à une question
// différente posée à la même maison. Ils partent tous du même constat — la nuit du style `realistic`
// fait baver les murs ÉCLAIRÉS et pas seulement les lampes (seuil 0,72 en linéaire), et le halo
// additif des lampes est compté deux fois puisqu'il repasse dans la passe de bloom.
export const TUNING_PRESETS: readonly TuningPreset[] = [
  // Ce qu'on voulait : la même image, sans l'éblouissement. Le seuil monte jusqu'à ne plus garder
  // que les vraies sources, le halo est divisé par deux (le bloom fait maintenant le travail), le
  // trait redevient un trait — plus fin, à peine au-dessus de 1, il souligne au lieu de crier.
  preset('soft', {
    exposure: 0.95, bloomStrength: 0.55, bloomThreshold: 1.45, bloomRadius: 0.85, vignette: 1.1,
    glowOpacity: 0.5, glowScale: 0.9, lightIntensity: 0.85, emissive: 0.8,
    ringWidth: 0.1, ringBoost: 0.95, ringWhite: 0.1, ringOpacity: 0.75, fillOpacity: 0.08,
  }),
  // AgX au lieu d'ACES : une surexposition y GARDE SA TEINTE au lieu de virer au blanc. Une lampe
  // ambre reste ambre en son cœur, le trait reste mauve. La courbe est plus douce, donc plus sombre :
  // le diaphragme s'ouvre d'un tiers pour compenser, et la vignette se creuse — c'est une photo.
  preset('cinema', {
    toneMapping: 'agx',
    exposure: 1.35, bloomStrength: 0.7, bloomThreshold: 1.25, bloomRadius: 1.15, vignette: 1.35,
    glowOpacity: 0.6, lightIntensity: 0.95, emissive: 0.9,
    ringWidth: 0.08, ringBoost: 1.05, ringWhite: 0.05, ringOpacity: 0.8, fillOpacity: 0.06,
    // un tilt-shift DISCRET : la bande nette couvre la maison, seuls le ciel et le premier plan
    // partent — c'est le flou d'un objectif ouvert, pas encore la maquette
    tiltShift: 0.45, tiltCenter: 0.52, tiltWidth: 0.3, tiltPills: 0.5,
  }),
  // Pour la tablette de l'entrée, en plein jour, à un mètre : presque pas de bloom, pas de vignette,
  // un trait net et opaque qu'on lit d'un coup d'œil. Ici la maison est un TABLEAU DE BORD, et ce
  // qui compte est de voir d'un pas quelle pièce est ouverte — pas l'atmosphère.
  preset('plain', {
    exposure: 1.05, bloomStrength: 0.25, bloomThreshold: 1.8, bloomRadius: 0.8, vignette: 0.5,
    glowOpacity: 0.35, glowScale: 0.8, lightIntensity: 0.9, emissive: 0.7,
    ringWidth: 0.07, ringBoost: 0.9, ringWhite: 0, ringOpacity: 1, fillOpacity: 0.05,
  }),
  // L'esprit de la maquette, gardé : on veut que ça brille. Seul le seuil monte — assez pour que le
  // mur cesse de baver, pas assez pour éteindre les lampes, qui gagnent même en diamètre.
  preset('model', {
    bloomStrength: 0.9, bloomThreshold: 1.3, bloomRadius: 1.1,
    glowOpacity: 0.7, glowScale: 1.1,
    ringWidth: 0.12, ringBoost: 1.1, ringWhite: 0.15, ringOpacity: 0.9, fillOpacity: 0.12,
    // et là, la MAQUETTE assumée : bande étroite, flou franc, pilules qui suivent — une maison
    // photographiée de près au lieu d'une maison vue de loin
    tiltShift: 0.85, tiltCenter: 0.5, tiltWidth: 0.16, tiltPills: 0.75,
  }),
]

/** Le look du style, passé au banc. Ne modifie rien : la scène garde le droit de recalculer le look. */
export function applyTuning(look: StyleLook, t: SceneTuning): StyleLook {
  const post: PostLook = {
    toneMapping: t.toneMapping === 'style' ? look.post.toneMapping : t.toneMapping,
    exposure: look.post.exposure * t.exposure,
    bloom: look.post.bloom && {
      strength: look.post.bloom.strength * t.bloomStrength,
      radius: look.post.bloom.radius * t.bloomRadius,
      threshold: look.post.bloom.threshold * t.bloomThreshold,
    },
    ao: look.post.ao,
    vignette: look.post.vignette * t.vignette,
    ...(look.post.grade ? { grade: look.post.grade } : {}),
    // Le tilt-shift ne vient d'aucun style : il naît ici. Éteint, la clé est ABSENTE et non `null` —
    // c'est ce qui garde vraie la promesse du réglage neutre : le look du style, à l'identique.
    ...(t.tiltShift > 0 ? { tiltShift: { strength: t.tiltShift, center: t.tiltCenter, width: t.tiltWidth, pills: t.tiltPills } } : {}),
  }
  return {
    ...look,
    post,
    glow: {
      scale: look.glow.scale * t.glowScale,
      opacity: look.glow.opacity * t.glowOpacity,
      lightIntensity: look.glow.lightIntensity * t.lightIntensity,
      emissive: look.glow.emissive * t.emissive,
    },
  }
}
