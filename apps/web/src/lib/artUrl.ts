// Une pochette YouTube Music dans une autre taille. Le catalogue les livre en 120 px (assez pour une
// ligne ou une tuile) ; une pochette affichée en grand (le détail d'un album) les redemande plus
// grandes au CDN, qui les sert à la taille demandée. Même réécriture que `upgradeArtUrl` côté
// serveur (plugin ytmusic, `mapping.ts`).

export function artAt(url: string | null | undefined, size: number): string | null {
  if (!url) return null
  if (/googleusercontent\.com|ggpht\.com/i.test(url)) {
    const token = `=w${size}-h${size}-l90-rj`
    return /=w\d+-h\d+/i.test(url) ? url.replace(/=w\d+-h\d+[^=/?#]*/i, token) : `${url}${token}`
  }
  if (/i\.ytimg\.com/i.test(url)) {
    // pas `maxresdefault` : il manque pour bien des vidéos, et l'image serait cassée
    const leaf = size <= 120 ? 'default.jpg' : size <= 320 ? 'mqdefault.jpg' : 'hqdefault.jpg'
    return url.replace(/\/(default|mqdefault|hqdefault|sddefault|maxresdefault)\.jpg/i, `/${leaf}`)
  }
  return url
}
