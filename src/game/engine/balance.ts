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

/** Seconds in one in-game year. */
export const YEAR_SECONDS = SEASON_ORDER.reduce((sum, season) => sum + SEASON_LENGTH[season], 0)

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
export const RESOLVE_PER_HOSTILITY = 0.1
/**
 * Resolve penalty while the settlement is starving, at full hunger. Hunger
 * ramps in: the first missed meal costs `STARVING_MIN_SEVERITY` of this, and the
 * full penalty lands once the unpaid food debt reaches one meal per villager
 * (about `SECONDS_PER_MEAL`). That is the window a player gets to react to an
 * empty larder before resolve collapses.
 */
export const RESOLVE_STARVING = -18
export const STARVING_MIN_SEVERITY = 0.35
/** Resolve penalty while villagers are unhoused (scaled by how many). */
export const RESOLVE_UNHOUSED = -14
/** Resolve penalty when the hearth goes cold during the Storm. */
export const RESOLVE_COLD_HEARTH = -12

/** Resolve moves toward its target at this many points per second. */
export const RESOLVE_DRIFT = 0.55

/** Below this resolve, villagers start packing up. */
export const RESOLVE_LEAVE_THRESHOLD = -5
/**
 * Seconds of sustained despair before one villager leaves. Long enough that a
 * player who sees the warning can still fix the cause — at 22s, three species
 * leaving in parallel emptied a settlement of 13 inside two minutes.
 */
export const SECONDS_TO_LEAVE = 70
/**
 * After a villager leaves, their species' despair restarts this many seconds
 * *below* zero: the departure is a shock, and the rest wait to see whether
 * things improve before following.
 */
export const DEPARTURE_GRACE = 30

// ---------------------------------------------------------------------------
// Reputation & impatience
// ---------------------------------------------------------------------------

/**
 * Reputation per second per point of resolve above a species' target. Tuned
 * against the balance harness: a settlement sitting ~10 above its thresholds
 * with every need served earns roughly a reputation point every 100 seconds —
 * about a third of a winning run's reputation, the rest coming from orders,
 * glade events and reclaimed land.
 */
export const REPUTATION_PER_RESOLVE_POINT = 0.001
/**
 * Share of resolve-driven reputation a species earns with *none* of its needs
 * met; the rest scales with how well its services cover it. Contentment from
 * housing and a varied larder keeps villagers from leaving, but the Queen
 * judges you on what you built for them — a settlement that idles above its
 * thresholds without services should not be able to win on resolve alone.
 */
export const REPUTATION_UNSERVED_SHARE = 0.2
/** Impatience gained for each villager that leaves or dies. */
export const IMPATIENCE_PER_VILLAGER_LOST = 0.6
/** Baseline impatience per second (grows each year). */
export const IMPATIENCE_BASE = 0.0022
export const IMPATIENCE_YEAR_SCALING = 0.18
/**
 * Extra impatience per second once hostility passes the threshold: a
 * settlement that lets the forest close in loses the Queen's confidence fast.
 */
export const IMPATIENCE_HOSTILITY_THRESHOLD = 65
export const IMPATIENCE_PER_HOSTILITY_OVER = 0.0012
/**
 * The Queen's deadline. From the start of this year her impatience climbs on
 * top of everything else, and keeps steepening, so every run reaches a
 * verdict: from an empty impatience bar the overtime alone fills it in about
 * 11 minutes (the deadline lands at ~27 minutes of game time, so every run
 * ends by ~38). Cornerstones that calm the Queen do not slow the deadline.
 */
export const QUEEN_DEADLINE_YEAR = 5
/** Overtime impatience per second at the deadline… */
export const IMPATIENCE_OVERTIME_BASE = 0.008
/** …plus this much more per second for every second past it. */
export const IMPATIENCE_OVERTIME_RAMP = 0.00006

// ---------------------------------------------------------------------------
// Hostility
// ---------------------------------------------------------------------------

export const HOSTILITY_PER_SECOND = 0.007
export const HOSTILITY_YEAR_SCALING = 0.06
export const HOSTILITY_PER_POPULATION = 0.007
export const HOSTILITY_PER_GLADE_CLEARED = 2.5
/** Every Nth glade reclaimed earns a point of reputation. */
export const GLADES_PER_REPUTATION = 5
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
/**
 * Share of a building's cost handed back when it comes down. A site nobody has
 * worked on yet returns everything, so a misplaced building costs nothing; the
 * share slides down to this while it goes up, and a finished building keeps it.
 */
export const DEMOLISH_REFUND_BUILT = 0.5

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

/**
 * Pause plus five speeds, one hotkey each (1–5). 5× tops out the ladder rather
 * than 6×: it keeps every speed on its own digit, a Storm still lasts long
 * enough at 5× to react to, and a tick costs well under a millisecond, so even
 * 40 ticks a second leave a frame nearly all of its time for rendering.
 */
export const SPEED_OPTIONS = [0, 1, 2, 3, 4, 5] as const
export type GameSpeed = (typeof SPEED_OPTIONS)[number]

/** Base stockpile capacity before any warehouses. */
export const BASE_STORAGE = 40

// ===========================================================================
// Placement depth (new section — braziers, terrain, neighbourhoods)
//
// Added alongside the existing tuning rather than changing it. Terrain
// percentages live with their terrain in `content/terrain.ts` and adjacency
// percentages with their buildings in `content/buildings.ts`, the same way
// recipes carry their own seconds.
// ===========================================================================

/**
 * A brazier keeps housing within this many world units warm during the Storm.
 * Smaller than the hearth's reach, so it extends a neighbourhood rather than
 * replacing the hearth.
 */
export const BRAZIER_WARMTH_RADIUS = 3
/** Wood a lit brazier burns per second, only while the Storm rages. */
export const BRAZIER_FUEL_PER_SECOND = 0.035
/** A brazier is a fire bowl, not a building: it squeezes between homes. */
export const BRAZIER_FOOTPRINT = 0.4

// ---------------------------------------------------------------------------
// Mid-run structure: royal decrees, the Queen's charter, lingering conditions
// (new features — kept apart from the core pacing numbers above)
// ---------------------------------------------------------------------------

/**
 * Seconds into the run before the Queen issues her first timed decree: one
 * full year, so it lands as Year 2 opens. Earlier, it arrived on the eve of
 * the first Storm and asked a settlement still learning to feed itself for a
 * levy it had no camp to produce. The decree timer and the season clock
 * advance on the same tick, so this is the start of Year 2 exactly.
 */
export const DECREE_FIRST_DELAY = YEAR_SECONDS
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
