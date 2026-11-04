// The House view in a Chrome of its own, driven through the DevTools protocol: the built-in preview
// pane and a background tab get no `requestAnimationFrame` (hidden page), a separate window does.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Where captures and heat maps go: ignored by git. */
export function outputDir() {
  const dir = process.env.OUT ?? path.join(root, '_generated-ai-doc', 'bench-3d')
  mkdirSync(dir, { recursive: true })
  return dir
}

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME
  const candidates = {
    win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  }[process.platform] ?? ['/usr/bin/google-chrome', '/usr/bin/chromium']
  const found = candidates.find((c) => existsSync(c))
  if (!found) throw new Error('Chrome not found: set CHROME to its executable')
  return found
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Opens `<base>/` in WebGL or `<base>/?renderer=webgpu`, waits for the house (and `WebGPURenderer.init`),
 * pauses the render loop and LOCKS the ambience: the simulation pushes its own weather otherwise, in the
 * middle of a measurement. `page.evalJs` runs an expression in the page and returns its value.
 */
export async function openHouse(base, renderer, port) {
  const url = `${base.replace(/\/$/, '')}/${renderer === 'webgpu' ? '?renderer=webgpu' : '?renderer=webgl'}`
  const profile = path.join(tmpdir(), `kasbah-bench-3d-${port}`)
  mkdirSync(profile, { recursive: true })
  const chrome = spawn(chromePath(), [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--window-size=1920,1000', '--window-position=0,0', ...(process.env.EXTRA_ARGS ? process.env.EXTRA_ARGS.split(' ') : []), url,
  ], { stdio: 'ignore' })
  const json = async (p) => {
    for (let i = 0; i < 50; i++) { try { return await fetch(`http://localhost:${port}${p}`).then((r) => r.json()) } catch { await sleep(200) } }
    throw new Error('Chrome did not open its DevTools port')
  }
  let list = []
  for (let i = 0; i < 50 && !list.some((x) => x.type === 'page' && x.url.startsWith(base)); i++) { list = await json('/json'); await sleep(200) }
  const ws = new WebSocket(list.find((x) => x.type === 'page' && x.url.startsWith(base)).webSocketDebuggerUrl)
  let id = 0
  const pending = new Map(), errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result) }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300))
  }
  await new Promise((r) => (ws.onopen = r))
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 })
    if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails))
    return r.result.value
  }
  await send('Runtime.enable')
  // a dev server that has just started optimises its dependencies, then RELOADS the page: wait again
  for (let attempt = 0; ; attempt++) {
    try {
      await evalJs(`new Promise((r) => { const t = setInterval(() => { const s = window.kasbahScene; if (s && s.house && (${renderer !== 'webgpu'} || s.gpuReady)) { clearInterval(t); r() } }, 100) })`)
      break
    } catch (e) {
      if (attempt >= 5 || !/navigated|context/i.test(String(e))) throw e
      await sleep(2000)
    }
  }
  await sleep(5000)   // textures, shadow capture, first compilations
  await evalJs(`(() => {
    const s = window.kasbahScene
    s.setPaused(true)
    const own = s.setAppearance.bind(s)
    s.setAppearance = (n) => { if (n && n.ambience && !n.__bench) { const { ambience, ...rest } = n; return own(rest) } return own(n) }
  })()`)
  return {
    evalJs, send, errors,
    /**
     * PNG of the window, after `settleMs` then `frames` renders, each in an animation frame as the app
     * does. Waits first for the scene to show frames again: a new style or ambience compiles its shaders
     * while the previous frame stays (`compiling`, WebGL).
     */
    async capture(file, settleMs = 0, frames = 30) {
      await sleep(settleMs)
      await evalJs(`new Promise((r) => { const t0 = performance.now(), t = setInterval(() => { const s = window.kasbahScene; if ((!s.compiling && !s.holdFrames) || performance.now() - t0 > 20000) { clearInterval(t); r() } }, 50) })`)
      await evalJs(`(async () => { const s = window.kasbahScene; for (let i = 0; i < ${frames}; i++) { await new Promise((r) => requestAnimationFrame(r)); s.render(false) } await new Promise((r) => requestAnimationFrame(r)) })()`)
      const { data } = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(file, Buffer.from(data, 'base64'))
    },
    close() { ws.close(); chrome.kill() },
  }
}

/** An ambience, forced past the lock of `openHouse`. */
export const ambience = (a) => `window.kasbahScene.setAppearance({ __bench: true, ambience: ${JSON.stringify({ windKmh: 0, windDirDeg: 0, cloudiness: 0, ...a })} })`
export const DAY = ambience({ sunAltitudeDeg: 35, sunAzimuthDeg: 200 })
export const NIGHT = ambience({ sunAltitudeDeg: -25, sunAzimuthDeg: 0 })
/** Every dimmable lamp on, at full brightness. */
export const ALL_LAMPS = `(() => { const s = window.kasbahScene, st = {}; for (const [k, v] of Object.entries(s.states)) st[k] = v && 'brightness' in v ? { ...v, on: true, brightness: 100 } : v; s.updateStates(st, true) })()`
