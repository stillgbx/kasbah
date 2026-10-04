import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sendError } from '../http/errors'
import { deleteUser, passwordSchema, readUsers, saveUser, userNameSchema } from './auth'

// Comptes du serveur MCP pour Réglages : les noms seulement, jamais les mots de passe hachés.
// Comme le reste de `/api`, ouvert au réseau local sans authentification ; sous le nom PUBLIC
// (`MCP_PUBLIC_URL`), le filtre global `publicHostFilter` (`auth.ts`) le rend introuvable.

export interface McpUserRoutesDeps {
  usersFile: string
}

export function registerMcpUserRoutes(app: FastifyInstance, deps: McpUserRoutesDeps): void {
  const list = (names: string[]) => ({ users: names.map((name) => ({ name })) })

  app.get('/api/mcp/users', async () =>
    list((await readUsers(deps.usersFile)).users.map((u) => u.name)))

  app.put<{ Params: { name: string } }>('/api/mcp/users/:name', async (req) => {
    const name = userNameSchema.parse(req.params.name)
    const { password } = z.object({ password: passwordSchema }).parse(req.body)
    return list(await saveUser(deps.usersFile, name, password))
  })

  app.delete<{ Params: { name: string } }>('/api/mcp/users/:name', async (req, reply) => {
    const names = await deleteUser(deps.usersFile, req.params.name)
    return names ? list(names) : sendError(reply, 404, 'NOT_FOUND', `no MCP user "${req.params.name}"`)
  })
}
