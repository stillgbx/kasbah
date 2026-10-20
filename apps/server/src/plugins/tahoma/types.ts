import { z } from 'zod'

// Shapes of the Overkiz local API exposed by the TaHoma box in "developer mode"
// (https://<box>:8443/enduser-mobile-web/1/enduserAPI). DELIBERATELY lenient schemas
// (`looseObject`): the Somfy range is vast and each firmware adds fields.

/**
 * State value, DELIBERATELY untyped. The same state changes shape depending on the endpoint (`30`
 * from `/setup`, `"30"` in an event) and some are neither scalar nor useful:
 * `core:CommandLockLevelsState` is an ARRAY. Constraining this field failed the parse of the whole
 * setup because of a state we do not even read. `pct()` and `bool()` filter as needed.
 */
export const overkizValueSchema = z.unknown()
export type OverkizValue = unknown

export const overkizStateSchema = z.looseObject({
  name: z.string(),
  value: overkizValueSchema.optional(),
})
export type OverkizState = z.infer<typeof overkizStateSchema>

/**
 * What the box declares it can do for this device. It is the plugin's ONLY source of truth: we
 * enumerate no `controllableName` (io:DynamicRollerShutterIOComponent…), we read the announced
 * commands. An unknown model therefore works without changing the code.
 */
export const overkizDefinitionSchema = z.looseObject({
  uiClass: z.string().optional(),
  widgetName: z.string().optional(),
  commands: z.array(z.looseObject({ commandName: z.string() })).default([]),
  // `definition.states` is not a reliable source (empty for most captured devices, filled for the
  // solar shutters): the usable states are in `OverkizDevice.states`.
})
export type OverkizDefinition = z.infer<typeof overkizDefinitionSchema>

export const overkizDeviceSchema = z.looseObject({
  /** `io://1234-5678-9012/12345678`, `rts://…`, `internal://…` — stable id from the box. */
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
 * `GET /setup` of the LOCAL API: `gateways` and `devices`, and nothing else. Unlike the Overkiz
 * cloud, it exposes no room tree — attaching to a room therefore comes from `house.json` (through
 * the UI's "Placement" mode), never from the box.
 */
export const overkizSetupEnvelopeSchema = z.looseObject({
  devices: z.array(z.unknown()).default([]),
})

/**
 * Events of `POST /events/{listenerId}/fetch`. The only ones we care about:
 * `DeviceStateChangedEvent` (new states) and the availability toggles.
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
/** Box error body: `{ "errorCode": "…", "error": "…" }`. */
export const overkizErrorSchema = z.looseObject({ error: z.string().optional(), errorCode: z.string().optional() })

export interface OverkizAction {
  deviceURL: string
  commands: { name: string; parameters: (string | number)[] }[]
}
