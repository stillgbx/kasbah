/** File d'attente légère pour les pochettes (dédup URL + concurrence bornée). Pas de worker. */

const MAX_CONCURRENT = 4
let running = 0
const waiters: Array<() => void> = []
/** Une promesse par URL absolue — plusieurs lignes (même album) partagent le fetch. */
const primed = new Map<string, Promise<void>>()

function pump(): void {
  while (running < MAX_CONCURRENT && waiters.length > 0) {
    const next = waiters.shift()
    if (!next) return
    running += 1
    next()
  }
}

function enqueue(task: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    waiters.push(() => {
      void task().finally(() => {
        running -= 1
        resolve()
        pump()
      })
    })
    pump()
  })
}

/** Précharge `url` (cache navigateur ensuite). No-op si déjà en cours / fait. */
export function primeArtUrl(url: string): Promise<void> {
  const key = url.trim()
  if (!key) return Promise.resolve()
  let p = primed.get(key)
  if (!p) {
    p = enqueue(() => new Promise<void>((resolve) => {
      const img = new Image()
      img.referrerPolicy = 'no-referrer'
      img.decoding = 'async'
      img.onload = () => resolve()
      img.onerror = () => resolve()
      img.src = key
    }))
    primed.set(key, p)
  }
  return p
}
