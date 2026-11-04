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
  /** The species' rule-bending quirk — what makes drafting them a decision. */
  trait: SpeciesTrait
  blurb: string
}

/**
 * Species traits bend a rule for every villager of that species. Effects are
 * declarative like cornerstones, read at the point in the sim they apply.
 */
export type SpeciesTraitEffect =
  /** The cold-hearth resolve penalty does not apply to this species. */
  | { kind: 'ignoreColdHearth' }
  /** This species clears glades faster (percent, additive). */
  | { kind: 'clearRate'; percent: number }
  /** This species eats more/less (percent; negative = less). */
  | { kind: 'mealSize'; percent: number }
  /** Idle villagers of this species build faster (percent, additive). */
  | { kind: 'buildRate'; percent: number }
  /** Despair accumulates slower for this species (percent reduction). */
  | { kind: 'slowDespair'; percent: number }

export interface SpeciesTrait {
  name: string
  description: string
  effects: SpeciesTraitEffect[]
}

/**
 * Individual quirks rolled when a villager arrives. Small, readable effects —
 * enough to make a departure sting and a roster worth reading.
 */
export type VillagerTraitId =
  | 'diligent'
  | 'sluggish'
  | 'glutton'
  | 'frugal'
  | 'strongback'
  | 'pathfinder'
  | 'forager'
  | 'stormborn'

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
  /** Gathering camps only harvest deposits within this world-unit radius. */
  gatherRadius?: number
  /** Only one may exist per settlement. */
  unique?: boolean
  /**
   * Bonuses for standing close to built partners — several per building, each
   * matched by def id or by category (e.g. any home). Makes placement a puzzle
   * instead of a canvas. See `engine/adjacency.ts`.
   */
  adjacency?: AdjacencyBonus[]
  /**
   * A secondary warmth source: during the Storm it keeps housing within
   * `radius` warm while it burns `fuelPerSecond` wood, and goes cold without.
   */
  warmth?: { radius: number; fuelPerSecond: number }
  /** Footprint radius override; defaults to the category's footprint. */
  footprint?: number
  description: string
}

/**
 * One neighbourhood relationship. A partner is a *built* building within
 * `ADJACENCY_RANGE`, matched by `nearId` or by `nearCategory`.
 */
