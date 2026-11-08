import { Delaunay } from 'd3-delaunay'
import { eventsOfKind, eventsOfPool } from '../content/gladeEvents'
import { BIOMES, LAYOUTS } from '../content/layouts'
import type {
  Barrier,
  BiomeDef,
  DepositId,
  Glade,
  GladeKind,
  LayoutDef,
  LayoutSeeding,
  MapgenHooks,
  Obstacle,
  ResourceBag,
  TerrainId,
  Vec2,
  WorldDeposit,
  WorldInfo,
} from '../types'
import { dist, randomPointInPolygon } from './geometry'
import { DEPOSIT_RADIUS, RENEWABLE_DEPOSITS, WORLD_HEIGHT, WORLD_WIDTH, gladeAt } from './mapgen'
import type { Rng } from './rng'
import { DEFAULT_PLAN, type TerrainPlan } from './terrainPlan'

/**
 * Generates a new world (see `mapgen.ts`). Only creating a run needs this, so
 * it and the Delaunay library load on demand, not with the game.
 */

/** Keep everything a little inside the world's edge. */
const EDGE_MARGIN = 1.2

export interface GeneratedMap {
  world: WorldInfo
  glades: Record<string, Glade>
  deposits: Record<string, WorldDeposit>
  obstacles: Obstacle[]
}

/** Deposit themes, so each glade feels like it is *about* something. */
/**
 * Deposit themes, so each glade feels like it is *about* something. Every
 * theme carries at least one renewable food source in its first four entries
 * — with four deposits guaranteed per glade, even a quarry can graze a
 * forager, which keeps far-flung expansions from being pure starvation traps.
 */
const GLADE_THEMES: { deposits: DepositId[]; terrain: TerrainId }[] = [
  { deposits: ['trees', 'trees', 'vegetation'], terrain: 'forest' },
  { deposits: ['trees', 'vegetation', 'game'], terrain: 'forest' },
  { deposits: ['stoneVein', 'stoneVein', 'clayPatch', 'vegetation'], terrain: 'rock' },
  { deposits: ['clayPatch', 'vegetation', 'trees'], terrain: 'marsh' },
  { deposits: ['fertileSoil', 'fertileSoil', 'vegetation'], terrain: 'fertile' },
  { deposits: ['game', 'game', 'vegetation'], terrain: 'forest' },
  { deposits: ['orePatch', 'stoneVein', 'trees', 'vegetation'], terrain: 'rock' },
  { deposits: ['vegetation', 'vegetation', 'fertileSoil'], terrain: 'fertile' },
]

const GLADE_NAMES = [
  'Mossbrook', 'Ashfall', 'Wetstone', 'Hollow Reach', 'Thornmere', 'Gravewood',
  'Sunken Rill', 'Bitterloam', 'Fernhaven', 'Crooked Pines', 'Slatefen',
  'Weeping Birches', 'Dunmire', 'Oldroot', 'Cinderglade', 'Stillwater',
  'Rimefall', 'Harrowdeep', 'Broken Cairn', 'Nettlewick',
]

/** A glade centre before the Voronoi partition. */
interface SeedPoint {
  id: string
  center: Vec2
  kind: GladeKind
  /** Which half of a split layout it falls in (0: the hearth's). */
  side?: 0 | 1
  /** On a spine layout's ridge. */
  spine?: boolean
}

/**
 * Generates the world. `hooks` come from the run's modifiers; `plan` is the
 * layout and biome (`engine/terrainPlan.ts`). With no hooks and the default
 * plan, the RNG is consumed exactly as before, so a seed keeps its map.
 */
