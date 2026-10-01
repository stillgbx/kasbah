import { CatmullRomCurve3, Vector3 } from 'three'

// Un PARCOURS sur tout le terrain, pour ce qui bouge autour de la maison (`parade.ts`, `bats.ts`) :
// une boucle lisse tirée au hasard, qui passe par quelques points pris n'importe où dans le terrain,
// et qui CONTOURNE la maison et la piscine (sauf si on ne lui en donne pas — les fantômes traversent
// les murs). Le JARDIN (arbres, buissons, haies, rochers : `statics`) est planifié lui aussi : un
// segment qui coupe un élément est détourné, et des boucles candidates on garde celle qui en touche
// le moins. Seul ce qui BOUGE — voitures, tondeuse (`around`) — s'évite au passage, relu à chaque
// position : la tondeuse roule, une voiture arrive ou repart.
//
// L'évitement au passage servait d'abord à tout, jardin compris : sur la vraie maison (122 disques),
// les bosquets fusionnaient de proche en proche en disques géants et l'écart envoyait les
// personnages à des dizaines de mètres, hors du terrain (mesuré le 2026-10-01).
//
// Fonction du TEMPS, et non état qu'on intègre : `fly` lit la trajectoire un peu avant et un peu
// après pour poser le nez, la traînée de la moto relit où elle était. La boucle se parcourt à
// vitesse constante (abscisse curviligne) et recommence au bout d'un tour.
//
// Construction : des points de passage tirés dans le terrain (loin du bord, hors des emprises), dans
// un ordre quelconque ; un segment qui couperait une emprise est détourné par ses coins ; puis une
// Catmull-Rom centripète lisse le tout. La courbe finie est ÉCHANTILLONNÉE et refusée si elle
// mord sur une emprise ou sort du terrain — on retire, et en dernier recours on tourne autour.

type XY = readonly [number, number]

export interface Box { min: XY; max: XY }

/** Un petit obstacle rond, dont on s'écarte au passage. */
export interface Circle { x: number; y: number; r: number }

/**
 * Les petits obstacles du moment : le propriétaire du parcours (`Parade`, `Bats`) remplace `list` à
 * chaque pas, le parcours la relit à chaque position.
 */
export interface Obstacles { list: readonly Circle[] }

export interface RoamArea {
  /** Le polygone du terrain, repère local de la maison. */
  terrain: readonly XY[]
  /** Les emprises à contourner (la maison, la piscine) ; vide pour passer à travers. */
  avoid: readonly Box[]
  /** Les obstacles FIXES (le jardin), contournés dès le tracé. Absent = aucun. */
  statics?: readonly Circle[]
  /** Les obstacles qui BOUGENT (voitures, tondeuse), évités au passage. Absent = aucun. */
  around?: Obstacles
}

export interface RoamOptions {
  /** Distance (m) gardée aux emprises. */
  margin?: number
  /** Distance (m) gardée au bord du terrain. */
  edge?: number
  /** Nombre de points de passage. */
  points?: number
  rnd?: () => number
}

/** Une trajectoire : la position au temps `t` (z = 0, à chacun sa hauteur), écrite dans `out`. */
export type Path = (t: number, out: Vector3) => Vector3

interface Rect { x0: number; y0: number; x1: number; y1: number }

