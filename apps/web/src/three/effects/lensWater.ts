import { CanvasTexture, LinearFilter, NoColorSpace } from 'three'

// Rain or snow ON THE LENS: as if the view were filmed by a camera standing outside. Droplets land on
// the glass; the bigger drops grow by swallowing those they touch, then give way and run down in
// jerks, wandering left and right, leaving a trail of tiny droplets that dries behind them. Flakes
// stick, then melt into droplets.
//
// The CPU only SIMULATES and draws a "water map" (a small canvas, half the screen's resolution): each
// drop is stamped there as a lens — its NORMAL in red/green, its coverage in alpha, a flake's
// whiteness in blue. The image itself is bent by the last pass of the effect chain (`LENS_WATER_SHADER`
// in `core/post.ts`, `gpu/lensWater.ts` in WebGPU): it reads the finished image shifted by the normal,
// which is what turns the scene upside down inside a drop, as through a real one. No chain in low
// quality, hence no effect there, like the falling rain.
//
// Distances in CSS pixels; rates per screen megapixel, so a phone and a wall screen look as wet.

export type LensWaterKind = 'rain' | 'snow'

interface Drop {
  x: number
  y: number
  /** Radius, px. */
  r: number
  /** Stretch: width and height factors of the drawn sprite (shapes are not all round). */
  sx: number
  sy: number
  /** Seconds left before it dries (static drops and trails); shrinks over its last `FADE_S`. */
  life: number
  /** Running down the glass: speed down and sideways (px/s), the sideways drift it heads to (share of the speed), and the time until it picks another. */
  sliding: boolean
  v: number
  vTarget: number
  vx: number
  retarget: number
  /** Distance run since the last trail droplet. */
  trailRun: number
  /** A trail droplet (never swallowed by the drop that left it) or a flake (white, melts into a droplet). */
  trail: boolean
  flake: boolean
  /**
   * Its shape: lobes drawn under it, offsets and radii as shares of its radius. Water held by glass is
   * never a circle — and two drops that merged keep a bulge on the side the newcomer came from.
   */
  blobs: { dx: number; dy: number; r: number }[]
  /** Seconds since it landed: a drop at rest spreads over the glass, a trail widens as it dries. */
  age: number
  /** How much the glass holds it where it sits (`adhesion`, 0-1): a drop spreads more where it sticks. */
  grip: number
  /** Rotation of the sprite, rad: a flake's turn, a trail piece's slant along the way the drop ran. */
  angle: number
}

/** Map resolution relative to the CSS pixels: half is sharp enough once filtered, and four times lighter to upload. */
const MAP_SCALE = 0.5
const MAX_MAP_W = 1280
/** The last seconds of a drop: it shrinks to nothing instead of vanishing. */
const FADE_S = 2
/** Above this radius, a drop may give way: at once when it grows past it, then with `GIVE_WAY` chances per second. */
const SLIDE_R = 10
const GIVE_WAY = 0.12
/** Below this radius, a running drop stops: too little water left to move. */
const STOP_R = 4
/** A trail droplet every so many px run. */
const TRAIL_STEP = 3
/**
 * The drops sit on the LENS, much nearer than what it looks at: they are out of focus. The map is
 * blurred by this much (CSS px) before it reaches the GPU — soft edges, soft trails — and the shader
 * blurs what is seen through a drop by `LENS_SOFT` (`core/post.ts`).
 */
const LENS_BLUR_PX = 7
/** How much a drop at rest ends up spreading over the glass (radius factor), and how fast (s). */
const SPREAD = 0.3
const SPREAD_S = 5
/**
 * ADHESION: the glass does not hold water the same everywhere (grease, dust, coating wear). A fixed,
 * irregular field over the lens, two octaves of value noise of these cell sizes (px). It shapes
 * everything: a drop at rest spreads toward where it sticks; a running drop is steered toward where
 * it slips and slowed — even stopped — where it sticks, hence winding trails; a trail leaves more
 * water where the glass holds it.
 */
