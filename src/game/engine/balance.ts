import type { Season } from '../types'

/**
 * Every tunable number in one place. A ~25-35 minute run is the target:
 * roughly 4-6 in-game years at 1× speed.
 */

/**
 * Fixed simulation step. Small enough that progress bars animate smoothly
 * (8 steps/s at 1× speed) and large enough to keep per-frame work trivial.
 */
export const TICK_SECONDS = 0.125

export const SEASON_LENGTH: Record<Season, number> = {
  drizzle: 150,
  clearance: 140,
  storm: 110,
}

export const SEASON_ORDER: Season[] = ['drizzle', 'clearance', 'storm']

export const SEASON_INFO: Record<Season, { name: string; icon: string; blurb: string }> = {
  drizzle: {
    name: 'Drizzle',
    icon: '🌦️',
    blurb: 'Mild rain. Everything works; make hay while it lasts.',
  },
  clearance: {
    name: 'Clearance',
    icon: '⛅',
    blurb: 'The sky lifts. Farms yield more and hostility creeps slower.',
  },
  storm: {
    name: 'Storm',
    icon: '⛈️',
    blurb:
      'The Blightstorm. Farms fail, gathering slows, and the hearth must be kept burning.',
  },
}

// ---------------------------------------------------------------------------
// Win / loss
// ---------------------------------------------------------------------------

export const MAX_REPUTATION = 20
export const MAX_IMPATIENCE = 18

/**
 * Reputation milestones that award a cornerstone or blueprint pick, alternating
 * between the two. Every second point, so the settlement keeps unlocking the
 * buildings it needs rather than stalling behind a reputation wall.
 */
export const REWARD_MILESTONES = [2, 4, 6, 8, 10, 12, 14, 16, 18]

/** Blueprint picks offered before the first tick, as an opening draft. */
export const OPENING_BLUEPRINT_PICKS = 3

// ---------------------------------------------------------------------------
// Population & food
// ---------------------------------------------------------------------------

export const STARTING_VILLAGERS = 6
export const STARTING_STOCK = {
  wood: 40,
  stone: 20,
  plank: 10,
  berry: 25,
  root: 15,
  amber: 30,
} as const

/** Seconds one villager takes to eat one unit of raw food. */
export const SECONDS_PER_MEAL = 50
/** Cooked food covers twice as many meals. */
export const COMPLEX_FOOD_MULTIPLIER = 2

/** A newcomer arrives on this cadence while there is spare housing. */
export const NEWCOMER_INTERVAL = 55
/**
 * Word spreads more slowly the bigger the settlement gets, so arrivals plateau
 * instead of running away. Without this, population outgrows any service
 * network you can build — service capacity is measured against population, so
 * unbounded growth is an unwinnable treadmill.
 */
export const NEWCOMER_SOFT_CAP = 8
export const NEWCOMER_SLOWDOWN_PER_VILLAGER = 0.1

/** Seconds between arrivals at the current population. */
export function newcomerInterval(population: number): number {
  const excess = Math.max(0, population - NEWCOMER_SOFT_CAP)
  return NEWCOMER_INTERVAL * (1 + excess * NEWCOMER_SLOWDOWN_PER_VILLAGER)
}
/** Newcomers stop arriving during the Storm. */
export const NEWCOMER_SEASONS: Season[] = ['drizzle', 'clearance']

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

/** Resolve granted per satisfied service need. */
export const RESOLVE_PER_NEED = 9
/** Resolve for having a roof for everyone. */
export const RESOLVE_HOUSED = 5
/** Extra resolve when most villagers live in cabins rather than shelters. */
export const RESOLVE_COMFORT = 3
/** Resolve per distinct food type in the stockpile, up to a cap. */
export const RESOLVE_PER_FOOD_VARIETY = 1.2
export const FOOD_VARIETY_CAP = 6
/**
 * Resolve lost per point of hostility. Hostility is meant to be a tightening
 * squeeze, not an unpayable tax — at the practical late-run ceiling (~70) this
 * costs 7 resolve, which good service coverage can outrun.
 */
export const RESOLVE_PER_HOSTILITY = 0.075
/** Resolve penalty while the settlement is starving. */
export const RESOLVE_STARVING = -18
/** Resolve penalty while villagers are unhoused (scaled by how many). */
export const RESOLVE_UNHOUSED = -14
/** Resolve penalty when the hearth goes cold during the Storm. */
export const RESOLVE_COLD_HEARTH = -12

/** Resolve moves toward its target at this many points per second. */
export const RESOLVE_DRIFT = 0.55

/** Below this resolve, villagers start packing up. */
export const RESOLVE_LEAVE_THRESHOLD = -5
/** Seconds of sustained despair before one villager leaves. */
export const SECONDS_TO_LEAVE = 22

// ---------------------------------------------------------------------------
// Reputation & impatience
// ---------------------------------------------------------------------------

/**
 * Reputation per second per point of resolve above a species' target. Tuned
 * against the balance harness: a well-run settlement sitting ~10 above its
 * thresholds earns roughly a reputation point per minute.
 */
export const REPUTATION_PER_RESOLVE_POINT = 0.002
/** Impatience gained for each villager that leaves or dies. */
export const IMPATIENCE_PER_VILLAGER_LOST = 0.6
/** Baseline impatience per second (grows each year). */
export const IMPATIENCE_BASE = 0.0022
export const IMPATIENCE_YEAR_SCALING = 0.25
/**
 * Extra impatience per second once hostility passes the threshold. This is what
 * guarantees a verdict: a settlement that lets the forest max out will lose,
 * however long it survives, so a run can never stagnate indefinitely.
 */
