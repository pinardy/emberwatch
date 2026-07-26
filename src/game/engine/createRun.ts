import { BUILDINGS, STARTING_BLUEPRINTS } from '../content/buildings'
import { ORDER_LIST } from '../content/orders'
import { SPECIES, STARTING_SPECIES, villagerName } from '../content/species'
import type {
  BuildingInstance,
  MetaState,
  Order,
  ResourceBag,
  RunState,
  SpeciesId,
  Villager,
} from '../types'
import {
  BASE_STORAGE,
  OPENING_BLUEPRINT_PICKS,
  SEASON_LENGTH,
  STARTING_STOCK,
  STARTING_VILLAGERS,
  MAX_IMPATIENCE,
  MAX_REPUTATION,
} from './balance'
import { offerBlueprint } from './events'
import { hexKey } from './hex'
import { generateMap } from './mapgen'
import { depositsInRangeOf } from './production'
import { makeRng } from './rng'

export interface NewRunOptions {
  seed: number
  meta?: MetaState
  /** Override the species drawn for this map (used by the run setup screen). */
  species?: SpeciesId[]
}

export function createRun({ seed, meta, species }: NewRunOptions): RunState {
  const rng = makeRng(seed, 0)
  const { tiles, glades } = generateMap(rng)

  const available = meta
    ? [...new Set([...STARTING_SPECIES, ...meta.unlockedSpecies])]
    : STARTING_SPECIES
  const speciesPool = species ?? rng.sample(available, Math.min(3, available.length))

  // --- hearth ---------------------------------------------------------------
  const hearthTile = hexKey(0, 0)
  const hearth: BuildingInstance = {
    id: 'hearth',
    defId: 'ancientHearth',
    tile: hearthTile,
    built: true,
    buildProgress: 0,
    workers: [],
    activeRecipeId: '',
    recipeProgress: 0,
    paused: false,
    depositsInRange: {},
  }
  tiles[hearthTile].buildingId = hearth.id

  // --- starting villagers, spread across the drawn species ------------------
  const villagers: Record<string, Villager> = {}
  for (let i = 0; i < STARTING_VILLAGERS; i++) {
    const sp = speciesPool[i % speciesPool.length]
    const id = `v${i}`
    villagers[id] = {
      id,
      species: sp,
      name: villagerName(i),
      assignment: null,
    }
  }

  const stock: ResourceBag = { ...STARTING_STOCK }
  if (meta?.upgrades.includes('deeperStores')) stock.wood = (stock.wood ?? 0) + 20
  if (meta?.upgrades.includes('travelRations')) stock.biscuit = 15

  const state: RunState = {
    seed,
    rngCursor: rng.cursor(),
    phase: 'playing',
    season: { year: 1, season: 'drizzle', elapsed: 0, length: SEASON_LENGTH.drizzle },
    clock: 0,
    tiles,
    glades,
    buildings: { [hearth.id]: hearth },
    villagers,
    stock,
    storageCap: BASE_STORAGE + (BUILDINGS.ancientHearth.storage ?? 0),
    reputation: 0,
    maxReputation: MAX_REPUTATION,
    reputationProgress: 0,
    impatience: 0,
    maxImpatience: MAX_IMPATIENCE,
    impatienceProgress: 0,
    hostility: 0,
    resolve: {
      human: SPECIES.human.baseResolve,
      beaver: SPECIES.beaver.baseResolve,
      lizard: SPECIES.lizard.baseResolve,
      harpy: SPECIES.harpy.baseResolve,
      fox: SPECIES.fox.baseResolve,
    },
    despair: { human: 0, beaver: 0, lizard: 0, harpy: 0, fox: 0 },
    foodDebt: 0,
    starving: false,
    coldHearth: false,
    orders: [],
    cornerstones: meta?.upgrades.includes('citadelBlessing') ? ['campfireTales'] : [],
    cornerstonesTaken: 0,
    pendingChoices: [],
    log: [],
    logCounter: 0,
    speciesPool,
    newcomerTimer: 0,
    unlockedBuildings: [...STARTING_BLUEPRINTS],
    producedTotals: {},
    ordersSeen: [],
    orderCounter: 0,
    stats: {
      resourcesProduced: 0,
      gladesCleared: 0,
      villagersLost: 0,
      buildingsBuilt: 0,
      ordersCompleted: 0,
    },
  }

  // The hearth's storage is already counted above; recompute deposits cache.
  hearth.depositsInRange = depositsInRangeOf(state, hearthTile, 0)

  // --- opening orders -------------------------------------------------------
  for (let i = 0; i < 3; i++) drawOrder(state)

  // --- opening blueprint draft ---------------------------------------------
  // The run begins on a choice: which buildings this settlement will have. It
  // also guarantees a route to satisfying at least one service need.
  for (let i = 0; i < OPENING_BLUEPRINT_PICKS; i++) offerBlueprint(state)

  pushLog(
    state,
    `Year 1, Drizzle. You are the Viceroy of ${glades.glade0.name}. Build, feed, and keep them from leaving.`,
    'info',
  )

  return state
}

/** Draws a fresh order the run has not seen yet and appends it. */
export function drawOrder(s: RunState): Order | null {
  const rng = makeRng(s.seed, s.rngCursor)
  const activeDefIds = s.orders.filter((o) => !o.complete).map((o) => o.defId)
  let pool = ORDER_LIST.filter(
    (d) => !s.ordersSeen.includes(d.id) && !activeDefIds.includes(d.id),
  )
  // Once every order has been seen, allow repeats rather than running dry.
  if (pool.length === 0) {
    pool = ORDER_LIST.filter((d) => !activeDefIds.includes(d.id))
  }
  if (pool.length === 0) {
    s.rngCursor = rng.cursor()
    return null
  }
  const def = rng.pick(pool)
  s.rngCursor = rng.cursor()
  s.ordersSeen.push(def.id)

  const order: Order = {
    id: `o${s.orderCounter++}`,
    defId: def.id,
    progress: 0,
    complete: false,
  }
  s.orders.push(order)
  return order
}

export function pushLog(
  s: RunState,
  text: string,
  tone: 'info' | 'good' | 'bad' = 'info',
): void {
  s.log.unshift({
    id: s.logCounter++,
    year: s.season.year,
    season: s.season.season,
    text,
    tone,
  })
  if (s.log.length > 80) s.log.length = 80
}
