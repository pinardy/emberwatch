import { BUILDINGS, STARTING_BLUEPRINTS } from '../content/buildings'
import { citadelLoadout, clampEdict, edictLabel, edictModifiers } from '../content/meta'
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
  OngoingEffect,
  Order,
  ResourceBag,
  ResourceId,
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
import { offerBlueprint, offerCornerstone } from './events'
import { defaultDecreeState } from './structure'
import { defaultCaravan } from './trade'
import { generateMap } from './mapgen'
import { makeRng } from './rng'

export interface NewRunOptions {
  seed: number
  meta?: MetaState
  /** Override the species drawn for this map (used by the run setup screen). */
  species?: SpeciesId[]
  /** Queen's Edict difficulty level (0 = none). Clamped to the ladder. */
  edict?: number
}

/** A settlement never starts with fewer villagers than this, whatever the edict. */
const MIN_STARTING_VILLAGERS = 3

export function createRun({ seed, meta, species, edict }: NewRunOptions): RunState {
  const rng = makeRng(seed, 0)
  // Citadel upgrades and the chosen edict, folded into plain numbers.
  const loadout = citadelLoadout(meta?.upgrades ?? [])
  const edictLevel = clampEdict(edict)
  const edictMods = edictModifiers(edictLevel)
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
  const villagerCount = Math.max(
    MIN_STARTING_VILLAGERS,
    STARTING_VILLAGERS + loadout.startVillagers + edictMods.startVillagers,
  )
  for (let i = 0; i < villagerCount; i++) {
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

  // Edicts shrink the Queen's allotment; Citadel provisions ride on top.
  const stock: ResourceBag = {}
  for (const [id, amount] of Object.entries(STARTING_STOCK)) {
    stock[id as ResourceId] = Math.round(amount * edictMods.stockFactor)
  }
  for (const [id, amount] of Object.entries(loadout.startStock)) {
    const key = id as ResourceId
    stock[key] = (stock[key] ?? 0) + (amount ?? 0)
  }

  // Run-long modifiers from the Citadel and the edict, shown in the run.
  const ongoing: OngoingEffect[] = []
  if (loadout.ongoing.length > 0) {
    ongoing.push({
      id: 'citadel',
      name: 'Citadel provisions',
      icon: '🏛️',
      description: 'Standing favours bought in the Citadel.',
      effects: loadout.ongoing,
    })
  }
  if (edictMods.effects.length > 0) {
    ongoing.push({
      id: 'edict',
      name: `Queen's ${edictLabel(edictLevel)}`,
      icon: '📜',
      description: 'The harsher terms this settlement was founded under.',
      effects: edictMods.effects,
    })
  }

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
    maxReputation: MAX_REPUTATION + edictMods.maxReputation,
    reputationProgress: 0,
    impatience: 0,
    maxImpatience: Math.max(
      6,
      MAX_IMPATIENCE + loadout.maxImpatience + edictMods.maxImpatience,
    ),
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
    cornerstones: [...loadout.startCornerstones],
    cornerstonesTaken: 0,
    threats: [],
    threatCounter: 0,
    ongoing,
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
    unlockedBuildings: [...new Set([...STARTING_BLUEPRINTS, ...loadout.startBlueprints])],
    producedTotals: {},
    ordersSeen: [],
    orderCounter: 0,
    edict: edictLevel,
    citadel: loadout.perks,
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
  const openingPicks = OPENING_BLUEPRINT_PICKS + loadout.openingPicks
  for (let i = 0; i < openingPicks; i++) offerBlueprint(state)
  // The Viceroy's Signet adds a cornerstone pick to the opening.
  if (loadout.startCornerstoneChoice) offerCornerstone(state)

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
