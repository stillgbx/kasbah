// GPU and CPU time per frame of the House view, in one renderer, while the camera turns.
//
//   node scripts/bench-3d/perf.mjs [baseUrl] [webgl|webgpu]      default http://localhost:6175, webgl
//
// WebGL is timed by `EXT_disjoint_timer_query_webgl2` around each frame (the quality safeguard's own
// queries are muted: they would nest in ours); WebGPU by the renderer's timestamps, which the WebGPU
// side only turns on in development (`three/gpu/index.ts`). `fpsNoQuery` is the frame rate without any
// timing query. Never conclude on one pair: alternate WebGL / WebGPU / WebGL / WebGPU and discard the
// first run of a cold Chrome. On battery, or in an energy-saving mode, write it down with the figures.
// Env: Q (quality: low, medium, high; default high), SEC (seconds per view, 6), PORT (9352).
import { ALL_LAMPS, DAY, NIGHT, openHouse } from './chrome.mjs'

const base = process.argv[2] ?? 'http://localhost:6175'
const renderer = process.argv[3] === 'webgpu' ? 'webgpu' : 'webgl'
const SEC = Number(process.env.SEC ?? 6)
const page = await openHouse(base, renderer, Number(process.env.PORT ?? 9352))

const setup = await page.evalJs(`(async () => {
  const s = window.kasbahScene, r = s.renderer
  s.setOptions({ quality: '${process.env.Q ?? 'high'}' })
  let gpu = '?'
  if (${renderer === 'webgl'}) {
    const gl = r.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info')
    gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?'
    window.__ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
    window.__begin = gl.beginQuery.bind(gl); window.__end = gl.endQuery.bind(gl)
    gl.beginQuery = () => {}; gl.endQuery = () => {}
  } else {
    const info = r.backend.adapter?.info ?? (await navigator.gpu.requestAdapter())?.info
    gpu = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ')
  }
  return { renderer: r.constructor.name, gpu, canvas: [r.domElement.width, r.domElement.height], quality: s.debugStats().quality }
})()`)
console.log(JSON.stringify(setup))

const RUN = `(async () => {
  const s = window.kasbahScene, r = s.renderer, webgl = ${renderer === 'webgl'}
  const gl = webgl ? r.getContext() : null, ext = window.__ext
  const gpu = [], cpu = [], queries = []
  const t0 = performance.now()
  while (performance.now() - t0 < ${SEC} * 1000) {
    await new Promise((res) => requestAnimationFrame(res))
    s.orbitBy(0.004)
    const c0 = performance.now()
    if (webgl) { const q = gl.createQuery(); window.__begin(ext.TIME_ELAPSED_EXT, q); s.render(); window.__end(ext.TIME_ELAPSED_EXT); queries.push(q) }
    else s.render()
    cpu.push(performance.now() - c0)
    if (!webgl) { await r.resolveTimestampsAsync('render'); if (r.info.render.timestamp > 0) gpu.push(r.info.render.timestamp) }
  }
  if (webgl) {
    await new Promise((res) => setTimeout(res, 300))
    for (const q of queries) { if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q) }
  }
  const median = (a) => (a.length ? +a.slice().sort((x, y) => x - y)[a.length >> 1].toFixed(2) : null)
  const t1 = performance.now(); let n = 0
  while (performance.now() - t1 < 4000) { await new Promise((res) => requestAnimationFrame(res)); s.orbitBy(0.004); s.render(); n++ }
  return { gpuMs: median(gpu), cpuMs: median(cpu), fpsNoQuery: +((n * 1000) / (performance.now() - t1)).toFixed(1), triangles: r.info.render.triangles }
})()`

const VIEWS = [
  ['day-overview', `${DAY}; s.focusLevel(null)`],
  ['day-level', `${DAY}; s.focusLevel(s.house.levels[0].id)`],
  ['night-lamps-overview', `${NIGHT}; s.focusLevel(null); ${ALL_LAMPS}`],
  ['night-lamps-level', `${NIGHT}; s.focusLevel(s.house.levels[0].id); ${ALL_LAMPS}`],
]
for (const [name, prepare] of VIEWS) {
  await page.evalJs(`(async () => { const s = window.kasbahScene; ${prepare} })()`)
  await new Promise((r) => setTimeout(r, 1500))
  console.log(JSON.stringify({ renderer, view: name, ...(await page.evalJs(RUN)) }))
}
if (page.errors.length) console.log(`${page.errors.length} console errors/warnings, first: ${page.errors[0]}`)
page.close()
process.exit(0)
