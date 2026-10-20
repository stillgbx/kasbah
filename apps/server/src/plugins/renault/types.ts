import { z } from 'zod'

// Shapes of the Renault responses. Two very different APIs follow one another:
//
//  - GIGYA (SAP Customer Data Cloud), authentication. It ALWAYS answers with HTTP 200, even for a
//    wrong password: it's `errorCode` in the body that signals the failure. A client that only
//    looks at the HTTP status always believes it succeeded.
//  - KAMEREON, the vehicle data. JSON:API envelope (`{ data: { id, type, attributes } }`) and
//    errors in `errors[]` with an in-house code (`err.func.wired.forbidden`…).
//
// The ATTRIBUTE schemas (battery, cockpit, position…) are deliberately NOT here: they will be
// written from the capture of the real account, not from the documentation. Two plugins in this
// house have already paid for that lesson (see `doc/3_plugins/3_2_ecrire-un-plugin.md`).

// ---- Gigya -------------------------------------------------------------------------------------

/** Every Gigya response carries this frame; `errorCode: 0` is the only success. */
export const gigyaResponseSchema = z.looseObject({
  errorCode: z.number(),
  errorMessage: z.string().optional(),
  errorDetails: z.string().optional(),
})
export type GigyaResponse = z.infer<typeof gigyaResponseSchema>

/** `accounts.login`: the long-lived token is `sessionInfo.cookieValue`, and nothing else. */
export const gigyaLoginSchema = z.looseObject({
  sessionInfo: z.looseObject({ cookieValue: z.string().min(1) }),
})

/** `accounts.getAccountInfo`: gives the `personId`, the entry key to Kamereon. */
export const gigyaAccountInfoSchema = z.looseObject({
  data: z.looseObject({ personId: z.string().min(1) }),
})

/** `accounts.getJWT`: the short token (15 min) that Kamereon accepts. */
export const gigyaJwtSchema = z.looseObject({ id_token: z.string().min(1) })

// ---- Kamereon ----------------------------------------------------------------------------------

/**
 * `/persons/{personId}`: the person's Kamereon accounts. A household often has several
 * (`MYRENAULT`, `MYDACIA`, sometimes a closed account) — hence the explicit choice on the plugin side.
 */
export const personSchema = z.looseObject({
  accounts: z.array(z.unknown()).default([]),
})
export const personAccountSchema = z.looseObject({
  accountId: z.string().min(1),
  accountType: z.string().optional(),
  accountStatus: z.string().optional(),
})
export type PersonAccount = z.infer<typeof personAccountSchema>

/**
 * `/accounts/{accountId}/vehicles`: one link per vehicle. `z.unknown()` on the items, validated one
 * by one afterwards: a vehicle with an unexpected shape must not deprive the household of the others.
 */
export const vehiclesSchema = z.looseObject({
  vehicleLinks: z.array(z.unknown()).default([]),
})

/**
 * A vehicle link. Only the VIN is required — it's the stable identifier, hence the `externalId`. The
 * rest is used to name the device, and all of it is optional: `vehicleDetails` is missing on a
 * vehicle whose services contract has expired.
 */
export const vehicleLinkSchema = z.looseObject({
  vin: z.string().min(1),
  status: z.string().optional(),
  vehicleDetails: z.looseObject({
    vin: z.string().optional(),
    registrationNumber: z.string().optional(),
    brand: z.looseObject({ label: z.string().optional() }).optional(),
    model: z.looseObject({ code: z.string().optional(), label: z.string().optional() }).optional(),
    energy: z.looseObject({ code: z.string().optional(), label: z.string().optional() }).optional(),
    /**
     * The vehicle's renders IN ITS CONFIGURATION (`3dv.renault.com`), seven viewpoints. The only
     * source for the paint color: the URL carries the factory reference, and Renault names it
     * nowhere else. See `bodyColor`.
     */
    assets: z.array(z.looseObject({
      assetType: z.string().optional(),
      renditions: z.array(z.looseObject({ url: z.string().optional() })).default([]),
    })).optional(),
  }).optional(),
})
export type VehicleLink = z.infer<typeof vehicleLinkSchema>

/**
 * JSON:API envelope of the vehicle readings. The `attributes` stay `unknown` until the capture of
 * the real account has dictated their shape: reading them by guesswork would be exactly the
 * mistake this project has already made twice.
 */
export const kamereonDataSchema = z.looseObject({
  data: z.looseObject({
    id: z.string().optional(),
    type: z.string().optional(),
    attributes: z.unknown().optional(),
  }).optional(),
})

/** Kamereon error: `errors[].errorCode` carries the real reason (`err.func.wired.forbidden`…). */
export const kamereonErrorsSchema = z.looseObject({
  errors: z.array(z.looseObject({
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
  })).default([]),
})

/**
 * A vehicle contract (`GET .../vehicles/{vin}/contracts`): warranties, connected services,
 * maintenance. Shape read from the capture of the real account (2026-10-19): the response is a bare
 * ARRAY, and `conditions` an array whose first entry carries the cap (`maximumMileage`, in `km`).
 * No financing contract appears there — lease-purchase and long-term leases live at Mobilize, with
 * no known API.
 */
export const vehicleContractSchema = z.looseObject({
  type: z.string().optional(),
  description: z.string().optional(),
  status: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  durationMonths: z.number().optional(),
  conditions: z.array(z.looseObject({
    maximumMileage: z.number().optional(),
    unlimitedMileage: z.boolean().optional(),
    mileageUnit: z.string().optional(),
  })).optional(),
})
