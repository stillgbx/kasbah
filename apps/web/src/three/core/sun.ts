// The sun computation lives in `@kasbah/shared` since the server needs it (automations at
// sunrise, sunset, dusk). Re-exported here for the scene's callers.
export { approximateSunPosition, sunPosition, type SunPosition } from '@kasbah/shared'
