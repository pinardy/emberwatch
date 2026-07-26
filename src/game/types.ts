/**
 * Core domain types for Emberwatch.
 *
 * The whole simulation is a plain serialisable object (`RunState`) advanced by
 * pure functions in `engine/`. Nothing in here may reference React or the DOM —
 * that keeps the sim testable and lets us snapshot it straight into storage.
 */

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export type ResourceId =
  // building materials
  | 'wood'
  | 'plank'
  | 'stone'
  | 'brick'
  | 'clay'
  | 'copperOre'
  | 'copperBar'
  | 'plantFiber'
  | 'fabric'
  | 'resin'
  | 'part'
  | 'tool'
  // raw food
  | 'berry'
  | 'root'
  | 'meat'
  | 'grain'
  | 'vegetable'
  | 'mushroom'
  | 'insect'
  | 'egg'
  | 'herb'
  // cooked food
  | 'biscuit'
  | 'skewer'
  | 'jerky'
  | 'porridge'
  | 'pickles'
  // service goods
  | 'ale'
  | 'incense'
  | 'scroll'
  | 'tea'
  | 'trainingGear'
  // currency
  | 'amber'

export type ResourceCategory =
  | 'material'
  | 'rawFood'
  | 'food'
  | 'serviceGood'
  | 'currency'

export interface ResourceDef {
  id: ResourceId
  name: string
  category: ResourceCategory
  /** Emoji stand-in for art. Keeps the build asset-free. */
  icon: string
  /** Base amber value, used by the trader. */
  value: number
}

/** Sparse resource bag. Absent key === 0. */
export type ResourceBag = Partial<Record<ResourceId, number>>

// ---------------------------------------------------------------------------
// Species & needs
// ---------------------------------------------------------------------------

export type SpeciesId = 'human' | 'beaver' | 'lizard' | 'harpy' | 'fox'

export type ServiceNeed =
  | 'rest'
  | 'luxury'
  | 'religion'
  | 'education'
  | 'brawling'
  | 'treatment'