export function generateMap(rng: Rng, hooks: MapgenHooks = {}, plan: TerrainPlan = DEFAULT_PLAN): GeneratedMap {
  const world: WorldInfo = { width: WORLD_WIDTH, height: WORLD_HEIGHT, layout: plan.layout, biome: plan.biome }
  const layout = LAYOUTS[plan.layout] ?? LAYOUTS.rings
  const biome = BIOMES[plan.biome] ?? BIOMES.woodland
  // Odds that a ring glade rolls small (safe); modifiers can thin them out.
  const smallOdds = hooks.smallGladeOdds ?? 1

  // --- 1. Seed the glade centres --------------------------------------------
  const seeds = seedGlades(rng, world, smallOdds, layout.seeding)

  // --- 2. Voronoi partition ---------------------------------------------------
  const delaunay = Delaunay.from(
    seeds.map((s) => s.center),
    (p) => p.x,
    (p) => p.y,
  )
  const voronoi = delaunay.voronoi([
    -world.width / 2,
    -world.height / 2,
    world.width / 2,
    world.height / 2,
  ])
  const polygons: Vec2[][] = seeds.map((_, index) => {
    const raw = voronoi.cellPolygon(index) ?? []
    // d3 closes the ring (last point repeats the first) — drop the duplicate.
    return raw.slice(0, -1).map(([x, y]) => ({ x, y }))
  })
  const neighbors: string[][] = seeds.map((_, index) => [...voronoi.neighbors(index)].map((n) => seeds[n].id))

  // A split layout halves the map, and its barrier keeps the halves apart
  // but at its crossings.
  const split = layout.split ? splitGlades(rng, layout, seeds, polygons, neighbors) : null
  if (split) world.barriers = [split.barrier]

  // A biome claims a region of whatever layout was drawn.
  const biomeIds = biome.terrain ? biomeRegion(rng, layout, biome, seeds) : new Set<string>()

  const themeByGlade: Record<string, { deposits: DepositId[]; terrain: TerrainId }> = {}
  const spineHooks: MapgenHooks =
    layout.seeding.kind === 'spine'
      ? { ...hooks, themeWeights: { ...(hooks.themeWeights ?? {}), [layout.seeding.terrain]: (hooks.themeWeights?.[layout.seeding.terrain] ?? 1) * layout.seeding.terrainWeight } }
      : hooks
  const bankHooks: MapgenHooks = layout.bankWeights
    ? { ...hooks, themeWeights: { ...(hooks.themeWeights ?? {}), ...layout.bankWeights } }
    : hooks
  for (const seed of seeds) {
    if (seed.kind === 'settlement') {
      // The opening glade is deliberately well-rounded: wood and food to
      // survive on, plus a little stone and clay so the first tier of
      // buildings is reachable before you have cleared anything.
      themeByGlade[seed.id] = {
        deposits: ['trees', 'vegetation', 'trees', 'vegetation', 'stoneVein', 'clayPatch'],
        terrain: 'clearing',
      }
    } else if (biomeIds.has(seed.id) && biome.themes && biome.terrain) {
      themeByGlade[seed.id] = { deposits: rng.pick(biome.themes).deposits, terrain: biome.terrain }
    } else {
      themeByGlade[seed.id] = pickTheme(
        rng,
        seed.spine ? spineHooks : split?.banks.has(seed.id) ? bankHooks : hooks,
      )
    }
  }

  // --- 3. Glade records --------------------------------------------------------
  const glades: Record<string, Glade> = {}
  const dangerousEvents = rng.shuffle(eventsOfKind('dangerous').map((e) => e.id))
  const forbiddenEvents = rng.shuffle(eventsOfKind('forbidden').map((e) => e.id))
  let dangerousCursor = 0
  let forbiddenCursor = 0
  const names = rng.shuffle(GLADE_NAMES)
  // A biome's or a layout's own events come first for its glades, each once.
  const pools = new Map<string, Record<'dangerous' | 'forbidden', string[]>>()
  const poolFor = (seed: SeedPoint): string | undefined =>
    (biomeIds.has(seed.id) ? biome.eventPool : undefined) ?? layout.eventPool
  const pooledEvent = (pool: string, kind: 'dangerous' | 'forbidden'): string | undefined => {
    let lists = pools.get(pool)
    if (!lists) {
      lists = {
        dangerous: rng.shuffle(eventsOfPool(pool, 'dangerous').map((e) => e.id)),
        forbidden: rng.shuffle(eventsOfPool(pool, 'forbidden').map((e) => e.id)),
      }
      pools.set(pool, lists)
    }
    return lists[kind].shift()
  }

  seeds.forEach((seed, index) => {
    const polygon = polygons[index]
    const distance = dist(seed.center, { x: 0, y: 0 })
    const isSettlement = seed.kind === 'settlement'
    const pool = poolFor(seed)
    let eventId: string | undefined
    if (seed.kind === 'dangerous') {
      eventId =
        (pool && pooledEvent(pool, 'dangerous')) ||
        dangerousEvents[dangerousCursor++ % dangerousEvents.length]
    } else if (seed.kind === 'forbidden') {
      eventId =
        (pool && pooledEvent(pool, 'forbidden')) ||
        forbiddenEvents[forbiddenCursor++ % forbiddenEvents.length]
    }
    const clearScale = biomeIds.has(seed.id) ? (biome.clearWorkScale ?? 1) : 1

    glades[seed.id] = {
      id: seed.id,
      kind: seed.kind,
      name: isSettlement ? 'The Hearth' : (names[index % names.length] ?? `Glade ${index}`),
      polygon,
      center: seed.center,
      terrain: themeByGlade[seed.id].terrain,
      neighbors: split ? split.neighbors[index] : neighbors[index],
      discovered: isSettlement,
      cleared: isSettlement,
      clearWork: isSettlement ? 0 : Math.round(clearWorkFor(seed.kind, distance) * clearScale),
      clearProgress: 0,
      clearers: 0,
      reward: isSettlement ? {} : scaleReward(rewardFor(seed.kind, rng), hooks.rewardScale?.[seed.kind]),
      eventId,
    }
  })

  // Neighbours of the starting glade are visible from the outset.
  for (const id of glades.glade0.neighbors) glades[id].discovered = true

  // --- 4. Scatter deposits and obstacles inside each glade ---------------------
  const deposits: Record<string, WorldDeposit> = {}
  const obstacles: Obstacle[] = []
  let depositCounter = 0
  let obstacleCounter = 0

  // The barrier first: water or cliff edge along its course, open at the
  // crossings. Everything scattered later keeps clear of it.
  const barrierTaken: { pos: Vec2; radius: number }[] = []
  for (const barrier of world.barriers ?? []) {
    const style = BARRIER_STYLE[barrier.kind]
    for (const [a, b] of barrier.segments) {
      const length = dist(a, b)
      const steps = Math.max(1, Math.round(length / style.spacing))
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const pos = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        obstacles.push({
          id: `o${obstacleCounter++}`,
          kind: style.obstacle,
          pos,
          radius: style.radius,
          gladeId: gladeAt(glades, pos)?.id ?? 'glade0',
        })
        barrierTaken.push({ pos, radius: style.radius })
      }
    }
  }

  for (const seed of seeds) {
    const glade = glades[seed.id]
    const theme = themeByGlade[seed.id]
    const isSettlement = seed.kind === 'settlement'
    const taken: { pos: Vec2; radius: number }[] = [...barrierTaken]
    // The glade centre stays open: the hearth stands there in the settlement
    // (with room to build a ring around it), and the clearing crew's plate
    // hovers there everywhere else.
    taken.push({ pos: seed.center, radius: isSettlement ? 1.6 : 1.0 })

    // A guaranteed fourth deposit keeps the food economy honest — three-deposit
    // glades starved too many otherwise-competent runs in continuous space.
    const count = isSettlement ? theme.deposits.length : rng.range(4, 6)
    const kinds: DepositId[] = []
    for (let i = 0; i < count; i++) kinds.push(theme.deposits[i % theme.deposits.length])
    // A layout's own deposit (the ruins' salvage), on top of the theme's.
    const extra = layout.extraDeposit
    if (!isSettlement && extra && rng.chance(extra.chance)) kinds.push(extra.kind)
    for (const kind of kinds) {
      const radius = DEPOSIT_RADIUS[kind]
      const pos = scatter(rng, glade.polygon, radius * 0.5 + 0.25, taken, radius)
      if (!pos) continue
      taken.push({ pos, radius })
      const id = `d${depositCounter++}`
      deposits[id] = {
        id,
        kind,
        pos,
        radius,
        amount: infiniteDeposit(kind) ? null : rng.range(14, 30),
        gladeId: seed.id,
      }
    }

    // Rocky and marshy ground gets unbuildable patches for placement to dodge.
    const obstacleCount =
      theme.terrain === 'rock' ? rng.range(2, 3) : theme.terrain === 'marsh' ? rng.range(1, 2) : rng.chance(0.3) ? 1 : 0
    for (let i = 0; i < obstacleCount; i++) {
      const radius = 0.5 + rng.next() * 0.5
      const pos = scatter(rng, glade.polygon, radius + 0.2, taken, radius)
      if (!pos) continue
      taken.push({ pos, radius })
      obstacles.push({
        id: `o${obstacleCounter++}`,
        kind: theme.terrain === 'marsh' ? 'mire' : 'crag',
        pos,
        radius,
        gladeId: seed.id,
      })
    }
  }

  if (hooks.depositScale) {
    applyDepositScale(rng, hooks.depositScale, glades, deposits, obstacles, depositCounter)
  }

  return { world, glades, deposits, obstacles }
}

