import { defineConfig } from 'vitest/config'

// Un seul point d'entrée `vitest` à la racine : chaque workspace garde son propre
// vitest.config.ts (environnement node vs happy-dom, alias, plugins Vue).
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
})