export const IMPATIENCE_HOSTILITY_THRESHOLD = 70
export const IMPATIENCE_PER_HOSTILITY_OVER = 0.0007

// ---------------------------------------------------------------------------
// Hostility
// ---------------------------------------------------------------------------

export const HOSTILITY_PER_SECOND = 0.007
export const HOSTILITY_YEAR_SCALING = 0.06
export const HOSTILITY_PER_POPULATION = 0.007
export const HOSTILITY_PER_GLADE_CLEARED = 2.5
/** Every Nth glade reclaimed earns a point of reputation. */
export const GLADES_PER_REPUTATION = 4
export const HOSTILITY_PER_STORM = 4
/** Clearance is calmer. */
export const HOSTILITY_SEASON_MULTIPLIER: Record<Season, number> = {
  drizzle: 1,
  clearance: 0.65,
  storm: 1.4,
}

// ---------------------------------------------------------------------------
// Seasonal production effects
// ---------------------------------------------------------------------------

/** Multiplier applied to farms by season. */
export const FARM_SEASON_MULTIPLIER: Record<Season, number> = {
  drizzle: 1,
  clearance: 1.35,
  storm: 0,
}
/** Multiplier applied to gathering camps by season. */
export const GATHER_SEASON_MULTIPLIER: Record<Season, number> = {
  drizzle: 1,
  clearance: 1.1,
  storm: 0.5,
}

// ---------------------------------------------------------------------------
// Hearth
// ---------------------------------------------------------------------------

/** Wood burned per second during the Storm. */
export const HEARTH_FUEL_PER_SECOND = 0.16
/** Wood burned per second outside the Storm. */
export const HEARTH_IDLE_FUEL_PER_SECOND = 0.04

/**
 * Housing within this many world units of the hearth counts as warm. During
 * the Storm, villagers bunked beyond it take a resolve penalty — the map's way
 * of making sprawl a decision rather than free real estate.
 */
export const HEARTH_WARMTH_RADIUS = 5
/** Resolve penalty (scaled by the exposed share) for cold homes in the Storm. */
export const RESOLVE_COLD_HOME = -8

// ---------------------------------------------------------------------------
// Placement (continuous world space)
// ---------------------------------------------------------------------------

/** Circular footprint radius per building category, in world units. */
export const FOOTPRINT_RADIUS = {
  hearth: 1.0,
  housing: 0.55,
  gathering: 0.6,
  production: 0.7,
  service: 0.7,
  logistics: 0.75,
} as const

/** Minimum clearance between two building footprints. */
export const BUILDING_GAP = 0.1

/** Centre distance within which an adjacency bonus counts as "next to". */
export const ADJACENCY_RANGE = 2.4

// ---------------------------------------------------------------------------
// Caravans & amber sinks
// ---------------------------------------------------------------------------

/** Seconds after the Trading Post finishes before the first caravan. */
export const CARAVAN_FIRST_ARRIVAL = 70
/** Seconds between caravan visits. */
export const CARAVAN_INTERVAL = 170
/** Seconds a caravan stays. */
export const CARAVAN_STAY = 100
/** Distinct goods a caravan offers per visit. */
export const CARAVAN_OFFERS = 4
/** Markup over base value on caravan lots (before cornerstones). */
export const CARAVAN_MARKUP = 1.45
/** Multiplier the caravan pays for the good it wants this visit. */
export const CARAVAN_WANT_BONUS = 2
/** Units sold per click at the trading post. */
export const TRADE_LOT = 5

/** Rerolling a draft: base cost, plus growth per reroll already used. */
export const REROLL_BASE_COST = 15
export const REROLL_COST_GROWTH = 10
/** Soothing the Queen: −1 impatience, at a steepening price. */
export const SOOTHE_BASE_COST = 40
export const SOOTHE_COST_GROWTH = 15
/** Rush construction: amber per work-second remaining (min 5). */
export const RUSH_COST_PER_SECOND = 0.5

// ---------------------------------------------------------------------------
// Villager traits
// ---------------------------------------------------------------------------

/** Chance a newcomer arrives with a personal quirk. */
export const VILLAGER_TRAIT_CHANCE = 0.6

// ---------------------------------------------------------------------------
// Work rates
// ---------------------------------------------------------------------------

/** Work-seconds contributed per worker per real second. */
export const WORKER_RATE = 1
/** Builders are drawn from idle villagers; this is their rate. */
export const BUILD_RATE_PER_VILLAGER = 1.1
/** Glade clearing rate per assigned villager. */
export const CLEAR_RATE_PER_VILLAGER = 1

export const SPEED_OPTIONS = [0, 1, 2, 3] as const
export type GameSpeed = (typeof SPEED_OPTIONS)[number]

/** Base stockpile capacity before any warehouses. */
export const BASE_STORAGE = 40

// ---------------------------------------------------------------------------
// Mid-run structure: royal decrees, the Queen's charter, lingering conditions
// (new features — kept apart from the core pacing numbers above)
// ---------------------------------------------------------------------------

/** Seconds into the run before the Queen issues her first timed decree. */
export const DECREE_FIRST_DELAY = 240
/** Seconds between one decree ending (met or missed) and the next. */
export const DECREE_INTERVAL = 200
/** Impatience when a decree's deadline passes unmet. */
export const DECREE_MISS_IMPATIENCE = 1.5
/**
 * Decrees are only drawn from goals the settlement has not already mostly
 * met, so a deadline is a real push rather than a free payout.
 */
export const DECREE_MAX_START_PROGRESS = 0.6

/** Reputation at which the Queen grants her one-time charter. */
export const CHARTER_REPUTATION = 10