const ADHESION_CELLS = [38, 13] as const
/** How hard a running drop turns toward the slippery side (share of its speed per unit of adhesion difference). */
const STEER = 5
/** Safety cap: the map is redrawn whole at every frame. */
const MAX_DROPS = 1400

export interface LensWaterRandom { (): number }

/** The simulation, without drawing: what the tests drive. */
export class LensWaterSim {
  readonly drops: Drop[] = []
  private spawnSmall = 0
  private spawnBig = 0
  /** The lattice values of the adhesion noise, drawn once: the same glass for the whole shower. */
  private readonly lattice: Float32Array

  constructor(public width: number, public height: number, public kind: LensWaterKind | null, public intensity: number, private readonly random: LensWaterRandom = Math.random) {
    this.lattice = Float32Array.from({ length: 256 }, () => random())
  }

  /** How much the glass holds water at a point, 0 (slippery) to 1 (sticky). */
  adhesion(x: number, y: number): number {
    return 0.65 * this.noise(x / ADHESION_CELLS[0], y / ADHESION_CELLS[0], 0) + 0.35 * this.noise(x / ADHESION_CELLS[1], y / ADHESION_CELLS[1], 101)
  }

  /** Value noise: lattice values, smoothly interpolated. */
  private noise(x: number, y: number, salt: number): number {
    const ix = Math.floor(x), iy = Math.floor(y)
    const fx = x - ix, fy = y - iy
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
    const at = (i: number, j: number) => this.lattice[(((i * 73856093) ^ (j * 19349663) ^ salt) >>> 0) & 255]!
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
  }

  /** `null` = it stopped: nothing new lands, what is there dries. */
  setParams(kind: LensWaterKind | null, intensity: number): void {
    this.kind = kind
    this.intensity = intensity
  }

  /** Nothing left on the glass and nothing falling: the effect can be removed. */
  get done(): boolean { return this.kind === null && this.drops.length === 0 }

  step(dtS: number): void {
    const dt = Math.min(dtS, 0.1)    // a tab coming back to the foreground does not flood the glass
    this.spawn(dt)
    const keep: Drop[] = []
    for (const d of this.drops) {
      d.age += dt
      if (d.sliding) this.run(d, dt)
      else {
        d.life -= dt
        if (!d.trail && !d.flake && d.r > SLIDE_R && d.life > FADE_S && this.random() < GIVE_WAY * dt) this.startRunning(d)
      }
      if (d.flake && d.life <= 0) this.melt(d)
      const gone = d.r < 0.4 || d.y - d.r > this.height || (!d.sliding && d.life <= 0)
      if (!gone) keep.push(d)
    }
    this.drops.length = 0
    this.drops.push(...keep)
  }

  /** Visible radius: spreads while it rests, shrinks over the last `FADE_S` seconds of a static drop. */
  radiusOf(d: Drop): number {
    if (d.sliding) return d.r
    const spread = d.flake ? 1 : 1 + (d.trail ? 1.5 : 1) * SPREAD * (0.4 + 1.2 * d.grip) * (1 - Math.exp(-d.age / SPREAD_S))
    return d.r * spread * Math.min(1, Math.max(0, d.life) / FADE_S)
  }

  private spawn(dt: number): void {
    if (!this.kind) return
    const mpx = (this.width * this.height) / 1e6
    const k = this.intensity * mpx * dt
    if (this.kind === 'snow') {
      // flakes: wet clumps that stick, bigger than the droplets of rain
      this.spawnBig += 6 * k
      while (this.spawnBig >= 1) { this.spawnBig -= 1; this.land(5 + 12 * this.random() ** 2, false, true) }
      return
    }
    // droplets: the fine spray; drops: the ones that grow and run
    this.spawnSmall += 10 * k
    this.spawnBig += 3 * k
    while (this.spawnSmall >= 1) { this.spawnSmall -= 1; this.land(2 + 4 * this.random() ** 2, false, false) }
    while (this.spawnBig >= 1) { this.spawnBig -= 1; this.land(6 + 14 * this.random() ** 2, true, false) }
  }