// ---------------------------------------------------------------------------
// Layouts: seeding, splitting, crossings, biome regions
// ---------------------------------------------------------------------------

/** How a barrier's course is dotted with unbuildable ground. */
const BARRIER_STYLE: Record<Barrier['kind'], { obstacle: Obstacle['kind']; radius: number; spacing: number }> = {
  river: { obstacle: 'water', radius: 0.55, spacing: 0.6 },
  cliff: { obstacle: 'cliff', radius: 0.25, spacing: 0.4 },
}

/** Width of the open stretch at a crossing's middle (a ford, a pass). */
const CROSSING_GAP = 2.2

/** The layout's glade centres, by the seeding its data names. */
function seedGlades(rng: Rng, world: WorldInfo, smallOdds: number, seeding: LayoutSeeding): SeedPoint[] {
  if (seeding.kind === 'spine') return seedSpine(rng, world, smallOdds, seeding)
  if (seeding.kind === 'scatter') return seedScatter(rng, world, smallOdds, seeding)
  return seedRings(rng, world, smallOdds)
}

/**
 * Two rings around the settlement so the player always has a couple of easy
 * neighbours, jittered so no two maps share a skeleton. (Today's map: its RNG
 * use must never change, or every seed's map would.)
 */
function seedRings(rng: Rng, world: WorldInfo, smallOdds: number): SeedPoint[] {
  const seeds: SeedPoint[] = [{ id: 'glade0', center: { x: 0, y: 0 }, kind: 'settlement' }]

  const placeRing = (count: number, minDist: number, maxDist: number, minGap: number) => {
    const placed: Vec2[] = []
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 24; attempt++) {
        const angle = ((i + rng.next() * 0.8) / count) * Math.PI * 2
        const d = minDist + rng.next() * (maxDist - minDist)
        const p = clampToWorld(world, { x: Math.cos(angle) * d, y: Math.sin(angle) * d })
        const clashes = [...placed, ...seeds.map((s) => s.center)].some(
          (q) => dist(p, q) < minGap,
        )
        if (!clashes) {
          placed.push(p)
          break
        }
      }
    }
    return placed
  }

  const inner = placeRing(6, 6, 8, 2.6)
  const outer = placeRing(8, 9.5, 12.5, 2.6)

  inner.forEach((center, i) => {
    // Inner ring skews safe so the opening is survivable.
    seeds.push({ id: `glade${i + 1}`, center, kind: innerKind(rng, smallOdds) })
  })
  outer.forEach((center, i) => {
    seeds.push({ id: `glade${inner.length + i + 1}`, center, kind: outerKind(rng, smallOdds) })
  })
  return seeds
}