export function roam(area: RoamArea, speed: number, opts: RoamOptions = {}): Path {
  const { margin = 2, edge = 1.5, points = 8, rnd = Math.random } = opts
  const poly = area.terrain
  // deux emprises qui se touchent une fois agrandies (la piscine collée à la maison) n'en font qu'une :
  // le coin de l'une tomberait dans l'autre, et aucun détour ne passerait
  const boxes = merge(area.avoid.map((b) => grow({ x0: b.min[0], y0: b.min[1], x1: b.max[0], y1: b.max[1] }, margin)))
  const hit = (x: number, y: number, m: number) => boxes.some((r) => inRect(grow(r, m), x, y))
  const ok = (x: number, y: number, slack: number) =>
    inside(poly, x, y) && edgeDistance(poly, x, y) >= edge * slack && !hit(x, y, -margin * (1 - slack))
  const garden = new CircleGrid(area.statics ?? [])

  // Plusieurs boucles candidates. Le terrain et les emprises sont des règles ; le jardin, une
  // préférence : on garde celle qui touche le moins d'éléments, puis la plus COULANTE (celle dont
  // le virage le plus serré est le plus large). Un jardin trop touffu laisse donc frôler un buisson
  // plutôt que de tourner en rond autour de la maison.
  let best: CatmullRomCurve3 | null = null, bestTouch = Infinity, bestRadius = -1, clean = 0, valid = 0
  for (let attempt = 0; attempt < 30 && clean < CANDIDATES && valid < MAX_VALID; attempt++) {
    const way = waypoints(poly, points, (x, y) => ok(x, y, 1) && !hit(x, y, margin * 0.5) && !garden.hit(x, y, 2 * STATIC_MARGIN), rnd)
    if (way.length < 3) break
    const order = tour(way)
    const free = (x: number, y: number) => ok(x, y, 1)
    const loop = detour(order, boxes, margin, garden, free)
    const bare = detour(order, boxes, margin, NO_GARDEN, free)
    // les coins arrondis d'abord ; s'ils mordent sur une emprise, les coins vifs ; et si les détours du
    // jardin font sortir du terrain, la boucle qui l'ignore (elle le touchera, mais elle reste dedans)
    for (const pts of [spaced(chaikin(chaikin(loop))), spaced(loop), spaced(chaikin(chaikin(bare))), spaced(bare)]) {
      if (pts.length < 3) continue
      const curve = new CatmullRomCurve3(pts.map(([x, y]) => new Vector3(x, y, 0)), true, 'centripetal')
      curve.arcLengthDivisions = Math.max(200, 16 * pts.length, Math.ceil(curve.getLength() / 0.5))   // la table est en pas de paramètre : assez fine sur les segments courts
      curve.updateArcLengths()
      // la courbe lisse peut déborder entre deux points : on la vérifie pour de bon, avec un peu de jeu
      const samples = curve.getSpacedPoints(Math.min(600, Math.ceil(curve.getLength() / 0.5)))
      if (!samples.every((p) => ok(p.x, p.y, 0.5))) continue
      const touch = samples.reduce((n, p) => n + (garden.hit(p.x, p.y, STATIC_MARGIN * 0.5) ? 1 : 0), 0)
      valid++
      if (touch === 0) clean++
      const r = tightestTurn(samples)
      if (touch < bestTouch || (touch === bestTouch && r > bestRadius)) { best = curve; bestTouch = touch; bestRadius = r }
      break
    }
  }
  const base = best ? along(best, speed) : circle(area.terrain, boxes, speed)
  return area.around ? swerve(base, speed, area.around, (x, y) => hit(x, y, -margin * 0.5)) : base
}

/** Nombre de boucles qui ne touchent rien comparées avant de choisir. */
const CANDIDATES = 6
/**
 * Boucles valides au plus : un jardin touffu n'en laisse aucune sans contact, et chacune coûte
 * (~3 ms sur la vraie maison) — on compare alors celles-là, au lieu d'aller au bout des 30 tirages.
 */
const MAX_VALID = 10
/** Distance (m) gardée aux éléments du jardin. */
const STATIC_MARGIN = 0.6

/**
 * Les disques du jardin rangés par cases de 4 m : la vraie maison en compte 122, et chaque
 * échantillon de chaque boucle candidate s'y teste.
 */
class CircleGrid {
  private readonly cells = new Map<string, Circle[]>()
  private readonly reach: number
  constructor(readonly all: readonly Circle[]) {
    this.reach = Math.max(0, ...all.map((c) => c.r))
    for (const c of all) {
      const k = `${Math.floor(c.x / CELL)},${Math.floor(c.y / CELL)}`
      const cell = this.cells.get(k)
      if (cell) cell.push(c)
      else this.cells.set(k, [c])
    }
  }

