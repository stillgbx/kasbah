import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

const DEV_PORT = 5173
const SERVER = 'http://localhost:8787'

// `base: './'` : le build est servi par le serveur Fastify sous / (repli SPA), ou depuis un sous-dossier.
export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: DEV_PORT,
    strictPort: true,
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
