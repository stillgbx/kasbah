// A YouTube Music cover in another size. The catalog delivers them at 120 px (enough for a
// line or a tile); a cover displayed large (an album's detail) re-requests them
// larger from the CDN, which serves them at the requested size. Same rewrite as `upgradeArtUrl` on the
// server side (ytmusic plugin, `mapping.ts`).

export function artAt(url: string | null | undefined, size: number): string | null {
  if (!url) return null
  if (/googleusercontent\.com|ggpht\.com/i.test(url)) {
    const token = `=w${size}-h${size}-l90-rj`
    return /=w\d+-h\d+/i.test(url) ? url.replace(/=w\d+-h\d+[^=/?#]*/i, token) : `${url}${token}`
  }
  if (/i\.ytimg\.com/i.test(url)) {
    // not `maxresdefault`: it is missing for many videos, and the image would be broken
    const leaf = size <= 120 ? 'default.jpg' : size <= 320 ? 'mqdefault.jpg' : 'hqdefault.jpg'
    return url.replace(/\/(default|mqdefault|hqdefault|sddefault|maxresdefault)\.jpg/i, `/${leaf}`)
  }
  return url
}