/** A glade close to the hearth: skews safe, so the opening is survivable. */
function innerKind(rng: Rng, smallOdds: number): GladeKind {
  return rng.chance(0.45 * smallOdds) ? 'small' : 'dangerous'
}

/** Further out, fewer small glades and a forbidden share. */
function outerKind(rng: Rng, smallOdds: number): GladeKind {
  const roll = rng.next()
  const small = 0.2 * smallOdds
  return roll < small ? 'small' : roll < 0.7 ? 'dangerous' : 'forbidden'
}

/** A point inside the world, `EDGE_MARGIN` clear of its edge. */
function clampToWorld(world: WorldInfo, p: Vec2): Vec2 {
  return {
    x: clamp(p.x, -(world.width / 2 - EDGE_MARGIN), world.width / 2 - EDGE_MARGIN),
    y: clamp(p.y, -(world.height / 2 - EDGE_MARGIN), world.height / 2 - EDGE_MARGIN),
  }
}

/**
 * The ridge: a spine of glades running east or west from the hearth, and the
 * lowland around it everywhere but a corridor either side of the spine.
 */
function seedSpine(
  rng: Rng,
  world: WorldInfo,
  smallOdds: number,
  params: Extract<LayoutSeeding, { kind: 'spine' }>,
): SeedPoint[] {
  const seeds: SeedPoint[] = [{ id: 'glade0', center: { x: 0, y: 0 }, kind: 'settlement', side: 0 }]
  const theta = (rng.chance(0.5) ? 0 : Math.PI) + (rng.next() - 0.5) * 0.5
  const u = { x: Math.cos(theta), y: Math.sin(theta) }
  const v = { x: -u.y, y: u.x }
  params.steps.forEach((t, i) => {
    const lateral = (rng.next() - 0.5) * 1.2
    const center = clampToWorld(world, { x: u.x * t + v.x * lateral, y: u.y * t + v.y * lateral })
    // The first step is an easy one; the end of the spine is a real test.
    const last = i === params.steps.length - 1
    const kind: GladeKind =
      i === 0 ? 'small' : last ? 'dangerous' : innerKind(rng, smallOdds)
    seeds.push({ id: `glade${seeds.length}`, center, kind, side: 0, spine: true })
  })
  const inCorridor = (p: Vec2) =>
    p.x * u.x + p.y * u.y > 1.5 && Math.abs(p.x * v.x + p.y * v.y) < params.corridor
  const scatterBand = (count: number, minDist: number, maxDist: number, close: boolean) => {
    for (let placed = 0, attempt = 0; placed < count && attempt < count * 40; attempt++) {
      const angle = rng.next() * Math.PI * 2
      const d = minDist + rng.next() * (maxDist - minDist)
      const p = clampToWorld(world, { x: Math.cos(angle) * d, y: Math.sin(angle) * d })
      if (inCorridor(p) || seeds.some((s) => dist(s.center, p) < 2.7)) continue
      const kind = close ? innerKind(rng, smallOdds) : outerKind(rng, smallOdds)
      seeds.push({ id: `glade${seeds.length}`, center: p, kind, side: 1 })
      placed++
    }
  }
  scatterBand(params.lowland[0], 5.5, 8.5, true)
  scatterBand(params.lowland[1], 9.5, 13, false)
  return seeds
}

