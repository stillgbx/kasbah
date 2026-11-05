import type { LightSyncEffect } from '@kasbah/shared'
import type { LightChannel } from '../../../core/lightStreamBridge'
import { BreatheEffect } from './breathe'
import type { Effect, EffectParams } from './common'
import { PulseEffect } from './pulse'
import { SpectrumEffect } from './spectrum'
import { StrobeEffect } from './strobe'
import { WaveEffect } from './wave'

export type { Effect, EffectParams, Rgb } from './common'

export function createEffect(kind: LightSyncEffect, channels: readonly LightChannel[], params: EffectParams): Effect {
  switch (kind) {
    case 'pulse': return new PulseEffect(channels, params)
    case 'wave': return new WaveEffect(channels, params)
    case 'spectrum': return new SpectrumEffect(channels, params)
    case 'strobe': return new StrobeEffect(channels, params)
    case 'breathe': return new BreatheEffect(channels, params)
  }
}