  /** Le premier disque à moins de `m` (m) de son bord, ou `null`. */
  near(x: number, y: number, m: number): Circle | null {
    if (!this.all.length) return null
    const span = Math.ceil((this.reach + m) / CELL)
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL)
    for (let i = cx - span; i <= cx + span; i++) {
      for (let j = cy - span; j <= cy + span; j++) {
        for (const c of this.cells.get(`${i},${j}`) ?? []) if (Math.hypot(x - c.x, y - c.y) < c.r + m) return c
      }
    }
    return null
  }

  hit(x: number, y: number, m: number): boolean {
    return this.near(x, y, m) !== null
  }

  /** Le disque que le segment `a`-`b` coupe (à `m` près) le plus tôt, ou `null`. */
  crossing(a: XY, b: XY, m: number): Circle | null {
    let best: Circle | null = null, bestT = Infinity
    for (const c of this.all) {
      const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1
      const t = Math.max(0, Math.min(1, ((c.x - a[0]) * vx + (c.y - a[1]) * vy) / l2))
      if (Math.hypot(a[0] + t * vx - c.x, a[1] + t * vy - c.y) < c.r + m && t < bestT) { best = c; bestT = t }
    }
    return best
  }
}
const CELL = 4
const NO_GARDEN = new CircleGrid([])

/**
 * Le rayon (m) du virage le plus serré d'une boucle échantillonnée à pas régulier : l'angle dont le
 * cap tourne sur une fenêtre de quelques mètres, rapporté à sa longueur.
 */
function tightestTurn(samples: readonly Vector3[]): number {
  const n = samples.length - 1                           // le dernier point répète le premier
  const step = samples[0]!.distanceTo(samples[1]!) || 1e-6
  const w = Math.max(1, Math.round(1 / step))            // fenêtre de ~1 m : un nœud de 20 cm s'y voit
  const heading = (i: number) => {
    const a = samples[((i % n) + n) % n]!, b = samples[(((i + 1) % n) + n) % n]!
    return Math.atan2(b.y - a.y, b.x - a.x)
  }
  let min = Infinity
  for (let i = 0; i < n; i++) {
    let turn = Math.abs(heading(i + w) - heading(i))
    if (turn > Math.PI) turn = 2 * Math.PI - turn
    min = Math.min(min, turn > 1e-6 ? (w * step) / turn : Infinity)
  }
  return min
}

/**
 * Un ordre de visite sans croisement : plus proche voisin, puis 2-opt (on décroise deux segments
 * tant que ça raccourcit la boucle). Un ordre au hasard faisait des huit et des demi-tours.
 */
function tour(way: readonly XY[]): XY[] {
  const left = [...way], out: XY[] = [left.shift()!]
  while (left.length) {
    const last = out[out.length - 1]!
    let k = 0
    for (let i = 1; i < left.length; i++) if (dist(last, left[i]!) < dist(last, left[k]!)) k = i
    out.push(left.splice(k, 1)[0]!)
  }
  for (let improved = true, pass = 0; improved && pass < 20; pass++) {
    improved = false
    for (let i = 0; i < out.length - 1; i++) {
      for (let j = i + 2; j < out.length - (i === 0 ? 1 : 0); j++) {
        const a = out[i]!, b = out[i + 1]!, c = out[j]!, d = out[(j + 1) % out.length]!
        if (dist(a, c) + dist(b, d) < dist(a, b) + dist(c, d) - 1e-9) {
          out.splice(i + 1, j - i, ...out.slice(i + 1, j + 1).reverse())
          improved = true
        }
      }
    }
  }
  return out
}

/** Écart minimal (m) entre deux points de contrôle : plus près, la Catmull-Rom y fait un nœud serré. */
const MIN_GAP = 1.5