/**
 * The ruins field: glades scattered anywhere, a fixed gap apart, the close
 * ones skewing safe like the inner ring.
 */
function seedScatter(
  rng: Rng,
  world: WorldInfo,
  smallOdds: number,
  params: Extract<LayoutSeeding, { kind: 'scatter' }>,
): SeedPoint[] {
  const seeds: SeedPoint[] = [{ id: 'glade0', center: { x: 0, y: 0 }, kind: 'settlement' }]
  const hw = world.width / 2 - EDGE_MARGIN
  const hh = world.height / 2 - EDGE_MARGIN
  for (let attempt = 0; seeds.length <= params.count && attempt < params.count * 60; attempt++) {
    const p = { x: (rng.next() * 2 - 1) * hw, y: (rng.next() * 2 - 1) * hh }
    const d = dist(p, ORIGIN)
    if (d < params.hearthGap || seeds.some((s) => dist(s.center, p) < params.minGap)) continue
    const kind = d < 8.5 ? innerKind(rng, smallOdds) : outerKind(rng, smallOdds)
    seeds.push({ id: `glade${seeds.length}`, center: p, kind })
  }
  return seeds
}

interface Split {
  barrier: Barrier
  /** Each glade's neighbours once the barrier has cut the ones across it. */
  neighbors: string[][]
  /** Glades on either side of the barrier (where a river leaves its silt). */
  banks: Set<string>
}

/**
 * Halves the glades — a line across the map for a river (its far bank being
 * the `far` glades furthest along a random heading), the spine and the
 * lowland for a ridge — and runs the barrier along every border between the
 * halves. Its crossings are spread as far apart as they will go, starting
 * nearest the hearth; any glade the cut leaves unreachable gets one more,
 * so every glade can still be reached from the hearth.
 */
