import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { HouseScene } from '../three/HouseScene'
import { readSceneProbe, startSceneProbe } from './sceneProbe'

it('reads the test and its switches from the address', () => {
  expect(readSceneProbe('')).toBeNull()
  expect(readSceneProbe('?shadows=0')).toBeNull()
  expect(readSceneProbe('?probe=bare&shadows=0&assets=0&quality=low')).toEqual({ test: 'bare', shadows: false, assets: false, quality: 'low' })
  // a switch left out or unreadable imposes nothing: the saved setting applies
  expect(readSceneProbe('?probe=base&shadows=yes&quality=ultra')).toEqual({ test: 'base' })
})

let sent: Record<string, unknown>[]

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  vi.stubGlobal('navigator', {
    sendBeacon: (_url: string, blob: Blob) => { void blob.text().then((t) => sent.push((JSON.parse(t) as { probe: Record<string, unknown> }).probe)); return true },
  })
})

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function fakeScene() {
  let onPrepare: ((stage: string | null, p: unknown) => void) | null = null
  const scene = {
    supported: true,
    on: (_e: string, fn: (stage: string | null, p: unknown) => void) => { onPrepare = fn; return () => { onPrepare = null } },
    debugStats: () => ({ fps: 30 }),
    orbitBy: vi.fn(),
  }
  return { scene: scene as unknown as HouseScene, prepare: (stage: string | null, p: unknown = null) => onPrepare?.(stage, p), orbitBy: scene.orbitBy }
}

it('reports each step of the startup, then turns the camera and stops', async () => {
  const { scene, prepare, orbitBy } = fakeScene()
  startSceneProbe(scene, document.createElement('canvas'), { test: 'base' })
  prepare('materials', { done: 1, total: 3 })
  prepare('materials', { done: 3, total: 3 })
  prepare('shaders')
  prepare(null)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(orbitBy).toHaveBeenCalled()
  const steps = sent.map((p) => p.step)
  expect(steps.filter((s) => s !== 'beat')).toEqual(['start', 'prepare:materials', 'prepare:shaders', 'shown', 'end'])
  // the stage that ends carries its last progress
  expect(sent.find((p) => p.step === 'prepare:shaders')).toMatchObject({ previous: 'materials', progress: { done: 3, total: 3 } })
  expect(sent.at(-1)).toMatchObject({ step: 'end', why: 'done', test: 'base' })
})

it('tells when the browser drops the 3D', async () => {
  const canvas = document.createElement('canvas')
  const stop = startSceneProbe(fakeScene().scene, canvas, { test: 'base' })
  canvas.dispatchEvent(new Event('webglcontextlost'))
  stop()
  await vi.advanceTimersByTimeAsync(0)
  expect(sent.map((p) => p.step)).toEqual(['start', 'contextlost', 'end'])
})