export interface SpeciesDef {
  id: SpeciesId
  name: string
  icon: string
  /** Colour used for charts and resolve bars. */
  color: string
  /** Resolve floor before any modifiers. */
  baseResolve: number
  /** Resolve at which this species starts generating reputation. */
  resolveTarget: number
  /** Each satisfied need grants this much resolve. */
  needs: ServiceNeed[]
  /** Building tags this species works faster at, e.g. `{ farming: 0.25 }`. */
  workBonus: Partial<Record<BuildingTag, number>>
  blurb: string
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export type BuildingTag =
  | 'gathering'
  | 'farming'
  | 'woodworking'
  | 'masonry'
  | 'smithing'
  | 'crafting'
  | 'alchemy'
  | 'cooking'
  | 'brewing'
  | 'scholar'
  | 'hunting'
  | 'housing'
  | 'service'
  | 'storage'
  | 'special'

export type BuildingCategory =
  | 'hearth'
  | 'housing'
  | 'gathering'
  | 'production'
  | 'service'
  | 'logistics'

/** A single production option inside a building. */
export interface Recipe {
  id: string
  /** Consumed when the cycle *starts*. */
  inputs: ResourceBag
  /** Produced when the cycle completes. */
  outputs: ResourceBag
  /** Seconds of work at one worker's base speed. */
  seconds: number
  /** Recipes needing a deposit only run if the building has one in range. */
  requiresDeposit?: DepositId
}

export interface BuildingDef {
  id: string
  name: string
  icon: string
  category: BuildingCategory
  tags: BuildingTag[]
  cost: ResourceBag
  /** Seconds of construction work at one builder's speed. */
  buildSeconds: number
  workerSlots: number
  recipes: Recipe[]
  /** Housing capacity. */
  housing?: number
  /** Extra stockpile capacity. */
  storage?: number
  /**
   * Service buildings satisfy a need for up to `serviceCapacity` villagers,
   * consuming `recipes[0].inputs` per completed cycle.
   */
  service?: { need: ServiceNeed; capacity: number }
  /** Gathering camps only harvest deposits within this hex radius. */
  gatherRadius?: number
  /** Only one may exist per settlement. */
  unique?: boolean
  description: string
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

export type TerrainId = 'clearing' | 'forest' | 'marsh' | 'rock' | 'fertile'

export type DepositId =
  | 'trees'
  | 'stoneVein'
  | 'clayPatch'
  | 'orePatch'
  | 'vegetation'
  | 'game'
  | 'fertileSoil'

export interface Deposit {
  id: DepositId
  /** Remaining harvests; `null` for infinite (fertile soil, trees regrow). */
  amount: number | null
}

/** Axial hex coordinate. */
export interface Hex {
  q: number
  r: number
}

export interface Tile extends Hex {
  key: string
  terrain: TerrainId
  gladeId: string
  deposit?: Deposit
  /** Id of the building instance occupying this tile. */
  buildingId?: string
  /** Blocked tiles can never be built on (cliffs, deep marsh). */
  blocked: boolean
}

export type GladeKind = 'settlement' | 'small' | 'dangerous' | 'forbidden'

export interface Glade {
  id: string
  kind: GladeKind
  name: string
  tiles: string[]
  /** Centre tile, used for labels and camera focus. */
  center: Hex
  /** Glade ids sharing a border. Only glades next to a cleared one are reachable. */
  neighbors: string[]
  /** Fogged glades hide their contents. */
  discovered: boolean
  /** Cleared glades can be built on and have resolved their event. */
  cleared: boolean
  /** Villager-seconds required to clear. */
  clearWork: number
  clearProgress: number
  /** Workers currently assigned to clearing. */
  clearers: number
  /** Loot granted on clear. */
  reward: ResourceBag
  /** Event that must be resolved when the glade is cleared. */
  eventId?: string
}

// ---------------------------------------------------------------------------
// Live instances
// ---------------------------------------------------------------------------

export interface Villager {
  id: string
  species: SpeciesId
  name: string
  /** Building instance id, `clearing:<gladeId>`, or null when idle. */
  assignment: string | null
}

export interface BuildingInstance {
  id: string
  defId: string
  tile: string
  /** Under construction until `buildProgress >= buildSeconds`. */
  built: boolean
  buildProgress: number
  /** Villager ids working here. */
  workers: string[]
  activeRecipeId: string
  /** Seconds of work banked toward the active recipe. */
  recipeProgress: number
  /** Paused buildings keep workers but do no work. */
  paused: boolean
  /**
   * Tile keys of deposits reachable from this building, cached at placement
   * time and refreshed when a glade is cleared or a deposit runs dry.
   */
  depositsInRange: Partial<Record<DepositId, string[]>>
}

// ---------------------------------------------------------------------------
// Season cycle
// ---------------------------------------------------------------------------

export type Season = 'drizzle' | 'clearance' | 'storm'

export interface SeasonState {
  year: number
  season: Season
  /** Seconds elapsed in the current season. */
  elapsed: number
  /** Total length of the current season in seconds. */
  length: number
}

// ---------------------------------------------------------------------------
// Meta systems
// ---------------------------------------------------------------------------

/** Declarative order goal, evaluated against `RunState` each tick. */
export type OrderGoal =
  | { kind: 'stock'; resource: ResourceId; amount: number }
  | { kind: 'stockCategory'; category: ResourceCategory; amount: number }
  | { kind: 'produced'; resource: ResourceId; amount: number }
  | { kind: 'population'; amount: number }
  | { kind: 'buildingsOfCategory'; category: BuildingCategory; amount: number }
  | { kind: 'buildingId'; buildingId: string; amount: number }
  | { kind: 'gladesCleared'; amount: number }
  | { kind: 'housing'; amount: number }
  | { kind: 'resolveAbove'; value: number }

export interface OrderDef {
  id: string
  name: string
  goal: OrderGoal
  reputationReward: number
  /** Bonus paid out on completion. */
  reward?: ResourceBag
}

export interface Order {
  /** Instance id — orders are re-drawn, so this differs from `defId`. */
  id: string
  defId: string
  /** 0..1 */
  progress: number
  complete: boolean
}

export interface CornerstoneDef {
  id: string
  name: string
  icon: string
  rarity: 'common' | 'rare' | 'epic'
  description: string
  effects: CornerstoneEffect[]
}

/**
 * Cornerstones are declarative so they can be serialised and replayed. Each
 * effect is read at the point in the sim where it applies.
 */
export type CornerstoneEffect =
  | { kind: 'resolveFlat'; species: SpeciesId | 'all'; amount: number }
  | { kind: 'productionSpeed'; tag: BuildingTag | 'all'; percent: number }
  | { kind: 'extraOutput'; tag: BuildingTag | 'all'; chance: number }
  | { kind: 'hostilityRate'; percent: number }
  | { kind: 'foodUpkeep'; percent: number }
  | { kind: 'globalStorage'; amount: number }
  | { kind: 'reputationRate'; percent: number }
  | { kind: 'buildSpeed'; percent: number }
  | { kind: 'clearSpeed'; percent: number }
  | { kind: 'needsFewerServices'; species: SpeciesId | 'all'; amount: number }

export interface GladeEventOptionDef {
  label: string
  description: string
  /** Paid immediately when chosen. */
  cost?: ResourceBag
  /** Granted immediately. */
  gain?: ResourceBag
  hostility?: number
  impatience?: number
  reputation?: number
  /** Villagers lost (storm beasts, plague...). */
  villagerLoss?: number
  /** Requires this much of each resource to be selectable. */
  requires?: ResourceBag
}

export interface GladeEventDef {
  id: string
  name: string
  icon: string
  kind: Exclude<GladeKind, 'settlement' | 'small'>
  description: string
  options: GladeEventOptionDef[]
}

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

export type RunPhase = 'playing' | 'won' | 'lost'

export interface PendingChoice {
  kind: 'cornerstone' | 'blueprint' | 'gladeEvent'
  /** Cornerstone/building ids offered, or `[eventId]` for glade events. */
  options: string[]
  /** For glade events: which glade triggered it. */
  gladeId?: string
}

export interface LogEntry {
  id: number
  year: number
  season: Season
  text: string
  tone: 'info' | 'good' | 'bad'
}

export interface RunState {
  /** Seed for all run randomness; enables shareable/reproducible runs. */
  seed: number
  /** RNG cursor, advanced in place so saves resume deterministically. */
  rngCursor: number
  phase: RunPhase

