import { eventsOfKind } from '../content/gladeEvents'
import type {
  DepositId,
  Glade,
  GladeKind,
  Hex,
  ResourceBag,
  TerrainId,
  Tile,
} from '../types'
import { hexDistance, hexKey, hexNeighbors, hexesInRadius } from './hex'
import type { Rng } from './rng'

export const MAP_RADIUS = 8

export interface GeneratedMap {
  tiles: Record<string, Tile>
  glades: Record<string, Glade>
}

/** Deposit themes, so each glade feels like it is *about* something. */
const GLADE_THEMES: { deposits: DepositId[]; terrain: TerrainId }[] = [
  { deposits: ['trees', 'trees', 'vegetation'], terrain: 'forest' },
  { deposits: ['trees', 'vegetation', 'game'], terrain: 'forest' },
  { deposits: ['stoneVein', 'stoneVein', 'clayPatch'], terrain: 'rock' },
  { deposits: ['clayPatch', 'vegetation', 'trees'], terrain: 'marsh' },
  { deposits: ['fertileSoil', 'fertileSoil', 'vegetation'], terrain: 'fertile' },
  { deposits: ['game', 'game', 'vegetation'], terrain: 'forest' },
  { deposits: ['orePatch', 'stoneVein', 'trees'], terrain: 'rock' },
  { deposits: ['vegetation', 'vegetation', 'fertileSoil'], terrain: 'fertile' },
]

const GLADE_NAMES = [
  'Mossbrook', 'Ashfall', 'Wetstone', 'Hollow Reach', 'Thornmere', 'Gravewood',
  'Sunken Rill', 'Bitterloam', 'Fernhaven', 'Crooked Pines', 'Slatefen',
  'Weeping Birches', 'Dunmire', 'Oldroot', 'Cinderglade', 'Stillwater',
  'Rimefall', 'Harrowdeep', 'Broken Cairn', 'Nettlewick',
]