function splitGlades(
  rng: Rng,
  layout: LayoutDef,
  seeds: SeedPoint[],
  polygons: Vec2[][],
  neighbors: string[][],
): Split {
  const index = new Map(seeds.map((s, i) => [s.id, i]))
  if (layout.split?.kind === 'line') {
    const theta = rng.next() * Math.PI * 2
    const u = { x: Math.cos(theta), y: Math.sin(theta) }
    const along = (s: SeedPoint) => s.center.x * u.x + s.center.y * u.y
    const far = new Set(
      seeds
        .filter((s) => s.kind !== 'settlement')
        .sort((a, b) => along(b) - along(a))
        .slice(0, layout.split.far)
        .map((s) => s.id),
    )
    for (const s of seeds) s.side = far.has(s.id) ? 1 : 0
  }
  const side = (id: string) => seeds[index.get(id)!].side ?? 0

  // Every border between the halves, with its shared edge.
  const across: { a: string; b: string; edge: [Vec2, Vec2] }[] = []
  seeds.forEach((s, i) => {
    for (const n of neighbors[i]) {
      const j = index.get(n)!
      if (j <= i || side(s.id) === side(n)) continue
      const edge = sharedEdge(polygons[i], polygons[j])
      if (edge) across.push({ a: s.id, b: n, edge })
    }
  })

  const crossings = new Set<number>()
  const wanted = layout.crossings ?? { count: 1, fromHearth: true }
  const candidates = across
    .map((c, i) => ({ i, m: midpoint(c.edge), long: dist(c.edge[0], c.edge[1]) }))
    .filter((c) => c.long >= 0.9)
    .filter((c) => wanted.fromHearth || (across[c.i].a !== 'glade0' && across[c.i].b !== 'glade0'))
  if (candidates.length > 0) {
    const first = [...candidates].sort((x, y) => dist(x.m, ORIGIN) - dist(y.m, ORIGIN))[0]
    crossings.add(first.i)
    while (crossings.size < wanted.count) {
      const chosen = [...crossings].map((i) => midpoint(across[i].edge))
      const next = candidates
        .filter((c) => !crossings.has(c.i))
        .sort((x, y) => minDist(y.m, chosen) - minDist(x.m, chosen))[0]
      if (!next) break
      crossings.add(next.i)
    }
  }

  // Cut the borders across the barrier but at its crossings; then make sure
  // the hearth can still reach every glade.
  const pairIndex = new Map<string, number>()
  across.forEach((c, i) => {
    pairIndex.set(`${c.a}|${c.b}`, i)
    pairIndex.set(`${c.b}|${c.a}`, i)
  })
  const cut = (): string[][] =>
    seeds.map((s, i) =>
      neighbors[i].filter((n) => {
        const k = pairIndex.get(`${s.id}|${n}`)
        return k === undefined || crossings.has(k)
      }),
    )
  let pruned = cut()
  for (let guard = 0; guard <= seeds.length; guard++) {
    const reached = reachable(pruned, index)
    if (reached.size === seeds.length) break
    const open = across
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => !crossings.has(i) && reached.has(c.a) !== reached.has(c.b))
      .sort((x, y) => dist(midpoint(x.c.edge), ORIGIN) - dist(midpoint(y.c.edge), ORIGIN))[0]
    if (!open) break
    crossings.add(open.i)
    pruned = cut()
  }

  // The barrier runs along every border between the halves, but a crossing
  // leaves a stretch around its middle open — whichever borders meet there.
  const openings = [...crossings].map((i) => midpoint(across[i].edge))
  const segments: [Vec2, Vec2][] = []
  for (const { edge } of across) {
    let pieces: [Vec2, Vec2][] = [edge]
    for (const m of openings) pieces = pieces.flatMap((p) => clipSegment(p, m, CROSSING_GAP / 2 + 0.3))
    segments.push(...pieces)
  }
  return {
    barrier: { kind: layout.barrier ?? 'river', segments, crossings: openings },
    neighbors: pruned,
    banks: new Set(across.flatMap((c) => [c.a, c.b])),
  }
}

const ORIGIN: Vec2 = { x: 0, y: 0 }

/** What is left of segment a→b outside the circle (c, r): none, one or two pieces. */
function clipSegment([a, b]: [Vec2, Vec2], c: Vec2, r: number): [Vec2, Vec2][] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const fx = a.x - c.x
  const fy = a.y - c.y
  const qa = dx * dx + dy * dy
  const qb = 2 * (fx * dx + fy * dy)
  const qc = fx * fx + fy * fy - r * r
  const disc = qb * qb - 4 * qa * qc
  if (qa === 0 || disc <= 0) return [[a, b]]
  const root = Math.sqrt(disc)
  const t1 = (-qb - root) / (2 * qa)
  const t2 = (-qb + root) / (2 * qa)
  if (t2 <= 0 || t1 >= 1) return [[a, b]]
  const at = (t: number): Vec2 => ({ x: a.x + dx * t, y: a.y + dy * t })
  const out: [Vec2, Vec2][] = []
  const minPiece = 0.05 / Math.sqrt(qa)
  if (t1 > minPiece) out.push([a, at(t1)])
  if (t2 < 1 - minPiece) out.push([at(t2), b])
  return out
}

