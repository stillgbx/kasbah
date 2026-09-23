import type { SpawnFn } from './proxy'

// Lancer yt-dlp et lire sa sortie : commun aux sources qui s'en servent pour trouver le flux d'une
// piste (YouTube Music, Mixcloud). Ce que chacune lui passe, et comment elle choisit un format dans
// sa réponse, lui reste propre.

export function runCapture(command: string, args: string[], spawnImpl: SpawnFn): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawnImpl(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (c: string) => { stdout += c })
    proc.stderr.on('data', (c: string) => { stderr += c })
    proc.on('error', reject)
    proc.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}