/** Retire les points de contrôle trop près du précédent gardé (boucle fermée : le dernier aussi du premier). */
function spaced(loop: readonly XY[]): XY[] {
  const out: XY[] = []
  for (const p of loop) if (!out.length || dist(out[out.length - 1]!, p) >= MIN_GAP) out.push(p)
  while (out.length > 1 && dist(out[out.length - 1]!, out[0]!) < MIN_GAP) out.pop()
  return out
}

/** Une passe de Chaikin sur une boucle fermée : chaque coin est remplacé par deux points à 1/4 et 3/4. */
function chaikin(loop: readonly XY[]): XY[] {
  const out: XY[] = []
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!, b = loop[(i + 1) % loop.length]!
    out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]])
  }
  return out
}

/**
 * Marge (m) ajoutée au rayon d'un obstacle mobile. Sous `STATIC_MARGIN` : une voiture garée, déjà
 * contournée par le tracé, ne déclenche pas d'écart en plus.
 */
const SWERVE_MARGIN = 0.5
/** En deçà (m), un obstacle est « sur » le trajet : son côté ne se décide plus sur le signe. */
const SIDE_DEADBAND = 0.05
/** Part de la demi-fenêtre où l'écart est entier. */
const PLATEAU = 0.35
/** Distance (m) au bord d'un obstacle sous laquelle le garde-fou reporte le point. */
const GUARD = 0.15

const clusters = new WeakMap<readonly Circle[], readonly Circle[]>()
/** Rayon (m) au-delà duquel deux obstacles mobiles ne fusionnent plus (deux voitures, oui ; un parking, non). */
const MAX_CLUSTER = 6

/**
 * Les obstacles trop proches pour passer entre eux (deux voitures garées côte à côte, un bosquet)
 * fondus en un seul disque qui les contient : éviter l'un poussait sur l'autre, et les deux écarts
 * se battaient (mesuré : personnages dans une voiture, virages de 15 cm). Calculé une fois par liste
 * (le propriétaire la remplace à chaque pas), pas à chaque position.
 */
function clustered(list: readonly Circle[]): readonly Circle[] {
  let out = clusters.get(list)
  if (out) return out
  const cs = list.map((c) => ({ ...c }))
  for (let merged = true; merged;) {
    merged = false
    for (let i = 0; i < cs.length && !merged; i++) {
      for (let j = i + 1; j < cs.length && !merged; j++) {
        const a = cs[i]!, b = cs[j]!, d = Math.hypot(b.x - a.x, b.y - a.y)
        if (d >= a.r + b.r + 2 * SWERVE_MARGIN) continue
        // le plus petit disque qui contient les deux ; plafonné : au-delà, on garde les deux
        const r = Math.max(a.r, b.r, (d + a.r + b.r) / 2)
        if (r > MAX_CLUSTER) continue
        const k = d > 1e-9 && r > a.r ? (r - a.r) / d : 0
        cs[i] = r === b.r && b.r >= a.r + d ? b : { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, r }
        cs.splice(j, 1)
        merged = true
      }
    }
  }
  out = cs
  clusters.set(list, out)
  return out
}

/**
 * S'ÉCARTE des petits obstacles, par RENCONTRE : pour chaque obstacle proche, on cherche où le
 * parcours de base passe au plus près (sur une fenêtre de temps autour de `t`), on choisit le côté
 * une fois pour toute la rencontre — à l'opposé de l'obstacle, ou l'autre côté si celui-là entre
 * dans une emprise — et on décale en travers du cap PRIS À CE PASSAGE, d'autant qu'il faut pour
 * passer à `R`, avec une cloche centrée sur le passage au plus près.
 *
 * Un premier essai repoussait le point RADIALEMENT depuis le centre de l'obstacle : quand le
 * parcours passait par ce centre, la poussée changeait de sens d'un coup et le personnage sautait
 * de l'autre côté (mesuré : rayon de virage 0 sur deux squelettes). Ici, rien ne dépend de `t` qu'à
 * travers des fonctions continues, et le passage au plus près est affiné (pas pris sur la grille
 * d'échantillons, qui bouge avec `t`).
 */
