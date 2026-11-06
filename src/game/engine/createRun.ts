import { BUILDINGS, STARTING_BLUEPRINTS } from '../content/buildings'
import { citadelLoadout, clampEdict, edictLabel, edictModifiers } from '../content/meta'
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
  ResourceBag,
  ResourceId,
  RunState,
  SpeciesId,
  Villager,
} from '../types'
import {
  BASE_STORAGE,
  OPENING_BLUEPRINT_PICKS,
  STARTING_STOCK,
  STARTING_VILLAGERS,
  MAX_IMPATIENCE,
  MAX_REPUTATION,
  ORDER_SLOTS,
  SEASON_ORDER,
  YEAR_SECONDS,
  VILLAGER_TRAIT_CHANCE,
} from './balance'
import { offerBlueprint, offerCornerstone } from './events'
import { drawOrder, offerWrit } from './orders'
import { defaultDecreeState } from './structure'
import { emptyTimeline } from './timeline'
import { defaultCaravan } from './trade'
import { generateMap } from './mapgen'
import { computeModifiers, seasonLengthFor } from './modifiers'
import { makeRng } from './rng'
import { defaultFeats } from '../content/achievements'
import {
  applyRunModifiers,
  landFor,
  mapgenHooksFor,
  runModifierDefs,
  type LandChoice,
} from './runModifiers'

export interface NewRunOptions {
  seed: number
  meta?: MetaState
  /** Override the species drawn for this map (used by the run setup screen). */
  species?: SpeciesId[]
  /** Queen's Edict difficulty level (0 = none). Clamped to the ladder. */
  edict?: number
  /**
   * Override the map modifiers (ids in `RUN_MODIFIERS`); by default they are
   * drawn from the seed. Tests and the balance harness force them.
   */
  modifiers?: string[]
  /**
   * Setup-screen choices about the land (Second Survey's re-roll, Chosen
   * Ground's pick). Ignored unless the Citadel owns the matching upgrade.
   */
  land?: LandChoice
  /**
   * UTC date key of a daily expedition. Recorded on the run; the caller
   * passes the day's seed, species and edict and no `meta`, so no Citadel
   * upgrade applies.
   */
  daily?: string
}

/** A settlement never starts with fewer villagers than this, whatever the edict. */
const MIN_STARTING_VILLAGERS = 3

export function createRun({
  seed,
  meta,
  species,
  edict,
  modifiers,
  land: landChoice,
  daily,
}: NewRunOptions): RunState {
  const rng = makeRng(seed, 0)
  // Citadel upgrades and the chosen edict, folded into plain numbers.
  const loadout = citadelLoadout(meta?.upgrades ?? [])
  const edictLevel = clampEdict(edict)
  const edictMods = edictModifiers(edictLevel)
  // The land's character comes from the seed (its own RNG stream), and shapes
  // the map before anything is placed on it.
  const runModifiers = modifiers ?? landFor(seed, loadout, landChoice)
  const { world, glades, deposits, obstacles } = generateMap(rng, mapgenHooksFor(runModifiers))

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
    tier: 0,
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
    season: { year: 1, season: 'drizzle', elapsed: 0, length: 0 },
    clock: 0,
    world,
    glades,
    deposits,
    obstacles,
    buildings: { [hearth.id]: hearth },
    villagers,
    roads: [],
    roadCounter: 0,
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
    decreeStreak: 0,
    charterOffered: false,
    charter: null,
    caravan: defaultCaravan(),
    rerollsUsed: 0,
    soothesUsed: 0,
    pendingChoices: [],
    log: [],
    logCounter: 0,
    timeline: emptyTimeline(speciesPool),
    speciesPool,
    newcomerTimer: 0,
    unlockedBuildings: [...new Set([...STARTING_BLUEPRINTS, ...loadout.startBlueprints])],
    producedTotals: {},
    ordersSeen: [],
    orderCounter: 0,
    edict: edictLevel,
    runModifiers: [],
    citadel: loadout.perks,
    feats: defaultFeats(),
    stats: {
      resourcesProduced: 0,
      gladesCleared: 0,
      villagersLost: 0,
      buildingsBuilt: 0,
      ordersCompleted: 0,
    },
  }

  if (daily) state.daily = daily

  // --- the land's modifiers --------------------------------------------------
  applyRunModifiers(state, runModifiers)
  // Season-length effects reach the opening Drizzle too (an early frost).
  const landMods = computeModifiers(state)
  state.season.length = seasonLengthFor('drizzle', 1, landMods)
  // The first decree waits out Year 1 (DECREE_FIRST_DELAY is a base-length
  // year): follow the year this land actually has, so it still arrives as
  // Year 2 opens under Long Storms or an Early Frost.
  state.decreeTimer += yearOneLength(landMods) - YEAR_SECONDS

  // --- opening orders -------------------------------------------------------
  // Two standing orders, drawn to fit; the third slot is the founding writ,
  // chosen once the opening draft is done.
  for (let i = 0; i < ORDER_SLOTS - 1; i++) drawOrder(state)

  // --- opening blueprint draft ---------------------------------------------
  // The run begins on a choice: which buildings this settlement will have. It
  // also guarantees a route to satisfying at least one service need.
  const openingPicks = OPENING_BLUEPRINT_PICKS + loadout.openingPicks
  for (let i = 0; i < openingPicks; i++) offerBlueprint(state)
  // The Viceroy's Signet adds a cornerstone pick to the opening.
  if (loadout.startCornerstoneChoice) offerCornerstone(state)
  // The founding writ: a small first goal, worth a point in the opening minutes.
  offerWrit(state)

  const land = runModifierDefs(state.runModifiers)
  if (land.length > 0) {
    pushLog(
      state,
      `The lay of the land: ${land.map((d) => `${d.icon} ${d.name}`).join(', ')}.`,
      'info',
    )
  }
  pushLog(
    state,
    `Year 1, Drizzle. You are the Viceroy of ${glades.glade0.name}. Build, feed, and keep them from leaving.`,
    'info',
  )

  return state
}

/** Seconds in Year 1 once season-length modifiers apply. */
function yearOneLength(mods: ReturnType<typeof computeModifiers>): number {
  return SEASON_ORDER.reduce((sum, season) => sum + seasonLengthFor(season, 1, mods), 0)
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

export { drawOrder }
