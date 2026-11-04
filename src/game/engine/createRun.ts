import { BUILDINGS, STARTING_BLUEPRINTS } from '../content/buildings'
import { ORDER_LIST } from '../content/orders'
import {
  SPECIES,
  STARTING_SPECIES,
  VILLAGER_TRAIT_LIST,
  villagerName,
} from '../content/species'
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
  VILLAGER_TRAIT_CHANCE,
} from './balance'
import { offerBlueprint } from './events'
import { defaultDecreeState } from './structure'
import { defaultCaravan } from './trade'
import { generateMap } from './mapgen'
import { makeRng } from './rng'

export interface NewRunOptions {
  seed: number
  meta?: MetaState
  /** Override the species drawn for this map (used by the run setup screen). */
  species?: SpeciesId[]
}

export function createRun({ seed, meta, species }: NewRunOptions): RunState {
  const rng = makeRng(seed, 0)
  const { world, glades, deposits, obstacles } = generateMap(rng)

  const available = meta
    ? [...new Set([...STARTING_SPECIES, ...meta.unlockedSpecies])]
    : STARTING_SPECIES
  const speciesPool = species ?? rng.sample(available, Math.min(3, available.length))

  // --- hearth ---------------------------------------------------------------
  // The ancient hearth stands at the world's origin, in the settlement glade.
  const hearth: BuildingInstance = {
    id: 'hearth',
    defId: 'ancientHearth',
    pos: { x: 0, y: 0 },
    gladeId: 'glade0',
    built: true,
    buildProgress: 0,
    workers: [],
    activeRecipeId: '',
    recipeProgress: 0,
    paused: false,
    depositsInRange: {},
  }

  // --- starting villagers, spread across the drawn species ------------------
  const villagers: Record<string, Villager> = {}
  for (let i = 0; i < STARTING_VILLAGERS; i++) {
    const sp = speciesPool[i % speciesPool.length]
    const id = `v${i}`
    const trait = rng.chance(VILLAGER_TRAIT_CHANCE)
      ? rng.pick(VILLAGER_TRAIT_LIST).id
      : undefined
    villagers[id] = {
      id,
      species: sp,
      name: villagerName(i),
      assignment: null,
      ...(trait ? { trait } : {}),
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
    world,
    glades,
    deposits,
    obstacles,
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
    threats: [],
    threatCounter: 0,
    ongoing: [],
    conditions: [],
    conditionCounter: 0,
    ...defaultDecreeState(),
    charterOffered: false,
    charter: null,
    caravan: defaultCaravan(),
    rerollsUsed: 0,
    soothesUsed: 0,
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
