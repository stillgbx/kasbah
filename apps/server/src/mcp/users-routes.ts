import { rightsSchema } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sendError } from '../http/errors'
import { deleteUser, passwordSchema, readUsers, saveUser, setUserRights, userNameSchema } from './auth'

// MCP server accounts for Settings: the names and the rights, never the hashed passwords.
// Like the rest of `/api`, open to the local network without authentication; under the PUBLIC
// name (`MCP_PUBLIC_URL`), the global `publicHostFilter` (`auth.ts`) makes it unreachable.

export interface McpUserRoutesDeps {
  usersFile: string
}

export function registerMcpUserRoutes(app: FastifyInstance, deps: McpUserRoutesDeps): void {
  // `rights` only when the account has a list: absent = every right
  const list = async () => ({
    users: (await readUsers(deps.usersFile)).users.map((u) => ({ name: u.name, ...(u.rights ? { rights: u.rights } : {}) })),
  })

  app.get('/api/mcp/users', list)

  app.put<{ Params: { name: string } }>('/api/mcp/users/:name', async (req) => {
    const name = userNameSchema.parse(req.params.name)
    const { password } = z.object({ password: passwordSchema }).parse(req.body)
    await saveUser(deps.usersFile, name, password)
    return list()
  })

  app.put<{ Params: { name: string } }>('/api/mcp/users/:name/rights', async (req, reply) => {
    const { rights } = z.object({ rights: rightsSchema.nullable() }).parse(req.body)
    if (!await setUserRights(deps.usersFile, req.params.name, rights)) return sendError(reply, 404, 'NOT_FOUND', `no MCP user "${req.params.name}"`)
    return list()
  })

  app.delete<{ Params: { name: string } }>('/api/mcp/users/:name', async (req, reply) => {
    const names = await deleteUser(deps.usersFile, req.params.name)
    return names ? list() : sendError(reply, 404, 'NOT_FOUND', `no MCP user "${req.params.name}"`)
  })
}
