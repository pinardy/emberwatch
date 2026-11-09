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
 * buildings it needs rather than stalling behind a reputation wall — and on
 * the odd points, so the first reward lands with the first reputation point
 * instead of the second.
 */
export const REWARD_MILESTONES = [1, 3, 5, 7, 9, 11, 13, 15, 17]

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
 * squeeze, not an unpayable tax: in the first year it costs a couple of
 * points, as it always has.
 */
export const RESOLVE_PER_HOSTILITY = 0.1
/**
 * Past this much hostility the forest has closed in, and every further point
 * costs `RESOLVE_PER_HOSTILITY_LATE` more on top. A settlement crosses it once
 * it starts clearing glades in earnest: a newcomer following the first-steps
 * checklist meets its first Storm at hostility ~10-15 and feels nothing, an
 * expanding one at ~25 loses two points, and the squeeze tightens from there:
 * at hostility 50 resolve drops ~13 instead of 5, at 70 ~19. That is
 * more than one served need is worth, so a species with half its needs met
 * sinks to within a few points of its threshold and earns little reputation,
 * while one with both served still clears it — the late game rewards serving
 * people, not idling.
 *
 * Tuned against the balance harness: with the old flat 0.1 the competent bot
 * won 92% of the fixed seeds (96% once its labour bug was fixed), against a
 * 95% ceiling; this brings it to ~80% on fixed and fresh seeds alike. The late
 * rate went from 0.2 to 0.22 when lizards gained their Brawling floor, to
 * keep the four-trio harness inside its band.
 */
export const HOSTILITY_SQUEEZE_THRESHOLD = 15
export const RESOLVE_PER_HOSTILITY_LATE = 0.22