export interface AdjacencyBonus {
  /** A specific building def that counts as a partner. */
  nearId?: string
  /** Or any building of this category — e.g. any home for a service. */
  nearCategory?: BuildingCategory
  /** Percent per partner counted. */
  percent: number
  /** What improves: work speed (default) or a service's capacity. */
  effect?: 'speed' | 'capacity'
  /** Partners counted, each adding `percent` (default 1). */
  maxPartners?: number
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

export type TerrainId = 'clearing' | 'forest' | 'marsh' | 'rock' | 'fertile'

/**
 * What the ground under a building does to it. Declarative like cornerstone
 * effects; the table lives in `content/terrain.ts` and is read by production.
 */
export type TerrainEffect =
  /** Buildings carrying this tag work faster (or slower) here. */
  | { kind: 'workSpeed'; tag: BuildingTag; percent: number }
  /** Buildings with a recipe that yields this resource work faster here. */
  | { kind: 'yield'; resource: ResourceId; percent: number }
  /** Every building raised here goes up faster (or slower). */
  | { kind: 'buildSpeed'; percent: number }

export interface TerrainDef {
  id: TerrainId
  name: string
  icon: string
  blurb: string
  effects: TerrainEffect[]
}

export type DepositId =
  | 'trees'
  | 'stoneVein'
  | 'clayPatch'
  | 'orePatch'
  | 'vegetation'
  | 'game'
  | 'fertileSoil'

/** A point in continuous world space. +x east, +y south (screen-like). */
export interface Vec2 {
  x: number
  y: number
}

/** The playable rectangle, centred on the origin where the hearth stands. */
export interface WorldInfo {
  width: number
  height: number
}

/**
 * A resource feature standing somewhere in the world — a stand of trees, a
 * stone outcrop. Its footprint blocks construction; camps harvest it from
 * within their gather radius.
 */
export interface WorldDeposit {
  id: string
  kind: DepositId
  pos: Vec2
  /** Footprint radius in world units. */
  radius: number
  /** Remaining harvests; `null` for infinite (fertile soil, trees regrow). */
  amount: number | null
  gladeId: string
}

/** Unbuildable ground — a crag, a sink of deep mire. Purely spatial. */
export interface Obstacle {
  id: string
  kind: 'crag' | 'mire'
  pos: Vec2
  radius: number
  gladeId: string
}

export type GladeKind = 'settlement' | 'small' | 'dangerous' | 'forbidden'

export interface Glade {
  id: string
  kind: GladeKind
  name: string
  /** Voronoi cell in world coordinates; the glades partition the world. */
  polygon: Vec2[]
  /** Seed point of the cell, used for labels and camera focus. */
  center: Vec2
  /** Dominant ground cover, used for rendering and flavour. */
  terrain: TerrainId
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
  /** Personal quirk, rolled on arrival. Most villagers have one. */
  trait?: VillagerTraitId
}

export interface BuildingInstance {
  id: string
  defId: string
  /** Where it stands; footprint radius comes from the def's category. */
  pos: Vec2
  /** The glade whose ground it stands on, fixed at placement. */
  gladeId: string
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
   * Ids of deposits reachable from this building, cached at placement time
   * and refreshed when a glade is cleared or a deposit runs dry.
   */
  depositsInRange: Partial<Record<DepositId, string[]>>
  /** Warmth sources only: set while a Storm finds no wood to burn. */
  unlit?: boolean
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

/** A Queen's order with a deadline: richer reward, and a price for missing it. */
export interface DecreeDef extends OrderDef {
  /** Seconds allowed to meet the goal. */
  timeLimit: number
}

export interface RoyalDecree extends Order {
  /** Seconds remaining. */
  timeLeft: number
  timeLimit: number
  /** Goal count when the decree was issued (for counting goals). */
  baseline: number
}

export interface CornerstoneDef {
  id: string
  name: string
  icon: string
  rarity: 'common' | 'rare' | 'epic'
  description: string
  effects: CornerstoneEffect[]
  /**
   * Kept out of the draft pool until a Citadel upgrade unlocks it (see
   * `content/meta.ts`). Runs record what they unlocked in `RunState.citadel`.
   */
  citadelLocked?: boolean
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
  // --- rule-benders ----------------------------------------------------------
  /** Farms operate at this percent of normal speed during the Storm. */
  | { kind: 'farmsInStorm'; percent: number }
  /** Hostility gained from clearing a glade (percent; -100 = none at all). */
  | { kind: 'gladeHostility'; percent: number }
  /** Wood the hearth burns (percent; negative = less). */
  | { kind: 'hearthFuel'; percent: number }
  /** Passive growth of the Queen's impatience (percent; negative = slower). */
  | { kind: 'impatienceRate'; percent: number }
  /** How soon newcomers arrive (percent; negative = sooner). */
  | { kind: 'newcomerRate'; percent: number }
  /** Loot from clearing glades (percent; positive = more). */
  | { kind: 'gladeLoot'; percent: number }
  /** Caravan asking prices (percent; negative = cheaper). */
  | { kind: 'tradePrices'; percent: number }
  /** Flat resolve for all species, but only while the Storm rages. */
  | { kind: 'stormResolve'; amount: number }

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
  /** Villagers who join the settlement (stragglers, freed captives...). */
  villagerGain?: number
  /** Requires this much of each resource to be selectable. */
  requires?: ResourceBag
  /**
   * Units of food of any kind, paid from the largest stacks the way villagers
   * eat. Required to be selectable, like `requires`.
   */
  foodCost?: number
  /** Unleashes a timed threat that strikes until it is appeased. */
  threat?: ThreatSpec
  /** Grants a permanent run-long effect (a pact, a curse, a blessing). */
  ongoing?: OngoingEffectSpec
  /** Leaves a lingering condition that lifts only when its goal is met. */
  condition?: ConditionSpec
}

/**
 * A lingering glade condition: weighs on the settlement (or promises a
 * reward) until a build-loop goal is met, optionally against a deadline.
 * Declarative like threats — goals reuse the order vocabulary and effects the
 * cornerstone vocabulary, so the whole thing serialises inside `RunState`.
 */
export interface ConditionSpec {
  name: string
  icon: string
  description: string
  /**
   * Met when this goal reaches 100%. Counting goals (produced, built, glades
   * cleared) count only progress made after the condition began.
   */
  resolveBy: OrderGoal
  /** Stock goals only: the goods are handed over when the goal is met. */
  consume?: boolean
  /** Modifiers active while the condition lingers. */
  whileActive?: CornerstoneEffect[]
  /** Seconds to meet the goal; when it runs out `onFail` applies. */
  deadline?: number
  /** Paid out when the goal is met. */
  onResolve?: ConditionOutcome
  /** Applied if the deadline passes first. */
  onFail?: ConditionOutcome
}

export interface ConditionOutcome {
  reputation?: number
  hostility?: number
  impatience?: number
  villagerLoss?: number
  gain?: ResourceBag
}

export interface ActiveCondition extends ConditionSpec {
  id: string
  /** Glade whose event left it behind. */
  gladeId: string
  /** Goal count when the condition began (for counting goals). */
  baseline: number
  /** 0..1 toward lifting it. */
  progress: number
  /** Seconds left before `onFail`; absent for open-ended conditions. */
  timeLeft?: number
}

/**
 * A timed menace released from a glade. It strikes every `interval` seconds
 * until the settlement pays the `appease` cost — urgency the instant-resolve
 * events cannot create.
 */
export interface ThreatSpec {
  name: string
  icon: string
  description: string
  /** Seconds between strikes. */
  interval: number
  /** Paid (via the threats panel) to end it for good. */
  appease: ResourceBag
  strike: {
    hostility?: number
    impatience?: number
    villagerLoss?: number
    /** Stolen from the stockpile, capped at what is there. */
    stockLoss?: ResourceBag
  }
  /** Modifiers active while the threat lives (e.g. −resolve for everyone). */
  whileActive?: CornerstoneEffect[]
}

export interface ActiveThreat extends ThreatSpec {
  /** Instance id. */
  id: string
  /** Glade that unleashed it, for the log and the map. */
  gladeId: string
  /** Seconds until the next strike. */
  timer: number
}

/** A permanent run-long modifier granted by an event choice. */
export interface OngoingEffectSpec {
  name: string
  icon: string
  description: string
  effects: CornerstoneEffect[]
}

export interface OngoingEffect extends OngoingEffectSpec {
  id: string
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
// Trade
// ---------------------------------------------------------------------------

export interface CaravanOffer {
  resource: ResourceId
  amount: number
  /** Total amber asked for the whole lot. */
  price: number
  sold: boolean
}

/**
 * A caravan visits periodically (once a Trading Post exists), carrying a
 * rotating stock and paying double for one good it wants this trip.
 */
export interface CaravanState {
  here: boolean
  /** Seconds until arrival while away; seconds until departure while here. */
  timer: number
  offers: CaravanOffer[]
  /** The caravan pays double for this resource this visit. */
  wants: ResourceId
  visits: number
}

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

export type RunPhase = 'playing' | 'won' | 'lost'

export interface PendingChoice {
  kind: 'cornerstone' | 'blueprint' | 'gladeEvent' | 'charter'
  /** Cornerstone/building/charter ids offered, or `[eventId]` for glade events. */
  options: string[]
  /** For glade events: which glade triggered it. */
  gladeId?: string
  /** For charters: the blueprint the architect's warrant would grant. */
  blueprintId?: string
}

/**
 * The Queen's charter: a one-time, run-shaping pick granted mid-run. Each
 * offer draws one per family, so the choice is between kinds of help.
 */
export interface CharterDef {
  id: string
  name: string
  icon: string
  family: 'perk' | 'patience' | 'blueprint'
  description: string
  /** Run-long effects, recorded as an ongoing effect. */
  effects?: CornerstoneEffect[]
  /** Added to the Queen's patience ceiling. */
  maxImpatience?: number
  /** Impatience forgiven on the spot. */
  impatienceRelief?: number
  /** Unlocks the offer's `blueprintId` and delivers its building materials. */
  grantsBlueprint?: boolean
}

export interface LogEntry {
  id: number
  year: number
  season: Season
  text: string
  tone: 'info' | 'good' | 'bad'
}

// ---------------------------------------------------------------------------
// Run timeline (end-screen chart)
// ---------------------------------------------------------------------------

/**
 * One snapshot of the run, stored as a flat tuple so a long run stays a few KB
 * in the save. Column order is `TIMELINE_COLUMNS` in `engine/timeline.ts`:
 * clock, reputation, impatience (both including fractional progress),
 * hostility, population, average resolve, food, wood, then each species'
 * resolve in `RunTimeline.species` order.
 */
export type TimelineSample = number[]

export type TimelineEventKind =
  | 'storm' // the Blightstorm breaks
  | 'year' // a new year begins (the Storm has passed); detail = year
  | 'left' // a villager walked out in despair; detail = species
  | 'lost' // a villager taken by a threat, an event or a condition; detail = species
  | 'threat' // a threat unleashed; detail = its name
  | 'appeased' // a threat paid off; detail = its name
  | 'glade' // a glade cleared
  | 'cornerstone' // detail = cornerstone name
  | 'charter' // detail = charter name
  | 'decreeMet' // detail = decree name
  | 'decreeMissed' // detail = decree name

export interface TimelineEvent {
  /** Clock seconds. */
  t: number
  k: TimelineEventKind
  d?: string
}

export interface RunTimeline {
  /** Seconds between samples. */
  interval: number
  /** Clock at which the next sample is due. */
  next: number
  /** Species order of the per-species resolve columns. */
  species: SpeciesId[]
  /** Oldest first; older samples are thinned once the cap is reached. */
  samples: TimelineSample[]
  /** `[clock, maxReputation, maxImpatience]`, appended only when a goal moves. */
  limits: [number, number, number][]
  /** Oldest first, capped. */
  events: TimelineEvent[]
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

