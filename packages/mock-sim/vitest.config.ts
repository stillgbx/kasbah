import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'mock-sim', environment: 'node', include: ['src/**/*.test.ts'] } })
