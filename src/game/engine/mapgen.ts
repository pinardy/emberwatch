import { Delaunay } from 'd3-delaunay'
import { eventsOfKind } from '../content/gladeEvents'
import type {
  DepositId,
  Glade,
  GladeKind,
  Obstacle,
  ResourceBag,
  TerrainId,
  Vec2,
  WorldDeposit,
  WorldInfo,
} from '../types'
import { dist, distToPolygonEdge, pointInPolygon, randomPointInPolygon } from './geometry'
import type { Rng } from './rng'

/**
 * The world is a continuous rectangle centred on the hearth, partitioned into
 * glades by a Voronoi diagram over seeded points. There is no grid: buildings
 * stand at arbitrary positions, deposits and obstacles are circular features
 * scattered inside their glade's polygon.
 */

export const WORLD_WIDTH = 28
export const WORLD_HEIGHT = 22

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

export const DEPOSIT_RADIUS: Record<DepositId, number> = {
  trees: 0.85,
  stoneVein: 0.6,
  clayPatch: 0.55,
  orePatch: 0.6,
  vegetation: 0.55,
  game: 0.6,
  fertileSoil: 0.8,
}

export function generateMap(rng: Rng): GeneratedMap {
  const world: WorldInfo = { width: WORLD_WIDTH, height: WORLD_HEIGHT }

  // --- 1. Seed the glade centres --------------------------------------------
  // Two rings around the settlement so the player always has a couple of easy
  // neighbours, jittered so no two maps share a skeleton.
  const seeds: { id: string; center: Vec2; kind: GladeKind }[] = [
    { id: 'glade0', center: { x: 0, y: 0 }, kind: 'settlement' },
  ]

  const placeRing = (count: number, minDist: number, maxDist: number, minGap: number) => {
    const placed: Vec2[] = []
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 24; attempt++) {
        const angle = ((i + rng.next() * 0.8) / count) * Math.PI * 2
        const d = minDist + rng.next() * (maxDist - minDist)
        const p = {
          x: clamp(Math.cos(angle) * d, -(world.width / 2 - EDGE_MARGIN), world.width / 2 - EDGE_MARGIN),
          y: clamp(Math.sin(angle) * d, -(world.height / 2 - EDGE_MARGIN), world.height / 2 - EDGE_MARGIN),
        }
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
    const kind: GladeKind = rng.chance(0.45) ? 'small' : 'dangerous'
    seeds.push({ id: `glade${i + 1}`, center, kind })
  })
  outer.forEach((center, i) => {
    const roll = rng.next()
    const kind: GladeKind = roll < 0.2 ? 'small' : roll < 0.7 ? 'dangerous' : 'forbidden'
    seeds.push({ id: `glade${inner.length + i + 1}`, center, kind })
  })

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

  const themeByGlade: Record<string, (typeof GLADE_THEMES)[number]> = {}
  for (const seed of seeds) {
    themeByGlade[seed.id] =
      seed.kind === 'settlement'
        ? // The opening glade is deliberately well-rounded: wood and food to
          // survive on, plus a little stone and clay so the first tier of
          // buildings is reachable before you have cleared anything.
          {
            deposits: ['trees', 'vegetation', 'trees', 'vegetation', 'stoneVein', 'clayPatch'],
            terrain: 'clearing',
          }
        : rng.pick(GLADE_THEMES)
  }

  // --- 3. Glade records --------------------------------------------------------
  const glades: Record<string, Glade> = {}
  const dangerousEvents = rng.shuffle(eventsOfKind('dangerous').map((e) => e.id))
  const forbiddenEvents = rng.shuffle(eventsOfKind('forbidden').map((e) => e.id))
  let dangerousCursor = 0
  let forbiddenCursor = 0
  const names = rng.shuffle(GLADE_NAMES)

  seeds.forEach((seed, index) => {
    const raw = voronoi.cellPolygon(index) ?? []
    // d3 closes the ring (last point repeats the first) — drop the duplicate.
    const polygon: Vec2[] = raw.slice(0, -1).map(([x, y]) => ({ x, y }))
    const distance = dist(seed.center, { x: 0, y: 0 })
    const isSettlement = seed.kind === 'settlement'
    let eventId: string | undefined
    if (seed.kind === 'dangerous') {
      eventId = dangerousEvents[dangerousCursor++ % dangerousEvents.length]
    } else if (seed.kind === 'forbidden') {
      eventId = forbiddenEvents[forbiddenCursor++ % forbiddenEvents.length]
    }

    glades[seed.id] = {
      id: seed.id,
      kind: seed.kind,
      name: isSettlement ? 'The Hearth' : (names[index % names.length] ?? `Glade ${index}`),
      polygon,
      center: seed.center,
      terrain: themeByGlade[seed.id].terrain,
      neighbors: [...voronoi.neighbors(index)].map((n) => seeds[n].id),
      discovered: isSettlement,
      cleared: isSettlement,
      clearWork: isSettlement ? 0 : clearWorkFor(seed.kind, distance),
      clearProgress: 0,
      clearers: 0,
      reward: isSettlement ? {} : rewardFor(seed.kind, rng),
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

  for (const seed of seeds) {
    const glade = glades[seed.id]
    const theme = themeByGlade[seed.id]
    const isSettlement = seed.kind === 'settlement'
    const taken: { pos: Vec2; radius: number }[] = []
    // The glade centre stays open: the hearth stands there in the settlement
    // (with room to build a ring around it), and the clearing crew's plate
    // hovers there everywhere else.
    taken.push({ pos: seed.center, radius: isSettlement ? 1.6 : 1.0 })

    // A guaranteed fourth deposit keeps the food economy honest — three-deposit
    // glades starved too many otherwise-competent runs in continuous space.
    const count = isSettlement ? theme.deposits.length : rng.range(4, 6)
    for (let i = 0; i < count; i++) {
      const kind = theme.deposits[i % theme.deposits.length]
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

  return { world, glades, deposits, obstacles }
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
  // Farms and forests keep producing; mineral deposits run dry.
  return id === 'fertileSoil' || id === 'trees' || id === 'vegetation' || id === 'game'
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

/** Deep-forest gloom aside, these read best against the 3D lighting too. */
export const TERRAIN_COLORS: Record<TerrainId, string> = {
  clearing: '#4a5a44',
  forest: '#2f4634',
  marsh: '#3c4a43',
  rock: '#4b4e52',
  fertile: '#5b6339',
}

export const DEPOSIT_INFO: Record<DepositId, { name: string; icon: string }> = {
  trees: { name: 'Trees', icon: '🌲' },
  stoneVein: { name: 'Stone Vein', icon: '🪨' },
  clayPatch: { name: 'Clay Patch', icon: '🟤' },
  orePatch: { name: 'Copper Seam', icon: '🟠' },
  vegetation: { name: 'Undergrowth', icon: '🌿' },
  game: { name: 'Game Trails', icon: '🐗' },
  fertileSoil: { name: 'Fertile Soil', icon: '🌾' },
}

/** True when the point lies inside the playable rectangle (minus a margin). */
export function insideWorld(world: WorldInfo, p: Vec2, margin = 0): boolean {
  return (
    Math.abs(p.x) <= world.width / 2 - margin && Math.abs(p.y) <= world.height / 2 - margin
  )
}

/** The glade whose polygon contains the point; they partition the world. */
export function gladeAt(
  glades: Record<string, Glade>,
  p: Vec2,
): Glade | undefined {
  let best: Glade | undefined
  let bestEdge = -Infinity
  for (const glade of Object.values(glades)) {
    if (!pointInPolygon(p, glade.polygon)) continue
    // Points exactly on a shared border can test inside both; prefer the one
    // the point sits deeper in so the answer is stable.
    const edge = distToPolygonEdge(p, glade.polygon)
    if (edge > bestEdge) {
      bestEdge = edge
      best = glade
    }
  }
  return best
}
