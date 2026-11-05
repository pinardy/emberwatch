import type { RunModifierDef } from '../types'

/**
 * Run modifiers — the land's own character, drawn from the seed before the map
 * is generated (our "forest mysteries").
 * Every run draws one or two, so the same species and the same Citadel still
 * meet a different problem each time.
 *
 * Each is declarative data and does one or both of:
 *  - `mapgen` — hooks read by `engine/mapgen.ts` (theme weights, deposit
 *    counts, glade-kind odds, glade loot);
 *  - `effects` — run-long effects in the cornerstone vocabulary, recorded in
 *    `RunState.ongoing` like a pact so the sim folds them every tick.
 *
 * Design invariants (covered by tests):
 *  - most modifiers are trade-offs: a bane with a silver lining, or a boon
 *    with a catch — only a few are pure boons or banes;
 *  - none may make a run unwinnable or trivial for the balance bot (each is
 *    forced on in turn by the harness);
 *  - `excludes` is symmetric, so two harsh twists never stack.
 */
const defs: RunModifierDef[] = [
  {
    id: 'richVeins',
    name: 'Rich Veins',
    icon: '⛏️',
    tone: 'boon',
    description: 'Stone and copper lie close to the surface: half again as many stone veins, twice the copper seams.',
    mapgen: {
      depositScale: { stoneVein: 1.5, orePatch: 2 },
      themeWeights: { rock: 1.5 },
    },
  },
  {
    id: 'fertileFloodplain',
    name: 'Fertile Floodplain',
    icon: '🌾',
    tone: 'mixed',
    description: 'The river has spread its silt far and wide — more fertile soil, but far more marsh, where foundations sink.',
    mapgen: {
      themeWeights: { fertile: 2.5, marsh: 3 },
      depositScale: { fertileSoil: 1.5 },
    },
  },
  {
    id: 'restlessForest',
    name: 'Restless Forest',
    icon: '🌲',
    tone: 'mixed',
    description: 'The trees do not sleep here. Hostility rises 20% faster, but glades give up 30% more loot.',
    effects: [
      { kind: 'hostilityRate', percent: 20 },
      { kind: 'gladeLoot', percent: 30 },
    ],
    excludes: ['ancientRuins', 'wildFrontier'],
  },
  {
    id: 'longStorms',
    name: 'Long Storms',
    icon: '🌀',
    tone: 'mixed',
    description: 'The Blightstorm lingers 25% longer each year, but the Clearance after it is bountiful: every workplace works 20% faster in it.',
    effects: [
      { kind: 'seasonLength', season: 'storm', percent: 25 },
      { kind: 'seasonProduction', season: 'clearance', percent: 20 },
    ],
    excludes: ['earlyFrost'],
  },
  {
    id: 'wanderingTraders',
    name: 'Wandering Traders',
    icon: '🐫',
    tone: 'mixed',
    description: 'Caravans find you without a Trading Post, but they wander: visits come 40% less often.',
    effects: [
      { kind: 'caravanWithoutPost' },
      { kind: 'caravanInterval', percent: 40 },
    ],
  },
  {
    id: 'sparseGame',
    name: 'Sparse Game',
    icon: '🦌',
    tone: 'mixed',
    description: 'The herds have moved on — half the game trails are gone. The forest is quieter for it: hostility rises 10% slower.',
    mapgen: { depositScale: { game: 0.5 } },
    effects: [{ kind: 'hostilityRate', percent: -10 }],
  },
  {
    id: 'ancientRuins',
    name: 'Ancient Ruins',
    icon: '🏛️',
    tone: 'mixed',
    description: 'Old stonework under every root. Fewer safe glades, but dangerous and forbidden glades hold 50% more loot.',
    mapgen: {
      smallGladeOdds: 0.5,
      rewardScale: { dangerous: 1.5, forbidden: 1.5 },
    },
    excludes: ['restlessForest'],
  },
  {
    id: 'earlyFrost',
    name: 'Early Frost',
    icon: '❄️',
    tone: 'mixed',
    description: 'The first Storm comes a third sooner. The Queen sent extra firewood with the founding party, and a woodshed (+20 storage) to keep it dry.',
    effects: [
      { kind: 'seasonLength', season: 'drizzle', percent: -33, firstYearOnly: true },
      { kind: 'seasonLength', season: 'clearance', percent: -33, firstYearOnly: true },
      { kind: 'globalStorage', amount: 20 },
    ],
    startStock: { wood: 10 },
    excludes: ['longStorms'],
  },
  {
    id: 'bountifulGroves',
    name: 'Bountiful Groves',
    icon: '🫐',
    tone: 'boon',
    description: 'Berry bushes and undergrowth everywhere — half again as many forage patches, and every workplace hums 10% faster through the Drizzle.',
    mapgen: { depositScale: { vegetation: 1.5 } },
    effects: [{ kind: 'seasonProduction', season: 'drizzle', percent: 10 }],
  },
  {
    id: 'illOmens',
    name: 'Ill Omens',
    icon: '🦉',
    tone: 'mixed',
    description: 'A white owl at the founding. The Queen starts 2 impatience in, but every order you complete pays +1 reputation.',
    startImpatience: 2,
    effects: [{ kind: 'orderReputation', amount: 1 }],
  },
  {
    id: 'crowdedRoads',
    name: 'Crowded Roads',
    icon: '🛤️',
    tone: 'mixed',
    description: 'Refugees on every road: newcomers arrive 25% sooner, and everyone eats 10% more.',
    effects: [
      { kind: 'newcomerRate', percent: -25 },
      { kind: 'foodUpkeep', percent: 10 },
    ],
  },
  {
    id: 'petrifiedWoods',
    name: 'Petrified Woods',
    icon: '🪵',
    tone: 'mixed',
    description: 'A quarter of the outlying timber has turned to stone, but what remains is dense and burns slowly: the hearth and braziers use 20% less wood.',
    mapgen: { depositScale: { trees: 0.75 } },
    effects: [
      { kind: 'hearthFuel', percent: -20 },
    ],
  },
]

