// Do WebGL and WebGPU still draw the same house? Every shader effect exists twice (GLSL and TSL,
// `three/core/renderBackend.ts`): a change to one that is not carried to the other only shows in an
// image. This opens the House view in each renderer, captures the same views, and compares them.
//
//   node scripts/bench-3d/parity.mjs [baseUrl]      default http://localhost:6175 (`kasbah-mock`)
//
// Run it against a dev server STARTED AFTER the last edit: a file edited while Vite runs is imported
// by the app with a `?t=` suffix, and the fade view below reaches the module through a bare URL —
// another instance, an inert effect (that case is reported as such, never as a pass).
//
// Two checks per view: the PARITY (mean luminance gap between the two renderers, out of 255, at most
// MAX_GAP — 0.5 to 2 is the normal level: swell, snow, shadow edges), and for an effect view, its
// SIZE in each renderer (gap to the same view without it): an effect missing on one side, or twice
// as strong, fails even when the image looks close. Exit code 1 if anything fails.
// Env: PORT (DevTools port, 9351), OUT (captures; default `_generated-ai-doc/bench-3d`), MAX_GAP (3).
import path from 'node:path'
import { ALL_LAMPS, DAY, NIGHT, ambience, openHouse, outputDir } from './chrome.mjs'
import { compareImages } from './png.mjs'

const base = process.argv[2] ?? 'http://localhost:6175'
const PORT = Number(process.env.PORT ?? 9351)
const MAX_GAP = Number(process.env.MAX_GAP ?? 3)
const MIN_EFFECT = 1
const out = outputDir()
const dawn = (windKmh) => ambience({ sunAltitudeDeg: 3, sunAzimuthDeg: 95, windKmh })
const GREY = { sunAltitudeDeg: 20, sunAzimuthDeg: 200, cloudiness: 0.9, windKmh: 5 }
const UNTIL_TWEEN_ENDS = `s.setPaused(false); for (let i = 0; i < 100 && s.roomFocusTween; i++) await sleep(100); await sleep(200); s.setPaused(true)`

/**
 * In order: each view is set up from the state the previous one left. `effectOf`: the view without the
 * effect; `minEffect`: the smallest gap to it that still proves the effect is there (default MIN_EFFECT).
 */
const VIEWS = [
  { name: 'day', prepare: `${DAY}; s.focusLevel(null)` },
  // the room highlight fades over a tween, which only moves while the loop runs: run it until the tween
  // is over (a fixed delay is not enough in WebGPU, whose first frames after a change are slow)
  { name: 'room', effectOf: 'day', prepare: `s.highlightRoom(s.house.rooms[0].id); ${UNTIL_TWEEN_ENDS}` },
  { name: 'day-again', prepare: `s.highlightRoom(null); ${UNTIL_TWEEN_ENDS}` },
  { name: 'fade', effectOf: 'day-again', prepare: `(await import('/src/three/core/levelFade.ts')).setLevelFade(1.2, 0.3)` },
  { name: 'dawn-windy', prepare: `(await import('/src/three/core/levelFade.ts')).setLevelFade(1e9, 1); ${dawn(40)}` },
  { name: 'dawn-mist', effectOf: 'dawn-windy', prepare: dawn(0) },
  { name: 'night-lamps', prepare: `${NIGHT}; s.focusLevel(s.house.levels[0].id); ${ALL_LAMPS}` },
  { name: 'grey', prepare: `s.focusLevel(null); ${ambience(GREY)}` },
  // the flakes are 2-3 px at this distance: a small effect, but one renderer without them fails
  { name: 'snow', effectOf: 'grey', minEffect: 0.02, prepare: ambience({ ...GREY, condition: 'snow', precipitation: { kind: 'snow', intensity: 0.8 } }) },
]

const file = (renderer, view) => path.join(out, `parity-${renderer}-${view}.png`)
for (const renderer of ['webgl', 'webgpu']) {
  const page = await openHouse(base, renderer, PORT)
  await page.evalJs(`window.kasbahScene.setOptions({ quality: 'medium' })`)
  for (const v of VIEWS) {
    await page.evalJs(`(async () => { const s = window.kasbahScene, sleep = (ms) => new Promise((r) => setTimeout(r, ms)); ${v.prepare} })()`)
    await page.capture(file(renderer, v.name))
  }
  if (page.errors.length) console.log(`${renderer}: ${page.errors.length} console errors/warnings, first: ${page.errors[0]}`)
  page.close()
}

let failed = 0
const fail = (msg) => { failed++; return `FAIL ${msg}` }
console.log('view           parity  effect WebGL  effect WebGPU')
for (const v of VIEWS) {
  const parity = compareImages(file('webgl', v.name), file('webgpu', v.name), path.join(out, `parity-diff-${v.name}.png`)).mean
  const notes = []
  if (parity > MAX_GAP) notes.push(fail(`gap ${parity} > ${MAX_GAP}`))
  let effects = ''
  if (v.effectOf) {
    const gl = compareImages(file('webgl', v.effectOf), file('webgl', v.name)).mean
    const gpu = compareImages(file('webgpu', v.effectOf), file('webgpu', v.name)).mean
    effects = `${String(gl).padStart(12)}  ${String(gpu).padStart(13)}`
    const least = v.minEffect ?? MIN_EFFECT
    if (gl < least && gpu < least) notes.push(fail('inert in both renderers: the test reached nothing (dev server started before an edit?)'))
    else if (gl < least || gpu < least || gpu / gl < 0.5 || gpu / gl > 2) notes.push(fail('the effect differs between renderers'))
  }
  console.log(`${v.name.padEnd(14)} ${String(parity).padStart(6)}${effects ? '  ' + effects : ''}  ${notes.join('; ')}`)
}
console.log(failed ? `${failed} check(s) failed — captures and heat maps in ${out}` : `parity OK — captures in ${out}`)
process.exit(failed ? 1 : 0)
