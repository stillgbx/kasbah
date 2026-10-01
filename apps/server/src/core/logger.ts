import pino, { type Logger } from 'pino'

export function createLogger(level: string, pretty: boolean): Logger {
  if (pretty) {
    return pino({ level, transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } } })
  }
  return pino({ level })
}

export const silentLogger: Logger = pino({ level: 'silent' })