function swerve(base: Path, speed: number, obstacles: Obstacles, blocked: (x: number, y: number) => boolean): Path {
  const q = new Vector3(), a = new Vector3(), b = new Vector3()
  const grid = new Float64Array(21)
  const away = (tt: number, o: Circle) => { base(tt, q); return Math.hypot(q.x - o.x, q.y - o.y) }
  /** Le cap unitaire du parcours de base au temps `tt`. */
  const heading = (tt: number): [number, number] => {
    base(tt - 0.05, a); base(tt + 0.05, b)
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return [(b.x - a.x) / l, (b.y - a.y) / l]
  }
  return (t, out) => {
    base(t, out)
    const x0 = out.x, y0 = out.y
    let dx = 0, dy = 0
    for (const o of clustered(obstacles.list)) {
      const R = o.r + SWERVE_MARGIN
      const W = (2 * R) / speed + 0.5                    // on commence à s'écarter ~2 R avant
      if (Math.hypot(x0 - o.x, y0 - o.y) > R + speed * W) continue
      // chaque passage au plus près — chaque MINIMUM LOCAL de la distance sur la fenêtre — est une
      // rencontre à part. Prendre le seul minimum global faisait basculer d'un passage à l'autre quand
      // le parcours contourne l'obstacle (deux passages proches), et le côté avec : le personnage
      // sautait d'un bord à l'autre. Un minimum local garde son instant tant qu'il est dans la fenêtre.
      // la grille déborde de deux pas de chaque côté : un minimum qui entre dans la fenêtre est vu
      // avant, quand sa cloche vaut encore zéro (sinon il apparaîtrait d'un coup, déjà levé)
      const N = 16, h = (2 * W) / N, t0 = t - W - 2 * h
      for (let k = 0; k <= N + 4; k++) grid[k] = away(t0 + k * h, o)
      for (let k = 1; k < N + 4; k++) {
        // strict d'un côté : un palier de deux valeurs égales ne compte qu'une fois
        if (grid[k]! >= grid[k - 1]! || grid[k]! > grid[k + 1]! || grid[k]! >= R + h * speed) continue
        // affiné par trichotomie entre les deux voisins : l'instant ne dépend plus de la grille
        let lo = t0 + (k - 1) * h, hi = t0 + (k + 1) * h
        for (let it = 0; it < 12; it++) {
          const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3
          if (away(m1, o) < away(m2, o)) hi = m2
          else lo = m1
        }
        const tc = (lo + hi) / 2
        if (away(tc, o) >= R) continue
        const qx = q.x, qy = q.y
        const [cx, cy] = heading(tc)
        const s0 = (o.x - qx) * -cy + (o.y - qy) * cx    // > 0 : l'obstacle est à gauche du trajet
        // le côté opposé, le plus court. Un obstacle PILE sur le trajet (|s0| ~ 0) se passe toujours à
        // droite : son signe y flotte d'un millimètre d'un instant à l'autre, et le côté avec lui —
        // chaque bascule faisait sauter le personnage de 2 R
        const left = s0 < -SIDE_DEADBAND
        let shift = left ? s0 + R : s0 - R
        if (blocked(qx - cy * shift, qy + cx * shift)) shift = left ? s0 - R : s0 + R
        // une cloche à PLATEAU : plein écart sur le tiers central de la fenêtre (un gros obstacle se
        // longe), puis un cosinus jusqu'à zéro — pente nulle aux deux raccords, le cap ne casse pas
        const u = Math.max(0, (Math.abs(t - tc) / W - PLATEAU) / (1 - PLATEAU))
        const bump = 0.5 * (1 + Math.cos(Math.PI * Math.min(1, u)))
        // en travers du cap AU PASSAGE au plus près, vecteur fixe sur toute la rencontre : la normale
        // du moment tournait avec un parcours qui contourne déjà l'obstacle, et l'écart y rentrait
        dx += -cy * shift * bump
        dy += cx * shift * bump
      }
    }
    out.x = x0 + dx
    out.y = y0 + dy
    // garde-fou : la cloche est une approximation (un parcours qui tourne pendant la rencontre) ; ce
    // qui reste à moins de `GUARD` d'un obstacle est reporté sur son bord — une retouche de quelques
    // centimètres, loin du centre, donc sans saut
    for (const o of clustered(obstacles.list)) {
      const ex = out.x - o.x, ey = out.y - o.y, d = Math.hypot(ex, ey), r = o.r + GUARD
      if (d < r && d > 1e-6) { out.x = o.x + (ex / d) * r; out.y = o.y + (ey / d) * r }
    }
    return out
  }
}

