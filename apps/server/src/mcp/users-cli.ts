import { createInterface } from 'node:readline'
import { deleteUser, mcpAuthConfigSchema, passwordSchema, readUsers, saveUser, setUserRole, userNameSchema } from './auth'

// The accounts of the app and of the MCP server (`mcp-users.json` next to the server `.env`), as a
// fallback for Settings, and the way to create the first admin:
//   npm run account -w @kasbah/server -- add <name> [--admin]   (asks for the password, replaces it if it exists)
//   npm run account -w @kasbah/server -- remove <name>          (also cuts its tokens)
//   npm run account -w @kasbah/server -- admin <name> on|off
//   npm run account -w @kasbah/server -- house <name> on|off    (one house account: marking one unmarks the others)
//   npm run account -w @kasbah/server -- list

/**
 * Reads passwords without echo. A single interface, read as an iterator: lines that already arrived
 * (redirected input) wait for the next question instead of being lost.
 */
function prompter() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY })
  ;(rl as unknown as { _writeToOutput(s: string): void })._writeToOutput = () => {}
  const lines = rl[Symbol.asyncIterator]()
  return {
    async ask(prompt: string) {
      process.stdout.write(prompt)
      const { value } = await lines.next()
      process.stdout.write('\n')
      return (value as string | undefined) ?? ''
    },
    close: () => rl.close(),
  }
}

const fail = (message: string) => { console.error(message); process.exit(1) }

const [command, rawName, option] = process.argv.slice(2)
const path = mcpAuthConfigSchema.parse(process.env).MCP_USERS_FILE
const LAST_ADMIN = 'C’est le dernier admin : nommer d’abord un autre compte admin.'

if (command === 'list') {
  const roles = (u: { admin?: true; house?: true }) => [u.admin && 'admin', u.house && 'maison'].filter(Boolean).join(', ')
  console.log((await readUsers(path)).users.map((u) => (roles(u) ? `${u.name} (${roles(u)})` : u.name)).join('\n') || '(aucun compte)')
} else if ((command === 'admin' || command === 'house') && rawName && (option === 'on' || option === 'off')) {
  const result = await setUserRole(path, rawName, { [command]: option === 'on' })
  if (result === 'not_found') fail(`Pas de compte "${rawName}".`)
  if (result === 'last_admin') fail(LAST_ADMIN)
  console.log(`Rôle enregistré : ${path}`)
} else if (command === 'add' && rawName && (option === undefined || option === '--admin')) {
  const name = userNameSchema.safeParse(rawName)
  if (!name.success) fail('Nom : lettres, chiffres, . _ @ - (64 au plus).')
  const input = prompter()
  const password = await input.ask(`Mot de passe pour ${rawName} : `)
  if (!passwordSchema.safeParse(password).success) fail('8 caractères au moins.')
  if (await input.ask('Encore une fois : ') !== password) fail('Les deux saisies diffèrent.')
  input.close()
  await saveUser(path, name.data!, password)
  if (option === '--admin') await setUserRole(path, name.data!, { admin: true })
  console.log(`Compte enregistré : ${path}`)
} else if (command === 'remove' && rawName) {
  const result = await deleteUser(path, rawName)
  if (result === 'last_admin') fail(LAST_ADMIN)
  if (!result) fail(`Pas de compte "${rawName}".`)
  console.log(`Compte retiré : ${path}`)
} else {
  fail('Usage : account add <nom> [--admin] | remove <nom> | admin <nom> on|off | house <nom> on|off | list')
}