  world: WorldInfo
  glades: Record<string, Glade>
  deposits: Record<string, WorldDeposit>
  obstacles: Obstacle[]
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

  /** Timed menaces released from glades; they strike until appeased. */
  threats: ActiveThreat[]
  threatCounter: number
  /** Permanent run-long effects granted by event choices. */
  ongoing: OngoingEffect[]

  /** Lingering glade conditions, lifted by meeting their goal. */
  conditions: ActiveCondition[]
  conditionCounter: number
  /** The live timed decree, if the Queen has issued one. */
  decree: RoyalDecree | null
  /** Seconds until the next decree while none is live. */
  decreeTimer: number
  /** Whether the mid-run charter has been offered, and which was chosen. */
  charterOffered: boolean
  charter: string | null

  caravan: CaravanState

  /** Amber sinks scale with use, so these count uses. */
  rerollsUsed: number
  soothesUsed: number

  /** FIFO queue — a glade event and a reputation milestone can land together. */
  pendingChoices: PendingChoice[]

  /** Newest first, capped. */
  log: LogEntry[]
  logCounter: number

  /** Compact, bounded history of the run for the end-screen chart. */
  timeline: RunTimeline

  /** Species present on this map (drawn at run start). */
  speciesPool: SpeciesId[]
  /** Villagers waiting at the hearth to be welcomed (newcomers). */
  newcomerTimer: number