/** Parcourt `curve` à `speed` m/s, en boucle. */
function along(curve: CatmullRomCurve3, speed: number): Path {
  const length = curve.getLength()
  return (t, out) => {
    const u = (((t * speed) / length) % 1 + 1) % 1
    return curve.getPointAt(u, out)
  }
}

/** Le dernier recours : un cercle autour de toutes les emprises (ou du terrain), sans rien vérifier. */
function circle(terrain: readonly XY[], boxes: readonly Rect[], speed: number): Path {
  const t = bbox(terrain)
  const b = boxes.length ? merge([boxes.reduce(union)])[0]! : { x0: t.min[0], y0: t.min[1], x1: t.max[0], y1: t.max[1] }
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2
  const r = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2
  const w = speed / Math.max(r, 1)
  return (t, out) => out.set(cx + Math.cos(w * t) * r, cy + Math.sin(w * t) * r, 0)
}

function waypoints(poly: readonly XY[], n: number, ok: (x: number, y: number) => boolean, rnd: () => number): XY[] {
  const b = bbox(poly)
  const out: XY[] = []
  for (let tries = 0; out.length < n && tries < n * 200; tries++) {
    const x = b.min[0] + rnd() * (b.max[0] - b.min[0]), y = b.min[1] + rnd() * (b.max[1] - b.min[1])
    if (ok(x, y)) out.push([x, y])
  }
  return out
}

/**
 * Insère, entre deux points dont le segment couperait une emprise, les coins à contourner : ceux
 * d'un rectangle un peu plus grand, le plus court des deux sens de rotation. Les morceaux de détour
 * sont revérifiés contre les AUTRES emprises (la piscine à côté de la maison), à profondeur bornée.
 */
function detour(way: readonly XY[], boxes: readonly Rect[], margin: number, garden: CircleGrid, free: (x: number, y: number) => boolean): XY[] {
  const out: XY[] = []
  for (let i = 0; i < way.length; i++) {
    const a = way[i]!, b = way[(i + 1) % way.length]!
    out.push(a, ...between(a, b, boxes, margin, garden, free, 0))
  }
  return out
}

/**
 * Les points à passer entre `a` et `b` (exclus) pour ne couper aucune emprise, ni aucun élément du
 * jardin : une emprise se contourne par ses coins, un élément par un point posé à côté de lui, du
 * côté où passait déjà le segment.
 */
