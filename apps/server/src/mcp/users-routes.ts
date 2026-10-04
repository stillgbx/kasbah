import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { sendError } from '../http/errors'
import { deleteUser, passwordSchema, readUsers, saveUser, userNameSchema } from './auth'

// Comptes du serveur MCP pour Réglages : les noms seulement, jamais les mots de passe hachés.
// Comme le reste de `/api`, ouvert au réseau local sans authentification ; refusé quand la requête
// arrive sous le nom PUBLIC (`MCP_PUBLIC_URL`), au cas où le tunnel publierait plus que `/mcp`.

export interface McpUserRoutesDeps {
  usersFile: string
  /** Noms d'hôte publics (`McpAuth.publicHosts`). */
  publicHosts: string[]
}

export function registerMcpUserRoutes(app: FastifyInstance, deps: McpUserRoutesDeps): void {
  const lanOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    if (deps.publicHosts.includes(req.hostname)) await sendError(reply, 404, 'NOT_FOUND', 'not found')
  }
  const list = (names: string[]) => ({ users: names.map((name) => ({ name })) })

  app.get('/api/mcp/users', { onRequest: lanOnly }, async () =>
    list((await readUsers(deps.usersFile)).users.map((u) => u.name)))

  app.put<{ Params: { name: string } }>('/api/mcp/users/:name', { onRequest: lanOnly }, async (req) => {
    const name = userNameSchema.parse(req.params.name)
    const { password } = z.object({ password: passwordSchema }).parse(req.body)
    return list(await saveUser(deps.usersFile, name, password))
  })

  app.delete<{ Params: { name: string } }>('/api/mcp/users/:name', { onRequest: lanOnly }, async (req, reply) => {
    const names = await deleteUser(deps.usersFile, req.params.name)
    return names ? list(names) : sendError(reply, 404, 'NOT_FOUND', `no MCP user "${req.params.name}"`)
  })
}