  /** A drop lands at a random point; on another drop, the two merge. */
  private land(r: number, big: boolean, flake: boolean): void {
    if (this.drops.length >= MAX_DROPS) return
    const x = this.random() * this.width, y = this.random() * this.height
    if (!flake) {
      const hit = this.drops.find((o) => !o.sliding && !o.trail && !o.flake && Math.hypot(o.x - x, o.y - y) < o.r + r * 0.6)
      if (hit) { this.merge(hit, r, x - hit.x, y - hit.y); return }
    }
    const rnd = this.random
    const d: Drop = {
      x, y, r, sx: 1, sy: 1,
      life: flake ? 3 + 5 * rnd() : (big ? 18 : 8) + 14 * rnd(),
      sliding: false, v: 0, vTarget: 0, vx: 0, retarget: 0, trailRun: 0,
      trail: false, flake, blobs: [], age: 0, grip: this.adhesion(x, y), angle: rnd() * Math.PI,
    }
    // a flake is a clump too: two or three crystals stuck together, never a disc
    this.reshape(d, flake ? 1 + Math.floor(rnd() * 2) : big ? 2 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 2))
    this.drops.push(d)
  }

  /**
   * The outline of a drop at rest, from the glass under it: stretched along the way the adhesion rises,
   * and `n` lobes creeping toward where it holds.
   */
  private reshape(d: Drop, n: number): void {
    const e = Math.max(2, d.r)
    const gx = this.adhesion(d.x + e, d.y) - this.adhesion(d.x - e, d.y), gy = this.adhesion(d.x, d.y + e) - this.adhesion(d.x, d.y - e)
    d.sx = (0.85 + 0.25 * this.random()) * (1 + Math.min(0.7, Math.abs(gx) * 4))
    d.sy = (0.85 + 0.25 * this.random()) * (1 + Math.min(0.7, Math.abs(gy) * 4))
    d.blobs = this.shape(d.x, d.y, d.r, n)
  }

  /**
   * `n` lobes around the centre: the water creeps toward where the glass holds it. Each lobe takes the
   * stickiest of a few directions, and is the bigger the more it sticks there — an outline that follows
   * the glass, not a circle.
   */
  private shape(x: number, y: number, r: number, n: number): Drop['blobs'] {
    return Array.from({ length: n }, () => {
      let best = 0, bestGrip = -1
      for (let k = 0; k < 5; k++) {
        const a = this.random() * Math.PI * 2
        const g = this.adhesion(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7)
        if (g > bestGrip) { bestGrip = g; best = a }
      }
      const at = 0.45 + 0.45 * bestGrip
      return { dx: Math.cos(best) * at, dy: Math.sin(best) * at, r: 0.5 + 0.35 * bestGrip }
    })
  }

  /**
   * Two drops become one: the area adds up, the water settles again along the glass (a new outline),
   * and the newcomer leaves a bulge on the side it came from. Heavy enough, it may give way; far too
   * heavy, it always does.
   */
  private merge(d: Drop, r: number, dx: number, dy: number): void {
    d.r = Math.sqrt(d.r * d.r + r * r)
    d.life = Math.max(d.life, 10 + 10 * this.random())
    this.reshape(d, 2 + Math.floor(this.random() * 3))
    if (r > 2) d.blobs.push({ dx: (dx * 0.7) / d.r, dy: (dy * 0.7) / d.r, r: Math.min(0.8, Math.max(0.45, (r * 0.9) / d.r)) })
    if (d.r > 2 * SLIDE_R || (d.r > SLIDE_R && this.random() < 0.5)) this.startRunning(d)
  }

  private startRunning(d: Drop): void {
    d.sliding = true
    d.blobs = []
    d.v = 0
    d.vx = 0
    d.vTarget = 0
    d.retarget = 0.4
  }

  /** A drop is running: the animation then needs a higher rate to look like a fall, not a slideshow. */
  get running(): boolean { return this.drops.some((d) => d.sliding) }

  /**
   * A running drop, under gravity and held by the glass. It accelerates — faster the heavier it is —
   * toward a terminal speed that the glass's grip under it lowers: where it sticks, it slows down, and
   * may be caught for a moment until it gathers enough water. It feels the glass just ahead of it and
   * turns toward the slippery side: its path winds along the adhesion field. What is in its way joins
   * it (it grows, hence runs faster); it sheds a trail along the WHOLE way it ran this frame.
   */
  private run(d: Drop, dt: number): void {
    const ahead = d.y + d.r, side = d.r * 0.6
    const left = this.adhesion(d.x - side, ahead), right = this.adhesion(d.x + side, ahead)
    const grip = this.adhesion(d.x, ahead)
    d.retarget -= dt
    if (d.retarget <= 0) {
      if (d.v > 60 && this.random() < 0.35 * grip) d.v *= 0.15     // caught by a sticky spot
      d.vTarget = (this.random() - 0.5) * 0.15                       // a little of its own wandering
      d.retarget = 0.2 + 0.4 * this.random()
    }
    const terminal = (160 + d.r * 18) * (1.2 - 0.9 * grip)
    d.v = d.v < terminal ? Math.min(terminal, d.v + (90 + d.r * 22) * (1.1 - grip) * dt) : d.v + (terminal - d.v) * Math.min(1, dt * 4)
    // toward the slippery side: the left sticks more, it goes right
    const steer = Math.max(-1, Math.min(1, (left - right) * STEER + d.vTarget))
    d.vx += (steer * d.v - d.vx) * Math.min(1, dt * 5)
    const x0 = d.x, y0 = d.y
    const dx = d.vx * dt, dy = d.v * dt
    d.x += dx
    d.y += dy
    // stretched by its own weight, the more the faster
    d.sx = 0.92
    d.sy = 1.1 + 0.25 * Math.min(1, d.v / terminal)
    for (const o of this.drops) {
      if (o === d || o.trail || o.sliding || o.r <= 0 || Math.abs(o.y - d.y) > d.r + o.r) continue
      if (Math.hypot(o.x - d.x, o.y - d.y) < d.r + o.r * 0.8) {
        d.r = Math.sqrt(d.r * d.r + o.r * o.r * 0.8)
        o.r = 0
      }
    }
    const len = Math.hypot(dx, dy)
    for (let at = TRAIL_STEP - d.trailRun; at <= len; at += TRAIL_STEP) {
      const t = len > 0 ? at / len : 1
      // the trail: a thin film of water that the drop leaves and that dries behind it
      // more water stays where the glass holds it: the trail swells and thins along the way
      const tr = Math.max(1.2, d.r * (0.38 + 0.12 * this.random()) * (0.55 + 0.9 * this.adhesion(x0 + dx * t, y0 + dy * t)))
      d.r = Math.sqrt(Math.max(0, d.r * d.r - tr * tr * 0.06))
      if (this.drops.length < MAX_DROPS) {
        this.drops.push({
          x: x0 + dx * t, y: y0 + dy * t - d.r * 0.8, r: tr, sx: 1, sy: 1,
          life: 1.5 + 4 * this.random(), sliding: false, v: 0, vTarget: 0, vx: 0, retarget: 0, trailRun: 0,
          trail: true, flake: false, blobs: [], age: 0, grip: this.adhesion(x0 + dx * t, y0 + dy * t), angle: -Math.atan2(dx, dy),
        })
      }
    }
    d.trailRun = (d.trailRun + len) % TRAIL_STEP
    if (d.r < STOP_R) { d.sliding = false; d.sx = d.sy = 1; d.life = 4 + 6 * this.random() }
  }

  /** A flake that has had its time turns to water: a smaller droplet, which dries in turn. */
  private melt(d: Drop): void {
    d.flake = false
    d.r *= 0.85
    d.age = 0
    d.life = 6 + 8 * this.random()
    // the melt water settles along the glass like any drop: an irregular puddle, which may run if heavy
    this.reshape(d, 2 + Math.floor(this.random() * 2))
  }
}

