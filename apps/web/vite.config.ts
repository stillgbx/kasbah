import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

// 5173 par défaut, mais `PORT` prend le dessus : un second front (preview d'un agent, deuxième
// session de travail) doit pouvoir se poser ailleurs. Sur un port imposé, glisser d'un cran vaut
// mieux qu'échouer — SAUF quand `KASBAH_SERVER` désigne aussi le serveur : c'est la signature d'une
// pile complète lancée à des adresses fixes (cf. `.claude/launch.json`), et un volet de preview
// figé sur un port n'affiche rien si le front s'est posé ailleurs. Échouer se voit, glisser non.
const DEV_PORT = Number(process.env.PORT ?? 5173)
const SERVER = process.env.KASBAH_SERVER ?? 'http://localhost:8787'
const FIXED_PORT = process.env.PORT === undefined || process.env.KASBAH_SERVER !== undefined

// `base: '/'` : chemins absolus, sans quoi `/automations/new` rechargé chercherait ses fichiers sous
// `/automations/assets/`. Le build est servi par le serveur Fastify sous / (repli SPA).
export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  base: '/',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // MapLibre charge son worker par `new URL('./maplibre-gl-worker.mjs', import.meta.url)` : une fois
  // pré-empaqueté dans `.vite/deps`, cette URL ne pointe plus sur rien, le worker ne démarre pas et
  // les tuiles VECTORIELLES ne sont jamais décodées (le satellite, raster, marchait ; le plan restait
  // vide, sans erreur). Servi tel quel depuis node_modules, le worker se trouve. Le build, lui, NE le
  // voit pas (adresse calculée, pas littérale) : `src/lib/maplibreWorker.ts` le fait empaqueter.
  // Même piège pour le lecteur de fichiers `.om` d'Open-Meteo (couche AROME du radar) : son WASM est
  // trouvé par `new URL('om_reader_wasm.web.wasm', import.meta.url)`.
  optimizeDeps: { exclude: ['maplibre-gl', '@openmeteo/weather-map-layer', '@openmeteo/file-reader', '@openmeteo/file-format-wasm'] },
  server: {
    port: DEV_PORT,
    strictPort: FIXED_PORT,
    host: true, // accessible depuis les autres appareils du LAN
    allowedHosts: ['kasbah.home.internal', 'kasbah'],
    proxy: {
      // `ws: true` : les flux vidéo des caméras sont des WebSockets sous /api/plugins/<id>/cameras/…
      '/api': { target: SERVER, ws: true },
      '/ws': { target: SERVER.replace('http', 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) : regroupement des grosses dépendances en chunks stables
        codeSplitting: {
          groups: [
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ },
            { name: 'vuetify', test: /[\\/]node_modules[\\/]vuetify[\\/]/ },
          ],
        },
      },
    },
  },
})
