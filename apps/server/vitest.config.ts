import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'server', environment: 'node', include: ['src/**/*.test.ts', 'test/**/*.test.ts'], setupFiles: ['./test/state-isolation.ts', './test/fastify-warmup.ts'] } })