function midpoint([a, b]: [Vec2, Vec2]): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function minDist(p: Vec2, points: Vec2[]): number {
  return Math.min(...points.map((q) => dist(p, q)))
}

/** Glade ids the hearth reaches over these neighbour lists. */
function reachable(lists: string[][], index: Map<string, number>): Set<string> {
  const seen = new Set<string>(['glade0'])
  const queue = ['glade0']
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const n of lists[index.get(id)!] ?? []) {
      if (seen.has(n)) continue
      seen.add(n)
      queue.push(n)
    }
  }
  return seen
}

/** The border two Voronoi cells share, if they share more than a point. */
function sharedEdge(a: Vec2[], b: Vec2[]): [Vec2, Vec2] | null {
  const common = a.filter((p) => b.some((q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6))
  if (common.length < 2) return null
  // Two cells share one edge: its two ends are the common points furthest apart.
  let best: [Vec2, Vec2] = [common[0], common[1]]
  for (let i = 0; i < common.length; i++) {
    for (let j = i + 1; j < common.length; j++) {
      if (dist(common[i], common[j]) > dist(best[0], best[1])) best = [common[i], common[j]]
    }
  }
  return dist(best[0], best[1]) > 1e-3 ? best : null
}

/**
 * The biome's region: the glades nearest a random heading (a wedge of the
 * rings or the ruins), the river's far bank, or one flank of the ridge's
 * lowland — about `share` of the glades beyond the hearth's.
 */
function biomeRegion(rng: Rng, layout: LayoutDef, biome: BiomeDef, seeds: SeedPoint[]): Set<string> {
  const outer = seeds.filter((s) => s.kind !== 'settlement')
  const want = Math.max(3, Math.round(outer.length * (biome.share ?? 0.33)))
  if (layout.biomeRegion === 'farSide') {
    const far = outer.filter((s) => s.side === 1)
    if (far.length >= 3) return new Set(far.map((s) => s.id))
  }
  const pool = layout.biomeRegion === 'flank' ? outer.filter((s) => s.side === 1) : outer
  const heading = rng.next() * Math.PI * 2
  const off = (s: SeedPoint) => {
    const a = Math.atan2(s.center.y, s.center.x) - heading
    return Math.abs(Math.atan2(Math.sin(a), Math.cos(a)))
  }
  return new Set(
    [...pool]
      .sort((a, b) => off(a) - off(b))
      .slice(0, want)
      .map((s) => s.id),
  )
}

/** A glade theme, drawn with any modifier weights on its terrain. */
function pickTheme(rng: Rng, hooks: MapgenHooks): (typeof GLADE_THEMES)[number] {
  const weights = hooks.themeWeights
  if (!weights) return rng.pick(GLADE_THEMES)
  return rng.weighted(GLADE_THEMES, (t) => weights[t.terrain] ?? 1)
}

function scaleReward(reward: ResourceBag, factor: number | undefined): ResourceBag {
  if (factor === undefined || factor === 1) return reward
  const out: ResourceBag = {}
  for (const [id, amount] of Object.entries(reward)) {
    const qty = Math.round((amount ?? 0) * factor)
    if (qty > 0) out[id as keyof ResourceBag] = qty
  }
  return out
}

/**
 * Scales each deposit kind's count outside the settlement glade, after
 * everything else is placed — so the rest of the map is exactly the one the
 * seed generates without the hook. The opening glade is never touched: its
 * starter deposits are what keep the first minutes survivable.
 *
 * Extra deposits go to glades that already carry the kind (a richer seam where
 * the theme put one), round-robin; removals take from the glades with the
 * most of that kind first, so no glade loses its only patch while another
 * keeps three.
 */
function applyDepositScale(
  rng: Rng,
  scale: Partial<Record<DepositId, number>>,
  glades: Record<string, Glade>,
  deposits: Record<string, WorldDeposit>,
  obstacles: Obstacle[],
  counterStart: number,
): void {
  let counter = counterStart
  const kinds = (Object.keys(scale) as DepositId[]).sort()
  for (const kind of kinds) {
    const factor = scale[kind] ?? 1
    if (factor === 1) continue
    const existing = Object.values(deposits).filter(
      (d) => d.kind === kind && d.gladeId !== 'glade0',
    )
    const target = Math.max(0, Math.round(existing.length * factor))

    if (target < existing.length) {
      const perGlade = (gladeId: string) =>
        Object.values(deposits).filter((d) => d.kind === kind && d.gladeId === gladeId).length
      for (let removed = existing.length - target; removed > 0; removed--) {
        const live = Object.values(deposits).filter(
          (d) => d.kind === kind && d.gladeId !== 'glade0',
        )
        // Richest glade first; ties broken by the RNG.
        const most = Math.max(...live.map((d) => perGlade(d.gladeId)))
        const victim = rng.pick(live.filter((d) => perGlade(d.gladeId) === most))
        delete deposits[victim.id]
      }
      continue
    }

    // Glades that already carry the kind, in id order (deterministic).
    let hosts = [...new Set(existing.map((d) => d.gladeId))].sort()
    // A kind the map lacks entirely seeds itself in random glades.
    if (hosts.length === 0) {
      hosts = rng.shuffle(Object.keys(glades).filter((id) => id !== 'glade0')).slice(0, 3)
    }
    let placed = 0
    let attempts = 0
    const want = target - existing.length
    while (placed < want && attempts < want * 4 && hosts.length > 0) {
      const gladeId = hosts[attempts % hosts.length]
      attempts++
      const glade = glades[gladeId]
      const radius = DEPOSIT_RADIUS[kind]
      const taken = [
        { pos: glade.center, radius: 1.0 },
        ...Object.values(deposits)
          .filter((d) => d.gladeId === gladeId)
          .map((d) => ({ pos: d.pos, radius: d.radius })),
        ...obstacles
          .filter((o) => o.gladeId === gladeId)
          .map((o) => ({ pos: o.pos, radius: o.radius })),
      ]
      const pos = scatter(rng, glade.polygon, radius * 0.5 + 0.25, taken, radius)
      if (!pos) continue
      const id = `d${counter++}`
      deposits[id] = {
        id,
        kind,
        pos,
        radius,
        amount: infiniteDeposit(kind) ? null : rng.range(14, 30),
        gladeId,
      }
      placed++
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/**
 * A point inside the polygon whose circle of `radius` keeps a small breathing
 * gap from everything already placed. Cramped polygons relax the margins in
 * stages rather than dropping the feature — a settlement without its starter
 * trees is an unwinnable run, not a cosy one.
 */
function scatter(
  rng: Rng,
  polygon: Vec2[],
  edgeMargin: number,
  taken: { pos: Vec2; radius: number }[],
  radius: number,
): Vec2 | null {
  const relaxations: [number, number][] = [
    [edgeMargin, 0.35],
    [Math.min(edgeMargin, 0.3), 0.15],
    [0.1, 0],
  ]
  for (const [margin, gap] of relaxations) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const p = randomPointInPolygon(() => rng.next(), polygon, margin, 20)
      if (!p) break
      if (taken.some((t) => dist(p, t.pos) < t.radius + radius + gap)) continue
      return p
    }
  }
  return null
}

function infiniteDeposit(id: DepositId): boolean {
  return RENEWABLE_DEPOSITS.has(id)
}

function clearWorkFor(kind: GladeKind, distance: number): number {
  const base = kind === 'small' ? 55 : kind === 'dangerous' ? 110 : 190
  return Math.round(base * (1 + distance * 0.06))
}

function rewardFor(kind: GladeKind, rng: Rng): ResourceBag {
  if (kind === 'small') {
    return rng.pick<ResourceBag>([
      { wood: 12, berry: 8 },
      { stone: 10, plantFiber: 8 },
      { clay: 10, mushroom: 8 },
      { wood: 8, plank: 4, amber: 10 },
    ])
  }
  if (kind === 'dangerous') {
    return rng.pick<ResourceBag>([
      { plank: 8, fabric: 4, amber: 15 },
      { stone: 18, brick: 4, amber: 15 },
      { meat: 14, herb: 10, amber: 15 },
      { copperOre: 12, resin: 6, amber: 15 },
    ])
  }
  return rng.pick<ResourceBag>([
    { plank: 14, brick: 10, tool: 2, amber: 35 },
    { copperBar: 10, part: 4, amber: 40 },
    { scroll: 10, incense: 8, amber: 35 },
  ])
}