/**
 * Lands the open pool never draws: a Citadel upgrade has to admit them
 * (`MetaUpgradeEffects.unlockModifiers`). They follow the same invariants as
 * the open pool and are forced on in turn by the balance harness too. Kept out
 * of `RUN_MODIFIER_LIST` so a run with no such upgrade draws exactly as before.
 */
const citadelDefs: RunModifierDef[] = [
  {
    id: 'amberSprings',
    name: 'Amber Springs',
    icon: '💧',
    tone: 'mixed',
    citadelLocked: true,
    description: 'Resin seeps from every spring: glades give up 25% more loot and caravans ask 15% less, but the damp makes the hearth burn 15% more wood.',
    effects: [
      { kind: 'gladeLoot', percent: 25 },
      { kind: 'tradePrices', percent: -15 },
      { kind: 'hearthFuel', percent: 15 },
    ],
  },
  {
    id: 'pilgrimRoad',
    name: 'Pilgrim Road',
    icon: '🕯️',
    tone: 'mixed',
    citadelLocked: true,
    description: 'A pilgrim road runs past the hearth: newcomers arrive 15% sooner and the Queen allows 20% longer for her decrees, but the forest grows restless 10% faster.',
    effects: [
      { kind: 'newcomerRate', percent: -15 },
      { kind: 'decreeTime', percent: 20 },
      { kind: 'hostilityRate', percent: 10 },
    ],
  },
  {
    id: 'wildFrontier',
    name: 'Wild Frontier',
    icon: '🐺',
    tone: 'mixed',
    citadelLocked: true,
    description: 'Untamed country past the last road: glades clear 15% slower and anger the forest 15% more, but they hold 35% more loot and every decree met pays +1 reputation.',
    effects: [
      { kind: 'clearSpeed', percent: -15 },
      { kind: 'gladeHostility', percent: 15 },
      { kind: 'gladeLoot', percent: 35 },
      { kind: 'decreeReputation', amount: 1 },
    ],
    excludes: ['restlessForest'],
  },
]

/** Every modifier, open or Citadel-locked, by id. */
export const RUN_MODIFIERS: Record<string, RunModifierDef> = Object.fromEntries(
  [...defs, ...citadelDefs].map((d) => [d.id, d]),
)

/** The open pool every run draws from. */
export const RUN_MODIFIER_LIST = defs

/** Modifiers only a Citadel upgrade admits to the pool. */
export const CITADEL_RUN_MODIFIER_LIST = citadelDefs

/** Both lists, open pool first. */
export const ALL_RUN_MODIFIER_LIST = [...defs, ...citadelDefs]

/** Fewest and most modifiers a run draws. */
export const MIN_RUN_MODIFIERS = 1
export const MAX_RUN_MODIFIERS = 2
/** Chance a run draws its second modifier. */
export const SECOND_MODIFIER_CHANCE = 0.5