/** The water map: the simulation, drawn into a canvas the effect chain reads as a texture. */
export class LensWater {
  readonly sim: LensWaterSim
  /** `null` without a 2D context (tests): the simulation runs, nothing is drawn. */
  readonly texture: CanvasTexture | null
  /** Where the drops are drawn sharp, and the canvas the texture reads: the same, blurred. */
  private readonly sharp: HTMLCanvasElement | null
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly canvas: HTMLCanvasElement | null
  private readonly out: CanvasRenderingContext2D | null
  private readonly dropSprite: HTMLCanvasElement | null
  private readonly flakeSprite: HTMLCanvasElement | null
  private readonly streakSprite: HTMLCanvasElement | null
  private scale = MAP_SCALE

  constructor(width: number, height: number, kind: LensWaterKind, intensity: number, random?: LensWaterRandom) {
    this.sim = new LensWaterSim(width, height, kind, intensity, random)
    const sharp = typeof document !== 'undefined' ? document.createElement('canvas') : null
    const ctx = sharp?.getContext('2d') ?? null
    const canvas = ctx ? document.createElement('canvas') : null
    this.out = canvas?.getContext('2d') ?? null
    this.sharp = ctx && this.out ? sharp : null
    this.ctx = this.out ? ctx : null
    this.canvas = this.out ? canvas : null
    this.dropSprite = ctx ? sprite(dropTexel) : null
    this.flakeSprite = ctx ? sprite(flakeTexel) : null
    this.streakSprite = ctx ? sprite(streakTexel) : null
    this.texture = this.canvas ? new CanvasTexture(this.canvas) : null
    if (this.texture) {
      this.texture.colorSpace = NoColorSpace      // data, not a colour
      this.texture.minFilter = this.texture.magFilter = LinearFilter
      this.texture.generateMipmaps = false
    }
    this.resize(width, height)
  }

