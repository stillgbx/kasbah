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

// `base: './'` : le build est servi par le serveur Fastify sous / (repli SPA), ou depuis un sous-dossier.
export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: DEV_PORT,
    strictPort: FIXED_PORT,
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
