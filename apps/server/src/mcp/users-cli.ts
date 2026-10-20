import { createInterface } from 'node:readline'
import { deleteUser, mcpAuthConfigSchema, passwordSchema, readUsers, saveUser, userNameSchema } from './auth'

// MCP server accounts (`mcp-users.json` next to the server `.env`), as a fallback for Settings:
//   npm run mcp-user -w @kasbah/server -- add <name>      (asks for the password, replaces it if it exists)
//   npm run mcp-user -w @kasbah/server -- remove <name>   (also cuts its tokens)
//   npm run mcp-user -w @kasbah/server -- list

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

const [command, rawName] = process.argv.slice(2)
const path = mcpAuthConfigSchema.parse(process.env).MCP_USERS_FILE

if (command === 'list') {
  console.log((await readUsers(path)).users.map((u) => u.name).join('\n') || '(aucun compte)')
} else if (command === 'add' && rawName) {
  const name = userNameSchema.safeParse(rawName)
  if (!name.success) fail('Nom : lettres, chiffres, . _ @ - (64 au plus).')
  const input = prompter()
  const password = await input.ask(`Mot de passe pour ${rawName} : `)
  if (!passwordSchema.safeParse(password).success) fail('8 caractères au moins.')
  if (await input.ask('Encore une fois : ') !== password) fail('Les deux saisies diffèrent.')
  input.close()
  await saveUser(path, name.data!, password)
  console.log(`Compte enregistré : ${path}`)
} else if (command === 'remove' && rawName) {
  if (!await deleteUser(path, rawName)) fail(`Pas de compte "${rawName}".`)
  console.log(`Compte retiré : ${path}`)
} else {
  fail('Usage : mcp-user add <nom> | remove <nom> | list')
}
