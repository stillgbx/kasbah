import { z } from 'zod'

// Formes de l'API locale Overkiz exposée par la box TaHoma en « mode développeur »
// (https://<box>:8443/enduser-mobile-web/1/enduserAPI). Schémas VOLONTAIREMENT souples
// (`looseObject`) : le parc Somfy est vaste et chaque firmware ajoute des champs.

/**
 * Valeur d'état, VOLONTAIREMENT non typée. Un même état change de forme selon l'endpoint (`30`
 * depuis `/setup`, `"30"` dans un événement) et certains ne sont ni scalaires ni utiles :
 * `core:CommandLockLevelsState` est un TABLEAU. Contraindre ce champ faisait échouer le parse de
 * tout le setup à cause d'un état qu'on ne lit même pas. `pct()` et `bool()` filtrent au besoin.
 */
export const overkizValueSchema = z.unknown()
export type OverkizValue = unknown

export const overkizStateSchema = z.looseObject({
  name: z.string(),
  value: overkizValueSchema.optional(),
})
export type OverkizState = z.infer<typeof overkizStateSchema>

/**
 * Ce que la box déclare savoir faire pour cet appareil. C'est la SEULE source de vérité du
 * plugin : on n'énumère aucun `controllableName` (io:DynamicRollerShutterIOComponent…), on lit
 * les commandes annoncées. Un modèle inconnu marche donc sans changer le code.
 */
export const overkizDefinitionSchema = z.looseObject({
  uiClass: z.string().optional(),
  widgetName: z.string().optional(),
  commands: z.array(z.looseObject({ commandName: z.string() })).default([]),
  // `definition.states` n'est pas une source fiable (vide pour la plupart des appareils relevés,
  // rempli pour les volets solaires) : les etats exploitables sont dans `OverkizDevice.states`.
})
export type OverkizDefinition = z.infer<typeof overkizDefinitionSchema>

export const overkizDeviceSchema = z.looseObject({
  /** `io://1234-5678-9012/12345678`, `rts://…`, `internal://…` — identifiant stable de la box. */
  deviceURL: z.string(),
  label: z.string().optional(),
  controllableName: z.string().optional(),
  available: z.boolean().optional(),
  enabled: z.boolean().optional(),
  definition: overkizDefinitionSchema.optional(),
  states: z.array(overkizStateSchema).default([]),
})
export type OverkizDevice = z.infer<typeof overkizDeviceSchema>

/**
 * `GET /setup` de l'API LOCALE : `gateways` et `devices`, et rien d'autre. Contrairement au cloud
 * Overkiz, elle n'expose aucun arbre de pièces — le rattachement à une pièce vient donc de
 * `house.json` (via le mode « Emplacement » de l'UI), jamais de la box.
 */
export const overkizSetupEnvelopeSchema = z.looseObject({
  devices: z.array(z.unknown()).default([]),
})

/**
 * Événements de `POST /events/{listenerId}/fetch`. Les seuls qui nous intéressent :
 * `DeviceStateChangedEvent` (nouveaux états) et les bascules de disponibilité.
 */
export const overkizEventSchema = z.looseObject({
  name: z.string(),
  deviceURL: z.string().optional(),
  deviceStates: z.array(overkizStateSchema).default([]),
})
export type OverkizEvent = z.infer<typeof overkizEventSchema>
export const overkizEventsSchema = z.array(overkizEventSchema)

export const overkizListenerSchema = z.looseObject({ id: z.string() })
export const overkizApiVersionSchema = z.looseObject({ protocolVersion: z.string().optional() })
/** Corps d'erreur de la box : `{ "errorCode": "…", "error": "…" }`. */
export const overkizErrorSchema = z.looseObject({ error: z.string().optional(), errorCode: z.string().optional() })

export interface OverkizAction {
  deviceURL: string
  commands: { name: string; parameters: (string | number)[] }[]
}
