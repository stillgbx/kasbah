// Découpage d'un flux MP4 fragmenté (fMP4) en boîtes, et lecture du strict nécessaire dans `moov`
// pour annoncer au navigateur les codecs (`video/mp4; codecs="avc1.…, mp4a.40.2"`) — c'est ce que
// Media Source Extensions exige avant le premier octet. PUR : des Buffers en entrée, des Buffers
// et des chaînes en sortie ; testable sans ffmpeg.

export interface Mp4Box { type: string; data: Buffer }

/**
 * Accumule des morceaux arbitraires (ce que ffmpeg écrit sur stdout) et rend les boîtes MP4
 * complètes au fil de l'eau. Une boîte = taille sur 4 octets, type sur 4, puis le contenu ; la
 * taille 1 annonce une taille sur 8 octets (jamais vue chez ffmpeg en fragmenté, gérée quand même).
 */
export class Mp4BoxParser {
  private pending: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): Mp4Box[] {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk
    const out: Mp4Box[] = []
    for (;;) {
      if (this.pending.length < 8) break
      let size = this.pending.readUInt32BE(0)
      let header = 8
      if (size === 1) {
        if (this.pending.length < 16) break
        size = Number(this.pending.readBigUInt64BE(8))
        header = 16
      }
      if (size < header) throw new Error(`invalid MP4 box size ${size}`)
      if (this.pending.length < size) break
      out.push({ type: this.pending.toString('latin1', 4, 8), data: this.pending.subarray(0, size) })
      this.pending = this.pending.subarray(size)
    }
    return out
  }
}

/** Première occurrence d'une boîte par son type, à n'importe quelle profondeur (recherche d'octets). */
function findBox(data: Buffer, type: string): Buffer | undefined {
  let from = 0
  for (;;) {
    const i = data.indexOf(type, from, 'latin1')
    if (i < 4) return undefined
    const size = data.readUInt32BE(i - 4)
    if (size >= 8 && i - 4 + size <= data.length) return data.subarray(i - 4, i - 4 + size)
    from = i + 4
  }
}

/**
 * Chaîne `codecs` MSE d'après `moov` : le profil H.264 vient de la boîte `avcC` (profil,
 * compatibilité, niveau, en hexadécimal) ; l'audio AAC est annoncé `mp4a.40.2` (AAC-LC, ce que
 * les caméras Nest émettent) dès qu'une entrée `mp4a` existe. Sans `avcC`, on ne sait pas décrire
 * la vidéo : `undefined`, et l'appelant refuse le flux plutôt que d'envoyer une chaîne fausse.
 */
export function mseMimeFromMoov(moov: Buffer): string | undefined {
  const avcC = findBox(moov, 'avcC')
  if (!avcC || avcC.length < 12) return undefined
  const hex = (b: number) => b.toString(16).padStart(2, '0').toUpperCase()
  const codecs = [`avc1.${hex(avcC[9]!)}${hex(avcC[10]!)}${hex(avcC[11]!)}`]
  if (findBox(moov, 'mp4a')) codecs.push('mp4a.40.2')
  return `video/mp4; codecs="${codecs.join(', ')}"`
}