function between(a: XY, b: XY, boxes: readonly Rect[], margin: number, garden: CircleGrid, free: (x: number, y: number) => boolean, depth: number): XY[] {
  if (depth > 4) return []
  const box = boxes.find((r) => crosses(r, a, b))
  if (box && depth > 3) return []                        // au-delà, les coins s'emboîtent en nœuds
  let route: XY[] | null = box ? around(box, a, b, margin) : null
  if (!box) {
    const c = garden.crossing(a, b, STATIC_MARGIN)
    if (!c) return []
    const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1
    const t = Math.max(0, Math.min(1, ((c.x - a[0]) * vx + (c.y - a[1]) * vy) / l2))
    let nx = a[0] + t * vx - c.x, ny = a[1] + t * vy - c.y
    const l = Math.hypot(nx, ny)
    if (l > 1e-6) { nx /= l; ny /= l } else { const lv = Math.sqrt(l2); nx = -vy / lv; ny = vx / lv }
    const off = c.r + 2 * STATIC_MARGIN + 0.5
    const x = c.x + nx * off, y = c.y + ny * off
    // un détour qui sortirait du terrain ou entrerait dans une emprise : on frôlera l'élément
    if (!free(x, y)) return []
    route = [[x, y]]
  }
  if (!route) return []
  const pts = [a, ...route, b]
  const out: XY[] = []
  for (let k = 0; k < pts.length - 1; k++) {
    if (k > 0) out.push(pts[k]!)
    out.push(...between(pts[k]!, pts[k + 1]!, boxes, margin, garden, free, depth + 1))
  }
  return out
}

/** De `a` à `b` autour de `box`, par les coins d'un rectangle agrandi de `margin`. */
function around(box: Rect, a: XY, b: XY, margin: number): XY[] | null {
  const c = grow(box, margin)
  const corners: XY[] = [[c.x0, c.y0], [c.x1, c.y0], [c.x1, c.y1], [c.x0, c.y1]]
  let best: XY[] | null = null, bestLen = Infinity
  for (let s = 0; s < 4; s++) {
    if (crosses(box, a, corners[s]!)) continue
    for (const dir of [1, 3]) {
      // de coin en coin dans un sens, jusqu'au premier d'où l'on voit `b`
      const route: XY[] = [corners[s]!]
      for (let k = s; crosses(box, route[route.length - 1]!, b) && route.length < 4;) {
        k = (k + dir) % 4
        route.push(corners[k]!)
      }
      let len = dist(a, route[0]!) + dist(route[route.length - 1]!, b)
      for (let k = 1; k < route.length; k++) len += dist(route[k - 1]!, route[k]!)
      if (len < bestLen) { best = route; bestLen = len }
    }
  }
  return best
}

// ---- géométrie plane ----------------------------------------------------------------------------

const grow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m })
const inRect = (r: Rect, x: number, y: number) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1
const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1])
const union = (a: Rect, b: Rect): Rect => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })
const overlap = (a: Rect, b: Rect) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1

/** Fond en une seule boîte celles qui se chevauchent, jusqu'à ce qu'aucune ne touche plus une autre. */
function merge(boxes: readonly Rect[]): Rect[] {
  const out = [...boxes]
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (!overlap(out[i]!, out[j]!)) continue
      out[i] = union(out[i]!, out[j]!)
      out.splice(j, 1)
      j = i                                              // la boîte a grandi : tout revérifier
    }
  }
  return out
}

function bbox(poly: readonly XY[]): Box {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1])
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] }
}

/** Le segment `a`-`b` traverse-t-il l'intérieur du rectangle ? (Liang-Barsky.) */
function crosses(r: Rect, a: XY, b: XY): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  let t0 = 0, t1 = 1
  for (const [p, q] of [[-dx, a[0] - r.x0], [dx, r.x1 - a[0]], [-dy, a[1] - r.y0], [dy, r.y1 - a[1]]] as const) {
    if (p === 0) { if (q <= 0) return false; continue }
    const t = q / p
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t }
    else { if (t < t0) return false; if (t < t1) t1 = t }
  }
  return t1 - t0 > 1e-9
}

function inside(poly: readonly XY[], x: number, y: number): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

function edgeDistance(poly: readonly XY[], x: number, y: number): number {
  let d = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j]!, [bx, by] = poly[i]!
    const vx = bx - ax, vy = by - ay
    const k = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)))
    d = Math.min(d, Math.hypot(x - ax - k * vx, y - ay - k * vy))
  }
  return d
}
