import { z } from 'zod'

// Shapes of the Google Smart Device Management (SDM) API, `https://smartdevicemanagement.googleapis.com/v1`.
// DELIBERATELY lenient schemas (`looseObject`, `z.unknown()` on traits): Google adds traits with
// each device generation, and constraining a field we do not read would be enough to fail the whole
// list (lesson from the TaHoma plugin, cf. `doc/3_plugins/3_2_ecrire-un-plugin.md`).

/**
 * An SDM device. `name` is the resource path `enterprises/<project>/devices/<id>`; the id is opaque
 * and stable. `traits` is a dictionary `sdm.devices.traits.<Name>` → values, read trait by trait
 * with `readTrait` so as to impose nothing on the ones we ignore.
 */
export const sdmDeviceSchema = z.looseObject({
  name: z.string(),
  /** `sdm.devices.types.DOORBELL`, `…CAMERA`, `…DISPLAY`, `…THERMOSTAT`. */
  type: z.string().optional(),
  traits: z.record(z.string(), z.unknown()).default({}),
  /** The room (Google Home structure) containing the device: `displayName` is its name. */
  parentRelations: z.array(z.looseObject({
    parent: z.string().optional(),
    displayName: z.string().optional(),
  })).default([]),
})
export type SdmDevice = z.infer<typeof sdmDeviceSchema>

/** `GET /enterprises/<project>/devices`. Each item is validated separately by the client. */
export const sdmDevicesResponseSchema = z.looseObject({
  devices: z.array(z.unknown()).default([]),
})

/** Google error body (`{ error: { code, message, status } }`) — diagnostic, no secret. */
export const sdmErrorSchema = z.looseObject({
  error: z.looseObject({
    code: z.number().optional(),
    message: z.string().optional(),
    status: z.string().optional(),
  }).optional(),
})

/** Response of `https://oauth2.googleapis.com/token` (code exchange and refresh). */
export const oauthTokenResponseSchema = z.looseObject({
  access_token: z.string(),
  /** Seconds of validity (3600 in practice). */
  expires_in: z.number().optional(),
  /** Present only on the code exchange (with `access_type=offline` + `prompt=consent`). */
  refresh_token: z.string().optional(),
})
export type OAuthTokenResponse = z.infer<typeof oauthTokenResponseSchema>

/** OAuth error body (`invalid_grant` = refresh token revoked or code already used). */
export const oauthErrorSchema = z.looseObject({
  error: z.string().optional(),
  error_description: z.string().optional(),
})

/** The device's trait as an object, or `undefined` if it is missing or is not an object. */
export function readTrait(device: SdmDevice, name: string): Record<string, unknown> | undefined {
  const t = device.traits[`sdm.devices.traits.${name}`]
  return t !== null && typeof t === 'object' && !Array.isArray(t) ? (t as Record<string, unknown>) : undefined
}

/**
 * `results` of `CameraLiveStream.GenerateRtspStream`: the `rtsps://…?auth=<streamToken>` URL lasts
 * five minutes, extendable through `ExtendRtspStream` with `streamExtensionToken`. Shape from the
 * documentation, to be confirmed on the first capture (the plugin logs the response at debug).
 */
export const sdmRtspStreamSchema = z.looseObject({
  streamUrls: z.looseObject({ rtspUrl: z.string() }),
  streamExtensionToken: z.string(),
  streamToken: z.string().optional(),
  expiresAt: z.string().optional(),
})
export type SdmRtspStream = z.infer<typeof sdmRtspStreamSchema>

/** `results` of `ExtendRtspStream`: a new extension token, the URL does not change. */
export const sdmExtendStreamSchema = z.looseObject({
  streamExtensionToken: z.string(),
  streamToken: z.string().optional(),
  expiresAt: z.string().optional(),
})

/** Envelope of `:executeCommand`: `results` is missing for commands without a response. */
export const sdmCommandResponseSchema = z.looseObject({ results: z.unknown().optional() })

/** Response of `subscriptions:pull`: unacknowledged messages (the useful body is base64 in `message.data`). */
export const pubsubPullResponseSchema = z.looseObject({
  receivedMessages: z.array(z.looseObject({
    ackId: z.string(),
    message: z.looseObject({ data: z.string().optional() }).optional(),
  })).optional(),
})

/** SDM event (decoded body of a Pub/Sub message): which device, which events. */
export const sdmEventSchema = z.looseObject({
  resourceUpdate: z.looseObject({
    name: z.string(),
    events: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
})