  /** Buildings unlocked for this run (blueprint draws). */
  unlockedBuildings: string[]

  /** Lifetime production totals, used by "produce N of X" orders. */
  producedTotals: ResourceBag

  /** Queen's Edict difficulty level this run was founded under (0 = none). */
  edict: number
  /** Citadel upgrades that keep acting during the run (drafts, events). */
  citadel: CitadelPerks

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

/**
 * The in-run part of the Citadel's upgrades: what keeps shaping drafts and
 * events after `createRun` has applied the one-off starting bonuses.
 */
export interface CitadelPerks {
  /** Extra options in every blueprint draft. */
  blueprintOptions: number
  /** Extra options in every cornerstone draft. */
  cornerstoneOptions: number
  /** Draft rerolls left this run that cost no amber. */
  freeRerolls: number
  /** Citadel-locked cornerstones admitted to this run's draft pool. */
  cornerstones: string[]
  /** Extra glade-event options (ids in `CITADEL_EVENT_OPTIONS`). */
  eventOptions: string[]
}

export interface MetaHistoryEntry {
  seed: number
  won: boolean
  years: number
  reputation: number
  /** Epoch ms the run was banked. */
  at: number
  /** Species drawn for the run (absent on pre-v2 entries). */
  species?: SpeciesId[]
  /** Queen's Edict level (absent on pre-v2 entries, meaning 0). */
  edict?: number
  /** Supplies the run paid out (absent on pre-v2 entries). */
  supplies?: number
}

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
  /** Highest Queen's Edict that may be chosen; winning at it unlocks the next. */
  edictUnlocked: number
  /** Newest first, capped. */
  history: MetaHistoryEntry[]
}
