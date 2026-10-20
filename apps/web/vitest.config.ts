import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// No vuetify plugin here: component tests mount Vuetify explicitly (test/setup.ts).
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // fixed build: the update tests compare the screen to another build
  define: { __KASBAH_BUILD__: JSON.stringify('test-build') },
  test: {
    name: 'web',
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    server: { deps: { inline: ['vuetify'] } },
  },
})
