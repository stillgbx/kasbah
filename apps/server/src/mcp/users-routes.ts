import { rightsSchema } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sendError } from '../http/errors'
import { deleteUser, passwordSchema, readUsers, saveUser, setUserRights, setUserRole, userNameSchema } from './auth'

// MCP server accounts for Settings: the names, the rights and the roles, never the hashed passwords.
// Like the rest of `/api`, open to the local network without authentication; under the PUBLIC
// name (`MCP_PUBLIC_URL`), the global `publicHostFilter` (`auth.ts`) makes it unreachable.

export interface McpUserRoutesDeps {
  usersFile: string
}

const roleSchema = z.object({ admin: z.boolean().optional(), house: z.boolean().optional() })
  .refine((r) => r.admin !== undefined || r.house !== undefined, 'admin or house')

export function registerMcpUserRoutes(app: FastifyInstance, deps: McpUserRoutesDeps): void {
  // `rights` only when the account has a list (absent = every right); `admin` and `house` only when true
  const list = async () => ({
    users: (await readUsers(deps.usersFile)).users.map(({ password: _p, ...u }) => u),
  })
  const lastAdmin = (reply: Parameters<typeof sendError>[0]) => sendError(reply, 409, 'LAST_ADMIN', 'the last admin cannot go: make another account admin first')

  app.get('/api/mcp/users', list)

  app.put<{ Params: { name: string } }>('/api/mcp/users/:name', async (req) => {
    const name = userNameSchema.parse(req.params.name)
    // rights and roles of a new account, set in the same write (an existing account keeps its own)
    const { password, ...init } = z.object({
      password: passwordSchema, rights: rightsSchema.nullable().optional(), admin: z.boolean().optional(), house: z.boolean().optional(),
    }).parse(req.body)
    await saveUser(deps.usersFile, name, password, init)
    return list()
  })

  app.put<{ Params: { name: string } }>('/api/mcp/users/:name/rights', async (req, reply) => {
    const { rights } = z.object({ rights: rightsSchema.nullable() }).parse(req.body)
    if (!await setUserRights(deps.usersFile, req.params.name, rights)) return sendError(reply, 404, 'NOT_FOUND', `no MCP user "${req.params.name}"`)
    return list()
  })

  app.put<{ Params: { name: string } }>('/api/mcp/users/:name/role', async (req, reply) => {
    const result = await setUserRole(deps.usersFile, req.params.name, roleSchema.parse(req.body))
    if (result === 'not_found') return sendError(reply, 404, 'NOT_FOUND', `no MCP user "${req.params.name}"`)
    if (result === 'last_admin') return lastAdmin(reply)
    return list()
  })

  app.delete<{ Params: { name: string } }>('/api/mcp/users/:name', async (req, reply) => {
    const names = await deleteUser(deps.usersFile, req.params.name)
    if (names === 'last_admin') return lastAdmin(reply)
    return names ? list() : sendError(reply, 404, 'NOT_FOUND', `no MCP user "${req.params.name}"`)
  })
}