  season: SeasonState
  /** Total seconds of simulation elapsed. */
  clock: number

  tiles: Record<string, Tile>
  glades: Record<string, Glade>
  buildings: Record<string, BuildingInstance>
  villagers: Record<string, Villager>

  stock: ResourceBag
  /** Cached: base storage + warehouses + cornerstones. */
  storageCap: number

  /** 0..maxReputation */
  reputation: number
  maxReputation: number
  /** Fractional accumulator so reputation ticks smoothly. */
  reputationProgress: number
  /** 0..maxImpatience */
  impatience: number
  maxImpatience: number
  impatienceProgress: number

  hostility: number
  /** Current resolve per species; drifts toward a computed target each tick. */
  resolve: Record<SpeciesId, number>
  /** Seconds a species has spent below the leaving threshold. */
  despair: Record<SpeciesId, number>

  /** Fractional meals owed, so food drains smoothly across ticks. */
  foodDebt: number
  /** Set when the settlement could not cover its meals this tick. */
  starving: boolean
  /** Set when the hearth has no wood during the Storm. */
  coldHearth: boolean

  orders: Order[]
  cornerstones: string[]
  /** Reputation thresholds already used to offer a cornerstone. */
  cornerstonesTaken: number

  /** FIFO queue — a glade event and a reputation milestone can land together. */
  pendingChoices: PendingChoice[]

  /** Newest first, capped. */
  log: LogEntry[]
  logCounter: number

  /** Species present on this map (drawn at run start). */
  speciesPool: SpeciesId[]
  /** Villagers waiting at the hearth to be welcomed (newcomers). */
  newcomerTimer: number

  /** Buildings unlocked for this run (blueprint draws). */
  unlockedBuildings: string[]

  /** Lifetime production totals, used by "produce N of X" orders. */
  producedTotals: ResourceBag

  /** Order def ids already drawn, so we do not repeat them. */
  ordersSeen: string[]
  orderCounter: number

  stats: {
    resourcesProduced: number
    gladesCleared: number
    villagersLost: number
    buildingsBuilt: number
    ordersCompleted: number
  }
}

// ---------------------------------------------------------------------------
// Persistent meta progression (survives across runs)
// ---------------------------------------------------------------------------

export interface MetaState {
  version: number
  /** Spendable currency earned by finishing runs. */
  citadelSupplies: number
  runsWon: number
  runsLost: number
  /** Unlocked species beyond the starting three. */
  unlockedSpecies: SpeciesId[]
  /** Permanent perks bought in the Citadel. */
  upgrades: string[]
  history: {
    seed: number
    won: boolean
    years: number
    reputation: number
    at: number
  }[]
}
