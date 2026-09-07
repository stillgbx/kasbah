import { CommandNotAllowedError, HouseValidationError, type ApiError } from '@kasbah/shared'
import type { FastifyReply } from 'fastify'
import { ZodError } from 'zod'
import { PluginError, type PluginErrorCode } from '../core/plugin'

const STATUS_BY_CODE: Record<PluginErrorCode, number> = {
  UNSUPPORTED_COMMAND: 400,
  NEEDS_PAIRING: 409,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  DEVICE_UNAVAILABLE: 503,
  TIMEOUT: 504,
  NOT_IMPLEMENTED: 501,
}

export function errorBody(code: string, message: string): ApiError {
  return { error: { code, message } }
}

export function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send(errorBody(code, message))
}

/** Traduit toute erreur levée par une route en (statut, code, message). */
export function describeError(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof PluginError) return { status: STATUS_BY_CODE[err.code], code: err.code, message: err.message }
  if (err instanceof CommandNotAllowedError) return { status: 400, code: err.code, message: err.message }
  if (err instanceof HouseValidationError) return { status: 400, code: 'INVALID_HOUSE', message: err.issues.map((i) => `${i.path}: ${i.message}`).join('; ') }
  if (err instanceof ZodError) {
    return { status: 400, code: 'INVALID_BODY', message: err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') }
  }
  const e = err as { statusCode?: number; code?: string; message?: string }
  if (typeof e?.statusCode === 'number' && e.statusCode < 500) return { status: e.statusCode, code: e.code ?? 'BAD_REQUEST', message: e.message ?? 'bad request' }
  return { status: 500, code: 'INTERNAL', message: e?.message ?? 'internal error' }
}