/** Resolve every species loses to the forest at `hostility`. */
export function hostilityResolvePenalty(hostility: number): number {
  const over = Math.max(0, hostility - HOSTILITY_SQUEEZE_THRESHOLD)
  return hostility * RESOLVE_PER_HOSTILITY + over * RESOLVE_PER_HOSTILITY_LATE
}
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
 * Only built services count toward the rest (a species' own floor, like the
 * harpies' teaching, raises resolve but not reputation). Halved from 0.2 when
 * the opening cornerstone and the hearth's offerings lifted resolve across
 * the board, to keep the economy-only control under its cap.
 */
export const REPUTATION_UNSERVED_SHARE = 0.1
/** Impatience gained for each villager that leaves or dies. */
export const IMPATIENCE_PER_VILLAGER_LOST = 0.6
/**
 * Baseline impatience per second (grows each year). Lowered from 0.0022 when
 * the Queen began reacting to reputation standing still
 * (`IMPATIENCE_STAGNATION_*`): less of her patience runs on the calendar,
 * more on what the settlement is doing.
 */
export const IMPATIENCE_BASE = 0.0016
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
/**
 * Resolve penalty (scaled by the exposed share) for cold homes in the Storm.
 * Was −8; cold homes now also cost lives (`FROST_EXPOSURE_PER_LOSS`) and the
 * hearth's reach shrinks through the Storm (`HEARTH_STORM_REACH_FLOOR`).
 */
export const RESOLVE_COLD_HOME = -12

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
/** Impatience when a decree's deadline passes unmet, with no strikes standing. */
export const DECREE_MISS_IMPATIENCE = 1.5
/**
 * Extra impatience on a missed decree for every earlier miss still standing.
 * The Queen forgives one lapse; she does not forgive a habit. Meeting a decree
 * clears one strike, so a settlement that recovers is not punished forever.
 * It is aimed at long runs that let every decree lapse.
 */
export const DECREE_MISS_ESCALATION = 1
/**
 * Decrees are only drawn from goals the settlement has not already mostly
 * met, so a deadline is a real push rather than a free payout.
 */
export const DECREE_MAX_START_PROGRESS = 0.6
/**
 * A production decree asks for this share of what the settlement's staffed
 * producers would turn out over its time limit at their current rate — keep
 * them staffed and fed for the whole countdown, or add a hand. Only goods
 * with a staffed producer are decreed at all.
 */
export const DECREE_RATE_SHARE = 1.25
/** A sized decree never asks for less than this share of its listed amount… */
export const DECREE_MIN_SHARE = 0.3
/** …or more than this multiple of it. */
export const DECREE_MAX_SHARE = 2
/** Impatience for turning down both decrees the Queen offers. */
export const DECREE_DECLINE_IMPATIENCE = 0.5
/**
 * Amber for each decree met on a streak of two or more, per decree of the
 * streak beyond the first (15, 30, 45…), up to the cap. A point of
 * reputation every third decree was tried and let the economy-only control
 * bot win a quarter of its runs on decrees alone.
 */
export const DECREE_STREAK_AMBER = 15
export const DECREE_STREAK_AMBER_CAP = 60

/** Ordinary order slots; each is refilled by a choice of two. */
export const ORDER_SLOTS = 3
/**
 * Orders, like decrees, are drawn only from goals not already mostly met, so
 * none completes the instant it is chosen.
 */
export const ORDER_MAX_START_PROGRESS = 0.6
/** Resolve goals sit closer to their mark by nature, so they get more room. */
export const ORDER_MAX_START_RESOLVE = 0.85
/**
 * How far past the settlement's current state an order may reach: a
 * population, housing, glade or building goal further off than this is left
 * for later rather than clogging a slot for the whole run.
 */
export const ORDER_REACH = {
  population: 12,
  housing: 20,
  glades: 4,
  buildings: 3,
  /** Resolve points below the goal the average may sit. */
  resolve: 12,
} as const
/**
 * A counting order ("produce N more") asks for what the settlement makes in
 * this many seconds at its current rate, rounded to fives, and never less
 * than the minimum.
 */
export const ORDER_COUNT_SECONDS = 390
export const ORDER_COUNT_MIN = 15
/** Impatience for asking the Queen for a different pair of orders (once a year). */
export const ORDER_DECLINE_IMPATIENCE = 0.5
/**
 * An order for a species' refined need is drawn only once the finer good
 * already reaches this share of the settlement (within reach, like resolve
 * orders)…
 */
export const REFINED_ORDER_MIN_RATIO = 0.25
/** …and counts its seconds while the finer good reaches at least this share. */
export const REFINED_ORDER_HOLD_RATIO = 0.5
/** …or once a workshop standing now makes the finer good and this much of it is in stock. */
export const REFINED_ORDER_MIN_STOCK = 5

/** Reputation at which the Queen grants her one-time charter. */
export const CHARTER_REPUTATION = 10

// ---------------------------------------------------------------------------
// Roads (new feature — kept apart from the core pacing numbers above)
// ---------------------------------------------------------------------------

/** Wood per world unit (pace) of road, rounded per stretch (at least 1). */
export const ROAD_WOOD_PER_UNIT = 1
/** Longest single stretch; longer roads need a bend (another click). */
export const ROAD_MAX_LENGTH = 10
/** Shortest stretch worth laying. */
export const ROAD_MIN_LENGTH = 0.4
/** Half the road's width: obstacles and deposits must clear it. */
export const ROAD_HALF_WIDTH = 0.15
/**
 * A road "reaches" a building when it passes within this distance of the
 * building's footprint (measured from the edge, so a road that runs to the
 * door counts).
 */
export const ROAD_REACH = 0.4
/** The road tool snaps clicks to road ends and buildings within this range. */
export const ROAD_SNAP = 0.5
/**
 * Work-speed bonus, in percent, for a workplace joined by road to the hearth
 * or a warehouse — the full amount for a road as direct as the crow flies,
 * scaled by straight-line ÷ road distance for a winding one. Purely additive:
 * a settlement without roads works exactly as before.
 */
export const ROAD_WORK_BONUS = 15

// ---------------------------------------------------------------------------
// Mid-run pressure: a Queen who notices stalling, a forest that strikes back
// in the Storm, threats that grow bolder, and a full stockpile that never
// starves the settlement (new section — kept apart from the pacing above)
// ---------------------------------------------------------------------------

/**
 * Extra impatience per second while the settlement is not earning: scaled by
 * the share of villagers whose species sits below its reputation threshold
 * (all of them below = the full rate; all above = nothing). It starts with
 * Year 2 — nobody clears a threshold before the first services stand — so
 * the opening is unchanged, and an idling settlement mid-run gains about a
 * point every two minutes on top of the base rate (tuned with the harness).
 */
export const IMPATIENCE_STALL_RATE = 0.008
/** The year the Queen starts to notice a settlement that is not earning. */
export const IMPATIENCE_STALL_FROM_YEAR = 2

/** Below this hostility the forest sends no blight with the Storm. */
export const STORM_BLIGHT_MIN_HOSTILITY = 12
/** The first year whose Storm can carry a blight (the first Storm never does). */
export const STORM_BLIGHT_FROM_YEAR = 2
/** Each year after the second, turning a blight aside takes this share more. */
export const BLIGHT_PREP_GROWTH = 0.5

/**
 * Each strike of an ignored threat raises its next strike's damage by this
 * share (compounding) and its appeasement price by `THREAT_APPEASE_GROWTH`.
 */
export const THREAT_STRIKE_GROWTH = 0.25
export const THREAT_APPEASE_GROWTH = 0.2
/** From this many strikes on, an ignored threat also takes a villager each time. */
export const THREAT_STRIKES_BEFORE_LOSS = 3

/**
 * Food keeps coming in past the stockpile limit by this share of it (at least
 * `LARDER_HEADROOM_MIN`): a store full of wood must never stop the foragers
 * and starve the settlement while it saves for a warehouse.
 */
export const LARDER_HEADROOM_SHARE = 0.25
export const LARDER_HEADROOM_MIN = 20

/**
 * Blueprint drafts in a row that may pass without offering a piece of a
 * wanted service chain; the next one guarantees one. Two since a draft can be
 * steered for amber (a redraw toward a named service, or the architect's
 * plans at the hearth), so the free guarantee comes later.
 */
export const DRAFT_PITY = 2

/**
 * Hostility one firekeeper's offering at the hearth calms (two herbs, every
 * 20 work-seconds): about a point a minute for a villager and most of a herb
 * camp's output — enough to hold the forest's slow creep back, never to undo
 * a cleared map.
 */
export const WARD_HOSTILITY_PER_OFFERING = 0.3

// ---------------------------------------------------------------------------
// Mid-run tension: a Queen who notices reputation standing still, rising
// expectations, glades left to the forest, and a Storm that shrinks the
// hearth's reach (new section — tuned together against the balance harness)
// ---------------------------------------------------------------------------

/**
 * Seconds after the last whole reputation point before the Queen starts to
 * notice that it has stopped rising. Every new point resets the clock.
 */
export const IMPATIENCE_STAGNATION_GRACE = 60
/**
 * Past the grace, stagnation impatience per second grows by this much for
 * every further second without a reputation point — gentle at first (ten
 * seconds past the grace adds ~0.06 a minute)…
 */
export const IMPATIENCE_STAGNATION_RAMP = 0.0001
/**
 * …up to this many per second (~0.5 a minute, reached 80 s past the grace)
 * for a settlement gone still. Tuned with the balance harness: a stronger,
 * steeper version killed slow runs it should have pushed; this one turns most
 * long stalls into readable losses while winners pay a point or two.
 */
export const IMPATIENCE_STAGNATION_MAX = 0.008

/**
 * Rising expectations: from Year 2 a species with every need met loses this
 * much resolve per year after the first (one with half its needs met, half
 * as much) — what pleased a young settlement is taken for granted later, so
 * resolve does not plateau far above the reputation threshold once services
 * stand, and a service lost late hurts more than one never built…
 *
 * Raised from 3 when the Queen's Architect and the targeted redraw let a
 * player buy the service chains the draft withheld: with fewer needs left
 * unserved, the late game asks more of the services that stand (tuned with
 * the balance harness back to ~75%).
 */
export const RESOLVE_EXPECTATION_PER_YEAR = 4
/**
 * …and this much per villager past `RESOLVE_EXPECTATION_CROWD_FROM`: a bigger
 * settlement expects more of its viceroy.
 */
export const RESOLVE_EXPECTATION_PER_VILLAGER = 0.25
export const RESOLVE_EXPECTATION_CROWD_FROM = 15

/**
 * Every glade reclaimed makes the forest's passive hostility grow this share
 * faster for the rest of the run (on top of the one-off
 * `HOSTILITY_PER_GLADE_CLEARED`), so the fourteenth glade costs more than
 * the fourth.
 */
export const HOSTILITY_RATE_PER_CLEARED_GLADE = 0.04
/**
 * A glade left to the forest calms it by this much hostility per second for as
 * long as it stands uncleared — scaled by its kind (`SPARED_GLADE_WEIGHT`).
 */
export const HOSTILITY_CALM_PER_SPARED_GLADE = 0.002
export const SPARED_GLADE_WEIGHT = {
  settlement: 0,
  small: 1,
  dangerous: 1.5,
  forbidden: 2,
} as const
/**
 * Hostility for breaking the truce on a spared glade (to clear it after all):
 * more than a spared glade calms in ten minutes, so sparing is a commitment.
 */
export const SPARED_GLADE_RECLAIM_HOSTILITY = 5

/**
 * Through the Storm the hearth's warm reach shrinks steadily, down to this
 * share of `HEARTH_WARMTH_RADIUS` as the Storm ends (in steps of
 * `HEARTH_REACH_STEP`, so the ring visibly pulls in a few times rather than
 * creeping every tick). Homes on the edge need a brazier or insulation.
 */
export const HEARTH_STORM_REACH_FLOOR = 0.7
export const HEARTH_REACH_STEP = 0.25
/**
 * Frost: every villager sleeping in a cold home through the Storm adds a
 * second of exposure per second; each time the settlement's exposure reaches
 * this, one villager dies of the cold. Six cold villagers lose one about every
 * minute; exposure clears when the Storm passes.
 */
export const FROST_EXPOSURE_PER_LOSS = 360

// ---------------------------------------------------------------------------
// Levers: the Queen's Architect (an amber sink at the hearth that steers the
// draft), the Grand Petition (a last-chance gamble) and the Retreat to the
// Citadel (an honourable early end). See `levers.ts`.
// ---------------------------------------------------------------------------

/**
 * Amber for the architect's plans — a blueprint toward a service of your
 * choosing, bought at the hearth — before any is bought, and the rise with
 * each. Dearer than a caravan's rare blueprint (100, +50), so the Trading
 * Post keeps its own bargains, and steep enough that a second set of plans
 * costs most of a run's amber.
 */
export const ARCHITECT_PLANS_PRICE = 140
export const ARCHITECT_PLANS_GROWTH = 70
/** Added to the reroll price for a redraw toward a named service. */
export const TARGETED_REDRAW_SURCHARGE = 25

/** The Grand Petition opens once impatience is within this much of the limit… */
export const PETITION_WITHIN = 5
/** …from this year (once per run), for this much amber. */
export const PETITION_FROM_YEAR = 2
export const PETITION_AMBER = 120
/** Impatience the Queen forgives when she grants it. */
export const PETITION_RELIEF = 5
/**
 * The vow: up to this much reputation, earned within this many seconds… —
 * sized to the pace of the last `PETITION_PACE_SECONDS` (what that pace would
 * earn in the vow's time, rounded up), never less than `PETITION_VOW_MIN`.
 * A stalled settlement vows what it can keep, not what it once managed.
 */
export const PETITION_VOW_REPUTATION = 3
export const PETITION_VOW_MIN = 1
export const PETITION_VOW_SECONDS = 360
export const PETITION_PACE_SECONDS = 360
/** …or her patience snaps back by this much more. A vow kept forgives a little more. */
export const PETITION_BROKEN_IMPATIENCE = 6
export const PETITION_KEPT_RELIEF = 1

/**
 * The Queen's final charge: once a settlement is within this many points of
 * victory and reputation has then stood still for `FINAL_CHARGE_STALL`
 * seconds, she turns her eye on it for the rest of the climb — contented
 * villagers earn reputation `FINAL_CHARGE_RESOLVE_RATE` times as fast. A
 * catch-up for a stalled finish that still has to be earned: species below
 * their threshold earn nothing, charged or not.
 */
export const FINAL_CHARGE_WITHIN = 3
export const FINAL_CHARGE_STALL = 90
export const FINAL_CHARGE_RESOLVE_RATE = 2

/**
 * The Retreat to the Citadel is offered once the Queen's impatience has
 * passed this share of the limit while reputation is still at least this many
 * points short of victory: the run is lost in all but name.
 */
export const RETREAT_IMPATIENCE_SHARE = 0.7
export const RETREAT_REPUTATION_SHORT = 6

// ---------------------------------------------------------------------------
// The climax: the Envoy's approach (see `climax.ts`), reputation profiles per
// land and commission (see `reputation.ts`) and the Long Night blight
// ---------------------------------------------------------------------------

/**
 * The final Storm pulls the hearth's warm reach in further than an ordinary
 * one, scaled by the forest's hostility as it breaks: this share of the reach
 * at the end of the Storm, less `ENVOY_REACH_PER_HOSTILITY` for every point of
 * hostility, never below `ENVOY_REACH_FLOOR_MIN` (hostility 30 → 0.56, 50 → 0.5).
 */
export const ENVOY_REACH_FLOOR_BASE = 0.65
export const ENVOY_REACH_PER_HOSTILITY = 0.003
export const ENVOY_REACH_FLOOR_MIN = 0.4
/** Hostility the forest gains as the final Storm breaks, on top of `HOSTILITY_PER_STORM`. */
export const ENVOY_STORM_HOSTILITY = 6
/** Threats strike this many times faster through the final Storm. */
export const ENVOY_THREAT_PACE = 1.5
/**
 * The final Storm always carries a blight (whatever the year or hostility),
 * drawn from the bands hostility has unlocked (the lowest band at least), and
 * turning it aside takes this many times the usual goods.
 */
export const ENVOY_BLIGHT_PREP_SCALE = 1.5
/**
 * The forest's dread in the last stand: every species loses this much resolve
 * per point of hostility as the final Storm breaks (at least
 * `ENVOY_DREAD_MIN`) until it passes — lifted early by gathering this many
 * herbs to burn as offerings.
 */
export const ENVOY_DREAD_PER_HOSTILITY = 0.12
export const ENVOY_DREAD_MIN = 2
export const ENVOY_DREAD_OFFERING_HERBS = 40
/**
 * Collapse while the envoy rides: the run is lost if the population falls
 * below this share of what it was when she set out (and never fewer than
 * `ENVOY_POPULATION_MIN`)…
 */
export const ENVOY_POPULATION_FLOOR_SHARE = 0.75
export const ENVOY_POPULATION_MIN = 4
/** …if the hearth stands cold this many seconds in all… */
export const ENVOY_COLD_HEARTH_SECONDS = 30
/**
 * …or if more than this share of the villagers are discontented — their
 * species' resolve at least `ENVOY_UNREST_MARGIN` below the threshold where it
 * earns reputation — for this many seconds straight (unrest).
 */
export const ENVOY_UNREST_SHARE = 0.5
export const ENVOY_UNREST_MARGIN = 4
export const ENVOY_UNREST_SECONDS = 90

/**
 * Reputation per amber of caravan sales on a land or commission whose profile
 * pays for trade (×1), and per caravan that calls — trade earns no reputation
 * anywhere else.
 */
export const REPUTATION_PER_TRADE_AMBER = 0.012
export const REPUTATION_PER_CARAVAN = 0.35

/**
 * The Long Night (a Storm blight): unprepared, the hearth's warm reach at the
 * end of that Storm is this much smaller (percent) — half the usual radius
 * where an ordinary Storm leaves 70%.
 */
export const LONG_NIGHT_REACH_PERCENT = -30
/** Braziers lit during the Long Night that lift it. */
export const LONG_NIGHT_BRAZIERS = 2
/**
 * Past the Queen's deadline she will not wait for a Storm: the envoy arrives
 * by this game-clock second at the latest (38 minutes), so every run still
 * reaches its verdict in time.
 */
export const ENVOY_LATEST_ARRIVAL_SECONDS = 38 * 60
/**
 * The last stand brings one blight, and one more for every this much
 * hostility as Clearance begins (or the Storm breaks), up to the most.
 */
export const ENVOY_HOSTILITY_PER_EXTRA_BLIGHT = 25
export const ENVOY_MAX_BLIGHTS = 3
