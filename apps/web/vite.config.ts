import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

// 5173 par défaut, mais `PORT` prend le dessus : un second front (preview d'un agent, deuxième
// session de travail) doit pouvoir se poser ailleurs. `strictPort` ne vaut alors que pour le port
// par défaut — sur un port imposé, échouer serait pire que glisser d'un cran.
const DEV_PORT = Number(process.env.PORT ?? 5173)
const SERVER = process.env.KASBAH_SERVER ?? 'http://localhost:8787'

// `base: './'` : le build est servi par le serveur Fastify sous / (repli SPA), ou depuis un sous-dossier.
export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: DEV_PORT,
    strictPort: process.env.PORT === undefined,
    host: true, // accessible depuis la tablette sur le LAN
    proxy: {
      '/api': { target: SERVER },
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