  get kind(): LensWaterKind | null { return this.sim.kind }
  get done(): boolean { return this.sim.done }

  setParams(kind: LensWaterKind | null, intensity: number): void { this.sim.setParams(kind, intensity) }

  resize(width: number, height: number): void {
    // the drops stay where they are on the glass; those now outside dry off-screen
    this.sim.width = Math.max(1, width)
    this.sim.height = Math.max(1, height)
    if (!this.canvas) return
    this.scale = Math.min(MAP_SCALE, MAX_MAP_W / this.sim.width)
    this.canvas.width = this.sharp!.width = Math.max(1, Math.round(this.sim.width * this.scale))
    this.canvas.height = this.sharp!.height = Math.max(1, Math.round(this.sim.height * this.scale))
    // a canvas resized is a new image: the texture must be reallocated
    this.texture?.dispose()
  }

  step(dtS: number): void {
    this.sim.step(dtS)
    this.draw()
  }

  private draw(): void {
    const ctx = this.ctx
    const out = this.out
    if (!ctx || !out || !this.sharp || !this.canvas || !this.dropSprite || !this.flakeSprite || !this.streakSprite) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.sharp.width, this.sharp.height)
    const s = this.scale
    // trails first, then the drops at rest, the running ones on top: they cross everything
    for (const pass of [0, 1, 2] as const) {
      for (const d of this.sim.drops) {
        const order = d.trail ? 0 : d.sliding ? 2 : 1
        if (order !== pass) continue
        const r = this.sim.radiusOf(d) * s
        if (r <= 0.05) continue
        if (d.trail) {
          // a piece of tube, long enough to overlap its neighbours: together they make one rivulet
          // slanted along the run: no staircase where the drop went sideways (the normal turns a little
          // with it, which the blur hides)
          const h = Math.max(r, TRAIL_STEP * s * 1.6)
          ctx.setTransform(Math.cos(d.angle), Math.sin(d.angle), -Math.sin(d.angle), Math.cos(d.angle), d.x * s, d.y * s)
          ctx.drawImage(this.streakSprite, -r, -h, 2 * r, 2 * h)
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          continue
        }
        if (d.flake) {
          for (const b of d.blobs) {
            const br = b.r * r
            ctx.drawImage(this.flakeSprite, d.x * s + b.dx * r - br, d.y * s + b.dy * r - br, 2 * br, 2 * br)
          }
          ctx.setTransform(Math.cos(d.angle), Math.sin(d.angle), -Math.sin(d.angle), Math.cos(d.angle), d.x * s, d.y * s)
          ctx.drawImage(this.flakeSprite, -r, -r, 2 * r, 2 * r)
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          continue
        }
        for (const b of d.blobs) {
          const br = b.r * r
          ctx.drawImage(this.dropSprite, d.x * s + b.dx * r - br, d.y * s + b.dy * r - br, 2 * br, 2 * br)
        }
        // with lobes, the body is a little smaller: the outline is theirs as much as its own
        const body = d.blobs.length > 0 ? 0.85 : 1
        const w = r * d.sx * body, h = r * d.sy * body
        // a running drop is heavier at the bottom: its sprite is shifted down
        ctx.drawImage(this.dropSprite, d.x * s - w, d.y * s - h * (d.sliding ? 0.8 : 1), 2 * w, 2 * h)
      }
    }
    // out of focus: the whole map blurred at once (a browser without canvas filters keeps it sharp)
    out.clearRect(0, 0, this.canvas.width, this.canvas.height)
    out.filter = `blur(${(LENS_BLUR_PX * s).toFixed(1)}px)`
    out.drawImage(this.sharp, 0, 0)
    out.filter = 'none'
    if (this.texture) this.texture.needsUpdate = true
  }

  dispose(): void {
    this.texture?.dispose()
  }
}

