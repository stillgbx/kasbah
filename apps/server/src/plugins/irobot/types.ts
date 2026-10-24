import { z } from 'zod'

// LENIENT schemas of the iRobot responses. Project rule (`3_2_ecrire-un-plugin.md`): never
// constrain the type of a field we don't read — in zod 4, `z.unknown()` alone does NOT make a key
// optional, you need `z.unknown().optional()`, otherwise an ignored field makes the whole response
// fail (MELCloud lesson of 09/17).

/**
 * The robot's answer to the UDP/5678 broadcast. Captured on the real device set on 09/19/2026: a
 * `stingray` Roomba Combo announces `robotid`, older ones only put `hostname` (`Roomba-<blid>`) —
 * hence the two paths to the BLID in `discovery.ts`.
 */
export const discoveryPayloadSchema = z.looseObject({
  ver: z.unknown().optional(),
  hostname: z.string().optional(),
  robotname: z.string().optional(),
  robotid: z.string().optional(),
  /** Not read: the address is the datagram's sender (`discovery.ts`). */
  ip: z.unknown().optional(),
  mac: z.unknown().optional(),
  sw: z.string().optional(),
  sku: z.string().optional(),
  /** `mqtt` = local broker. A robot announcing anything else can't be driven locally. */
  proto: z.string().optional(),
  /**
   * The vendor's capability table. Two keys were useful right away: `scrub` (mop, hence a Combo)
   * and above all `pw` — at `0`, the robot NO LONGER HANDS OUT its password locally, which 115
   * magic-datagram attempts had confirmed before we read this key.
   */
  cap: z.record(z.string(), z.unknown()).optional(),
  cloudConnState: z.unknown().optional(),
})
export type DiscoveryPayload = z.infer<typeof discoveryPayloadSchema>

/** `GET /v1/discover/endpoints?country_code=XX` — public, no credentials. */
export const endpointDiscoverySchema = z.looseObject({
  current_deployment: z.string().optional(),
  deployments: z.record(z.string(), z.looseObject({
    httpBase: z.string(),
    httpBaseAuth: z.unknown().optional(),
    awsRegion: z.unknown().optional(),
    svcDeplId: z.unknown().optional(),
  })),
  gigya: z.looseObject({
    api_key: z.string(),
    datacenter_domain: z.string(),
  }),
})

/**
 * `POST /accounts.login` at Gigya. Same pitfall as Renault: **HTTP 200 even on refusal**, the
 * failure is in `errorCode`. So the frame is read before the content.
 */
export const gigyaResponseSchema = z.looseObject({
  errorCode: z.number(),
  errorMessage: z.string().optional(),
  errorDetails: z.string().optional(),
})

export const gigyaLoginSchema = z.looseObject({
  UID: z.string(),
  UIDSignature: z.string(),
  signatureTimestamp: z.union([z.string(), z.number()]),
})

/**
 * `POST {httpBase}/v2/login` — the exchange that matters: it returns, for each robot on the
 * account, its LOCAL PASSWORD. It's the only secret the plugin keeps; the account's doesn't
 * survive the request.
 */
export const cloudLoginSchema = z.looseObject({
  robots: z.record(z.string(), z.looseObject({
    password: z.string(),
    name: z.string().optional(),
    sku: z.string().optional(),
    softwareVer: z.string().optional(),
  })),
})

/** A robot's local credentials, as they live in the session file. */
export const storedRobotSchema = z.object({
  blid: z.string().min(1),
  password: z.string().min(1),
  name: z.string().nullable().default(null),
  sku: z.string().nullable().default(null),
  /** Fingerprint of its broker certificate, pinned on first use (`core/tls-pin.ts`). */
  pin: z.string().optional(),
})
export type StoredRobot = z.infer<typeof storedRobotSchema>

export const storedSessionSchema = z.object({
  robots: z.array(storedRobotSchema),
  linkedAt: z.number().optional(),
})
export type StoredSession = z.infer<typeof storedSessionSchema>
