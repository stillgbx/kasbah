// Server bundle: the @kasbah/* packages (TS sources of the workspaces) are inlined,
// npm dependencies stay external (loaded from node_modules in production).
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@kasbah/'))

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: [...external, 'pino-pretty'],
  banner: { js: '// @kasbah/server — bundle esbuild' },
  logLevel: 'info',
})
