import { z } from 'zod'
import { deviceIdSchema } from '../devices/descriptor'
import { CAMERA_CLASSES, CLIMATE_CLASSES, COVER_CLASSES, DEVICE_KINDS, MEDIA_PLAYER_CLASSES, SENSOR_CLASSES } from '../devices/kinds'

// Prédicats d'une automatisation : ce qu'on teste pour déclencher (`state.when`) ou pour empêcher
// (`unless`). Tout s'écrit sur le CONTRAT (kinds, champs d'état, pièces de la maison), jamais sur un
// fabricant : un plugin éteint retire ses appareils, et le prédicat devient « inconnu » (voir le
// statut `incomplete`), sans que rien ne le supprime.
//
// Évaluation à TROIS valeurs, côté serveur : vrai, faux, ou inconnu (appareil absent ou
// indisponible, champ facultatif absent). Seul « vrai » passe. C'est ce qui rend un front montant
// sûr : un redémarrage, un plugin qui revient, un appareil qui réapparaît ne déclenchent rien.
//
// Aucun `.default()` dans ce module : le fichier d'automatisations est écrit tel que parsé, et zod 4
// ne valide pas ses défauts (piège documenté dans `house/schema.ts`).

export const PREDICATE_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const
export type PredicateOp = (typeof PREDICATE_OPS)[number]

/** Heure murale locale « HH:MM ». */
export const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'heure : HH:MM')
/** Date locale « AAAA-MM-JJ ». */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date : AAAA-MM-JJ')
/** Jours de la semaine, 0 = dimanche : convention de `Date.getDay()` (et de `workDays` dans mock-sim). */
export const daysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7)

/** Nature d'un appareil, tous kinds confondus (volet, TV, sonnette, pompe à chaleur…). */
export const deviceClassSchema = z.union([
  z.enum(COVER_CLASSES), z.enum(MEDIA_PLAYER_CLASSES), z.enum(CAMERA_CLASSES), z.enum(SENSOR_CLASSES), z.enum(CLIMATE_CLASSES),
])

/** `not` inverse le résultat ; un « inconnu » reste inconnu. */
const negatable = { not: z.boolean().optional() }

const LEAVES = [
  /**
   * Comparaison d'un champ d'état. `field` est validé À L'EXÉCUTION contre les clés du kind
   * (`stateKeys`) : un champ inconnu rend la règle `incomplete`, pas un refus d'enregistrer.
   */
  z.object({
    type: z.literal('device'), deviceId: deviceIdSchema, field: z.string().min(1),
    op: z.enum(PREDICATE_OPS), value: z.union([z.string(), z.number(), z.boolean()]), ...negatable,
  }),
  /** L'appareil est ACTIF (`isDeviceOn`) : lampe allumée, lecteur qui diffuse, volet ouvert… */
  z.object({ type: z.literal('deviceOn'), deviceId: deviceIdSchema, ...negatable }),
  /** Le véhicule est à la maison : à moins de `HOME_RADIUS_M` de l'origine. */
  z.object({ type: z.literal('vehicleOnSite'), deviceId: deviceIdSchema, ...negatable }),
  /** Le véhicule est garé sur cette place (règle d'accrochage `assignParkings`, au repos). */
  z.object({ type: z.literal('vehicleParkedAt'), deviceId: deviceIdSchema, parkingId: z.string().min(1), ...negatable }),
  /** Au moins un appareil de ce kind (et de cette nature) est ACTIF dans la pièce. */
  z.object({ type: z.literal('anyInRoom'), roomId: z.string().min(1), kind: z.enum(DEVICE_KINDS), deviceClass: deviceClassSchema.optional(), ...negatable }),
  /** Plage horaire locale ; `to` avant `from` = la plage passe minuit. */
  z.object({ type: z.literal('timeWindow'), from: hhmmSchema, to: hhmmSchema, ...negatable }),
  z.object({ type: z.literal('days'), days: daysSchema, ...negatable }),
  /** Période, bornes comprises. */
  z.object({ type: z.literal('dateRange'), from: isoDateSchema, to: isoDateSchema, ...negatable }),
] as const

export const leafPredicateSchema = z.discriminatedUnion('type', [...LEAVES])
export type LeafPredicate = z.infer<typeof leafPredicateSchema>

/** Un seul niveau de OU : un groupe `any` ne contient que des feuilles. */
export const anyPredicateSchema = z.object({ type: z.literal('any'), of: z.array(leafPredicateSchema).min(1).max(10), ...negatable })

export const predicateSchema = z.discriminatedUnion('type', [...LEAVES, anyPredicateSchema])
export type Predicate = z.infer<typeof predicateSchema>
export type PredicateType = Predicate['type']