const SPRITE = 64

/** A sprite from a function of the point in [-1, 1]² → RGBA bytes. */
function sprite(texel: (u: number, v: number) => [number, number, number, number]): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = SPRITE
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(SPRITE, SPRITE)
  for (let j = 0; j < SPRITE; j++) {
    for (let i = 0; i < SPRITE; i++) {
      const [r, g, b, a] = texel(((i + 0.5) / SPRITE) * 2 - 1, ((j + 0.5) / SPRITE) * 2 - 1)
      const k = (j * SPRITE + i) * 4
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = a
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

/**
 * A drop seen as a lens: its normal, flat in the middle and steep at the rim (a cap of a sphere), in
 * red (x, right) and green (y, UP — the canvas counts down, hence the sign). The edge is antialiased
 * over two texels of the sprite.
 */
export function dropTexel(u: number, v: number): [number, number, number, number] {
  const d = Math.hypot(u, v)
  if (d >= 1) return [128, 128, 0, 0]
  const k = 0.55 + 0.45 * d * d
  const a = Math.min(1, (1 - d) * (SPRITE / 4))
  return [Math.round(128 + 127 * u * k), Math.round(128 - 127 * v * k), 0, Math.round(255 * a)]
}

/**
 * A piece of rivulet: a tube lying down the glass, its normal across only (red), none along (green
 * flat). Its ends fade, so that the pieces stamped one under another join without a seam.
 */
export function streakTexel(u: number, v: number): [number, number, number, number] {
  const d = Math.abs(u)
  if (d >= 1) return [128, 128, 0, 0]
  const a = Math.min(1, (1 - d) * (SPRITE / 4)) * Math.min(1, (1 - Math.abs(v)) / 0.4)
  return [Math.round(128 + 127 * u * (0.55 + 0.45 * d * d)), 128, 0, Math.round(255 * a)]
}

/** A flake: white (blue channel), no refraction, a soft edge in six lobes. */
export function flakeTexel(u: number, v: number): [number, number, number, number] {
  const d = Math.hypot(u, v)
  const edge = 0.7 + 0.3 * Math.abs(Math.cos(3 * Math.atan2(v, u)))
  const a = Math.max(0, Math.min(1, (edge - d) / 0.35))
  return [128, 128, 255, Math.round(255 * a * 0.9)]
}
