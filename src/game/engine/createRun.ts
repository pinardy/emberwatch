import { BUILDINGS, STARTING_BLUEPRINTS } from '../content/buildings'
import { citadelLoadout, clampEdict, edictLabel, edictModifiers } from './meta'
import {
  SPECIES,
  STARTING_SPECIES,
  VILLAGER_TRAIT_LIST,
  villagerName,
} from '../content/species'
import type {
  BiomeId,
  BuildingInstance,
  LayoutId,
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
  YEAR_SECONDS,
  VILLAGER_TRAIT_CHANCE,
} from './balance'
import { offerBlueprint, offerCornerstone } from './drafts'
import { drawOrder, offerWrit } from './orders'
import { markFounding } from './founding'
import { defaultDecreeState } from './structure'
import { emptyTimeline } from './timeline'
import { defaultCaravan } from './trade'
import { generateMap } from './worldgen'
import { pushLog } from './runLog'
import { computeModifiers, seasonLengthFor } from './modifiers'
import { yearLengthFor } from './forecast'
import { makeRng } from './rng'
import { findCampPlot } from './campPlot'
import { drawTerrainPlan, isUnusualPlan, layoutOf, biomeOf } from './terrainPlan'
import { computeStorageCap } from './queries'
import { applyCommission, commissionLand } from './citadel'
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
  /**
   * A Citadel commission (id in `COMMISSIONS`): its twist is applied at the
   * founding and its objective judged at the end. The caller checks it was
   * on offer; unknown ids found a run without one.
   */
  commission?: string
  /**
   * Pin the map's layout or biome (ids in `content/layouts.ts`); by default
   * both are drawn from the seed and the land. Tests and the harness pin them.
   */
  layout?: LayoutId
  biome?: BiomeId
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
  commission,
  layout,
  biome,
}: NewRunOptions): RunState {
  const rng = makeRng(seed, 0)
  // Citadel upgrades and the chosen edict, folded into plain numbers.
  const loadout = citadelLoadout(meta?.upgrades ?? [], meta?.achievements)
  const edictLevel = clampEdict(edict)
  const edictMods = edictModifiers(edictLevel)
  // The land's character comes from the seed (its own RNG stream), and shapes
  // the map before anything is placed on it.
  // A commission may promise a land of its own (the Deep Works' veins).
  const runModifiers = commissionLand(modifiers ?? landFor(seed, loadout, landChoice), commission)
  const hooks = mapgenHooksFor(runModifiers)
  // So do its layout and biome (their own stream too; the land can lean them).
  const plan = drawTerrainPlan(seed, hooks, { layout, biome })
  const { world, glades, deposits, obstacles } = generateMap(rng, hooks, plan)

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
    buildingCounter: 0,
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
    orderOffers: [],
    log: [],
    logCounter: 0,
    timeline: emptyTimeline(speciesPool),
    speciesPool,
    newcomerTimer: 0,
    unlockedBuildings: [...new Set([...STARTING_BLUEPRINTS, ...loadout.startBlueprints])],
    producedTotals: {},
    ordersSeen: [],
    orderTallies: {},
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
  // The commission's twist, folded in like the land's (no commission: no change).
  applyCommission(state, commission)
  // Season-length effects reach the opening Drizzle too (an early frost).
  const landMods = computeModifiers(state)
  state.season.length = seasonLengthFor('drizzle', 1, landMods)
  // So does the land's storage (Early Frost's woodshed): counted now, as the
  // first tick would, not after the founding — or its extra firewood reads as
  // a full stockpile while the clock waits.
  state.storageCap = computeStorageCap(state, BASE_STORAGE + landMods.globalStorage)
  // The first decree waits out Year 1 (DECREE_FIRST_DELAY is a base-length
  // year): follow the year this land actually has, so it still arrives as
  // Year 2 opens under Long Storms or an Early Frost.
  state.decreeTimer += yearLengthFor(1, landMods) - YEAR_SECONDS

  // A spot by the hearth glade's trees is kept for the first Woodcutters'
  // Camp, so a cramped start cannot build itself out of wood.
  const plot = findCampPlot(state)
  if (plot) state.campPlot = plot

  // --- opening orders -------------------------------------------------------
  // Two standing orders, drawn to fit; the third slot is the founding writ,
  // chosen once the opening draft is done.
  for (let i = 0; i < ORDER_SLOTS - 1; i++) drawOrder(state)

  // --- the founding: opening blueprint drafts, cornerstone, writ -------------
  // The run begins on a choice: which buildings this settlement will have. It
  // also guarantees a route to satisfying at least one service need.
  const openingPicks = OPENING_BLUEPRINT_PICKS + loadout.openingPicks
  for (let i = 0; i < openingPicks; i++) offerBlueprint(state, false)
  // Every run lays a cornerstone before the first tick, so a perk shapes the
  // run from its first minute — a founding one, drawn from the commons; the
  // Viceroy's Signet adds a second from the whole pool.
  offerCornerstone(state, true)
  if (loadout.startCornerstoneChoice) offerCornerstone(state)
  // The founding writ: a small first goal, worth a point in the opening minutes.
  offerWrit(state)
  // All of these are made together, beside the map, before the clock starts.
  markFounding(state)

  const land = runModifierDefs(state.runModifiers)
  if (land.length > 0) {
    pushLog(
      state,
      `The lay of the land: ${land.map((d) => `${d.icon} ${d.name}`).join(', ')}.`,
      'info',
    )
  }
  if (isUnusualPlan(plan)) {
    const ground = [layoutOf(world), biomeOf(world)].filter((d) => d.id !== 'rings' && d.id !== 'woodland')
    pushLog(state, `The ground: ${ground.map((d) => `${d.icon} ${d.name}`).join(', ')}.`, 'info')
  }
  pushLog(
    state,
    `Year 1, Drizzle. You are the Viceroy of ${glades.glade0.name}. Build, feed, and keep them from leaving.`,
    'info',
  )

  return state
}
