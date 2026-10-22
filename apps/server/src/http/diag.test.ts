import Fastify, { type FastifyInstance } from 'fastify'
import pino from 'pino'
import { beforeEach, expect, it } from 'vitest'
import { registerDiagRoutes } from './diag'

let lines: Record<string, unknown>[]
let app: FastifyInstance

beforeEach(() => {
  lines = []
  const logger = pino({ level: 'info' }, { write: (s: string) => { lines.push(JSON.parse(s) as Record<string, unknown>) } })
  app = Fastify()
  registerDiagRoutes(app, logger)
})

it('writes the report and the user agent to the log', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/diag', headers: { 'user-agent': 'Mozilla/5.0 Test' },
    payload: { webgl2: { renderer: 'Mesa Intel' } },
  })
  expect(res.statusCode).toBe(204)
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatchObject({ level: 30, msg: 'browser diagnostics', ua: 'Mozilla/5.0 Test', report: { webgl2: { renderer: 'Mesa Intel' } } })
})

it('refuses what is not a JSON object, and logs nothing', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/diag', payload: [1, 2] })
  expect(res.statusCode).toBe(400)
  expect(lines).toHaveLength(0)
})

it('refuses an oversized body', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/diag', payload: { pad: 'x'.repeat(40_000) } })
  expect(res.statusCode).toBe(413)
  expect(lines).toHaveLength(0)
})
