import { z } from 'zod'

// Settings of the room lights in rhythm with the music (Hue Entertainment), shared by the server,
// which applies them, and the screen, which edits them and draws the presets' swatches.

export const LIGHTSYNC_EFFECTS = ['pulse', 'wave', 'spectrum', 'strobe', 'breathe'] as const
export type LightSyncEffect = (typeof LIGHTSYNC_EFFECTS)[number]

/** Ready-made palettes, sRGB hex. Saturated enough to read as colour at low brightness. */
export const LIGHTSYNC_PRESETS = {
  warm: ['#ff5a0d', '#ff1466', '#8c1fff', '#ff9905'],
  cool: ['#00b4ff', '#3d5aff', '#00e0c6', '#b8e6ff'],
  neon: ['#ff00c8', '#00f0ff', '#b6ff00', '#7a00ff'],
  forest: ['#2fbf4a', '#a3d900', '#0f7a52', '#e6c200'],
  ocean: ['#0066ff', '#00c2d6', '#00ffa8', '#1a2fb3'],
  rainbow: ['#ff1a1a', '#ff9a00', '#ffe600', '#22d43c', '#1a66ff', '#9b1aff'],
} as const satisfies Record<string, readonly string[]>
export type LightSyncPreset = keyof typeof LIGHTSYNC_PRESETS
export const LIGHTSYNC_PRESET_IDS = Object.keys(LIGHTSYNC_PRESETS) as LightSyncPreset[]

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const lightSyncPaletteSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('preset'), preset: z.enum(LIGHTSYNC_PRESET_IDS as [LightSyncPreset, ...LightSyncPreset[]]) }),
  /** A light scene of the room (its swatches). */
  z.object({ source: z.literal('scene'), sceneId: z.string().min(1).max(200) }),
  z.object({ source: z.literal('custom'), colors: z.array(hex).min(2).max(5) }),
  /** The colours of the playing track's cover art, changing with each track. */
  z.object({ source: z.literal('cover') }),
])
export type LightSyncPalette = z.infer<typeof lightSyncPaletteSchema>

export const lightSyncSettingsSchema = z.object({
  effect: z.enum(LIGHTSYNC_EFFECTS),
  palette: lightSyncPaletteSchema,
  /** 0 = calm (slow, soft, few colour changes) … 1 = energetic (fast, contrasted). */
  energy: z.number().min(0).max(1),
  /** Maximum brightness, 0.1..1. */
  brightness: z.number().min(0.1).max(1),
})
export type LightSyncSettings = z.infer<typeof lightSyncSettingsSchema>

/** What the first version did: the pulse on a warm palette, half energy, full brightness. */
export const DEFAULT_LIGHTSYNC_SETTINGS: LightSyncSettings = {
  effect: 'pulse',
  palette: { source: 'preset', preset: 'warm' },
  energy: 0.5,
  brightness: 1,
}

/** A partial change sent by the screen: any field, each one whole. */
export const lightSyncSettingsPatchSchema = lightSyncSettingsSchema.partial()
export type LightSyncSettingsPatch = z.infer<typeof lightSyncSettingsPatchSchema>