export function generateMap(rng: Rng): GeneratedMap {
  const all = hexesInRadius({ q: 0, r: 0 }, MAP_RADIUS)

  // --- 1. Seed the glades ---------------------------------------------------
  const seeds: { id: string; center: Hex; kind: GladeKind }[] = [
    { id: 'glade0', center: { q: 0, r: 0 }, kind: 'settlement' },
  ]

  // Two rings of seeds so the player always has a couple of easy neighbours.
  const innerCandidates = all.filter((h) => {
    const d = hexDistance(h, { q: 0, r: 0 })
    return d >= 3 && d <= 5
  })
  const outerCandidates = all.filter((h) => {
    const d = hexDistance(h, { q: 0, r: 0 })
    return d >= 6 && d <= MAP_RADIUS - 1
  })

  const innerSeeds = pickSpread(rng, innerCandidates, 6, 3)
  const outerSeeds = pickSpread(rng, outerCandidates, 8, 3)

  innerSeeds.forEach((center, i) => {
    // Inner ring skews safe so the opening is survivable.
    const kind: GladeKind = rng.chance(0.45) ? 'small' : 'dangerous'
    seeds.push({ id: `glade${i + 1}`, center, kind })
  })
  outerSeeds.forEach((center, i) => {
    const roll = rng.next()
    const kind: GladeKind = roll < 0.2 ? 'small' : roll < 0.7 ? 'dangerous' : 'forbidden'
    seeds.push({ id: `glade${innerSeeds.length + i + 1}`, center, kind })
  })

  // --- 2. Voronoi assign every tile to its nearest seed ---------------------
  const tiles: Record<string, Tile> = {}
  const gladeTiles: Record<string, string[]> = {}
  for (const seed of seeds) gladeTiles[seed.id] = []

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

  for (const h of all) {
    let best = seeds[0]
    let bestD = Infinity
    for (const seed of seeds) {
      // Bias toward the settlement so the starting glade is comfortably sized.
      const bias = seed.kind === 'settlement' ? -1.2 : 0
      const d = hexDistance(h, seed.center) + bias
      if (d < bestD) {
        bestD = d
        best = seed
      }
    }
    const key = hexKey(h.q, h.r)
    const theme = themeByGlade[best.id]
    const isCenter = best.center.q === h.q && best.center.r === h.r
    const edgeOfMap = hexDistance(h, { q: 0, r: 0 }) === MAP_RADIUS

    tiles[key] = {
      q: h.q,
      r: h.r,
      key,
      terrain: isCenter ? 'clearing' : jitterTerrain(rng, theme.terrain),
      gladeId: best.id,
      blocked: edgeOfMap ? true : theme.terrain === 'rock' && rng.chance(0.12),
    }
    gladeTiles[best.id].push(key)
  }

  // --- 3. Scatter deposits inside each glade -------------------------------
  for (const seed of seeds) {
    const theme = themeByGlade[seed.id]
    const keys = rng.shuffle(gladeTiles[seed.id].filter((k) => !tiles[k].blocked))
    // Settlement gets a guaranteed starter kit; others get 3-6 deposits.
    const count =
      seed.kind === 'settlement'
        ? Math.min(6, keys.length)
        : Math.min(keys.length, rng.range(3, 6))

    for (let i = 0; i < count; i++) {
      const key = keys[i]
      if (!key) break
      const depositId = theme.deposits[i % theme.deposits.length]
      tiles[key].deposit = {
        id: depositId,
        amount: infiniteDeposit(depositId) ? null : rng.range(14, 30),
      }
      if (depositId === 'fertileSoil') tiles[key].terrain = 'fertile'
    }

    // Keep the hearth's own tile free of deposits so we can place it there.
    const centerKey = hexKey(seed.center.q, seed.center.r)
    if (seed.kind === 'settlement') {
      delete tiles[centerKey].deposit
      tiles[centerKey].blocked = false
    }
  }

  // --- 4. Build glade records ----------------------------------------------
  const glades: Record<string, Glade> = {}
  const dangerousEvents = rng.shuffle(eventsOfKind('dangerous').map((e) => e.id))
  const forbiddenEvents = rng.shuffle(eventsOfKind('forbidden').map((e) => e.id))
  let dangerousCursor = 0
  let forbiddenCursor = 0
  const names = rng.shuffle(GLADE_NAMES)

  seeds.forEach((seed, index) => {
    const distance = hexDistance(seed.center, { q: 0, r: 0 })
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
      tiles: gladeTiles[seed.id],
      center: seed.center,
      neighbors: [],
      discovered: isSettlement,
      cleared: isSettlement,
      clearWork: isSettlement ? 0 : clearWorkFor(seed.kind, distance),
      clearProgress: 0,
      clearers: 0,
      reward: isSettlement ? {} : rewardFor(seed.kind, rng),
      eventId,
    }
  })

  // --- 5. Work out glade adjacency -----------------------------------------
  for (const tile of Object.values(tiles)) {
    for (const n of hexNeighbors(tile)) {
      const other = tiles[hexKey(n.q, n.r)]
      if (!other || other.gladeId === tile.gladeId) continue
      const list = glades[tile.gladeId].neighbors
      if (!list.includes(other.gladeId)) list.push(other.gladeId)
    }
  }

  // Neighbours of the starting glade are visible from the outset.
  for (const id of glades.glade0.neighbors) glades[id].discovered = true

  return { tiles, glades }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function jitterTerrain(rng: Rng, base: TerrainId): TerrainId {
  if (rng.chance(0.2)) {
    return rng.pick<TerrainId>(['clearing', 'forest', 'marsh', 'rock', 'fertile'])
  }
  return base
}

function infiniteDeposit(id: DepositId): boolean {
  // Farms and forests keep producing; mineral deposits run dry.
  return id === 'fertileSoil' || id === 'trees' || id === 'vegetation' || id === 'game'
}

function clearWorkFor(kind: GladeKind, distance: number): number {
  const base = kind === 'small' ? 55 : kind === 'dangerous' ? 110 : 190
  return Math.round(base * (1 + distance * 0.08))
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

/**
 * Greedily picks up to `count` hexes that are at least `minGap` apart, so glade
 * centres do not clump.
 */
function pickSpread(rng: Rng, candidates: Hex[], count: number, minGap: number): Hex[] {
  const shuffled = rng.shuffle(candidates)
  const chosen: Hex[] = []
  for (const h of shuffled) {
    if (chosen.length >= count) break
    if (chosen.every((c) => hexDistance(c, h) >= minGap)) chosen.push(h)
  }
  // Relax the gap if the map was too tight to fit them all.
  if (chosen.length < count) {
    for (const h of shuffled) {
      if (chosen.length >= count) break
      if (chosen.every((c) => hexDistance(c, h) >= minGap - 1)) {
        if (!chosen.some((c) => c.q === h.q && c.r === h.r)) chosen.push(h)
      }
    }
  }
  return chosen
}

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
