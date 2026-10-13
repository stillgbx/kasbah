import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Pas de plugin vuetify ici : les tests de composants montent Vuetify explicitement (test/setup.ts).
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // build fixe : les tests de la mise à jour comparent l'écran à un autre build
  define: { __KASBAH_BUILD__: JSON.stringify('test-build') },
  test: {
    name: 'web',
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    server: { deps: { inline: ['vuetify'] } },
  },
})
