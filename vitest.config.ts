import { defineConfig } from 'vitest/config'

// A single `vitest` entry point at the root: each workspace keeps its own
// vitest.config.ts (node vs happy-dom environment, aliases, Vue plugins).
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
})
