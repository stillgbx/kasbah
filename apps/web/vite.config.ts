import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { parseEnv } from 'node:util'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

// 5173 by default, but `PORT` takes precedence: a second front (an agent's preview, a second
// work session) must be able to settle elsewhere. On an imposed port, sliding over by one is worth
// more than failing — EXCEPT when `KASBAH_SERVER` also designates the server: that is the signature of a
// full stack launched at fixed addresses (cf. `.claude/launch.json`), and a preview pane
// stuck on a port shows nothing if the front settled elsewhere. Failing is visible, sliding is not.
const DEV_PORT = Number(process.env.PORT ?? 5173)
// Without `KASBAH_SERVER`, the server's own port, read the way it reads it (environment, then
// `apps/server/.env`, then 8787): a dev clone moved off 8787, the production's port, keeps its front.
function serverPort(): string {
  if (process.env.KASBAH_PORT) return process.env.KASBAH_PORT
  try { return parseEnv(readFileSync(new URL('../server/.env', import.meta.url), 'utf8')).KASBAH_PORT ?? '8787' } catch { return '8787' }
}
const SERVER = process.env.KASBAH_SERVER ?? `http://localhost:${serverPort()}`
const FIXED_PORT = process.env.PORT === undefined || process.env.KASBAH_SERVER !== undefined

// Build identifier: written into the app (`__KASBAH_BUILD__`) and beside it (`build-id.txt`),
// which the server relays in the WS snapshot. A screen left open on a replaced build sees it
// differ and offers to reload. In dev, empty: Vite serves the up-to-date app, nothing to compare.
const BUILD_ID = Date.now().toString(36)

// An import nothing resolves stops the build HERE, before any file is written. Vite does fail on it
// too, but only once Rolldown has already emptied `dist` and written chunks that keep the bare
// `from "@kasbah/shared"`: every screen reloaded after a failed update (`scripts/supervisor.mjs`)
// then broke. Seen with `node_modules` copied from another clone, its workspace junctions empty.
const failUnresolved: Plugin = {
  name: 'kasbah-fail-unresolved',
  apply: 'build',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!importer || source.startsWith('\0')) return null
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
    if (!resolved) this.error(`cannot resolve "${source}" from ${importer}`)
    return resolved
  },
}

// `base: '/'`: absolute paths, without which a reloaded `/automations/new` would look for its files under
// `/automations/assets/`. The build is served by the Fastify server under / (SPA fallback).
export default defineConfig(({ command }) => ({
  plugins: [
    failUnresolved, vue(), vuetify({ autoImport: true }),
    { name: 'kasbah-build-id', apply: 'build', generateBundle() { this.emitFile({ type: 'asset', fileName: 'build-id.txt', source: BUILD_ID }) } },
  ],
  define: { __KASBAH_BUILD__: JSON.stringify(command === 'build' ? BUILD_ID : '') },
  base: '/',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // MapLibre loads its worker through `new URL('./maplibre-gl-worker.mjs', import.meta.url)`: once
  // pre-bundled in `.vite/deps`, this URL no longer points to anything, the worker does not start and
  // the VECTOR tiles are never decoded (the satellite, raster, worked; the plan stayed
  // empty, with no error). Served as is from node_modules, the worker is found. The build, for its part, does NOT
  // see it (computed address, not literal): `src/lib/maplibreWorker.ts` makes it get bundled.
  // Same trap for Open-Meteo's `.om` file reader (the radar's AROME layer): its WASM is
  // found through `new URL('om_reader_wasm.web.wasm', import.meta.url)`.
  optimizeDeps: { exclude: ['maplibre-gl', '@openmeteo/weather-map-layer', '@openmeteo/file-reader', '@openmeteo/file-format-wasm'] },
  server: {
    port: DEV_PORT,
    strictPort: FIXED_PORT,
    host: true, // reachable from the other devices on the LAN
    allowedHosts: ['kasbah.home.internal', 'kasbah'],
    proxy: {
      // `ws: true`: the cameras' video streams are WebSockets under /api/plugins/<id>/cameras/…
      '/api': { target: SERVER, ws: true },
      '/ws': { target: SERVER.replace('http', 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Rolldown (Vite 8): grouping of large dependencies into stable chunks
        codeSplitting: {
          groups: [
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ },
            { name: 'vuetify', test: /[\\/]node_modules[\\/]vuetify[\\/]/ },
          ],
        },
      },
    },
  },
}))
