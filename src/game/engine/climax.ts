import { SPECIES } from '../content/species'
import type { StormBlightDef } from '../content/stormBlights'
import type {
  ActiveCondition,
  ConditionSpec,
  EnvoyCollapse,
  EnvoyState,
  EnvoyUnrest,
  RunState,
  Season,
  SpeciesId,
} from '../types'
import {
  ENVOY_BLIGHT_PREP_SCALE,
  ENVOY_COLD_HEARTH_SECONDS,
  ENVOY_DREAD_MIN,
  ENVOY_DREAD_OFFERING_HERBS,
  ENVOY_DREAD_PER_HOSTILITY,
  ENVOY_HOSTILITY_PER_EXTRA_BLIGHT,
  ENVOY_LATEST_ARRIVAL_SECONDS,
  ENVOY_MAX_BLIGHTS,
  ENVOY_POPULATION_FLOOR_SHARE,
  ENVOY_POPULATION_MIN,
  ENVOY_STORM_HOSTILITY,
  ENVOY_THREAT_PACE,
  ENVOY_UNREST_MARGIN,
  ENVOY_UNREST_SECONDS,
  ENVOY_UNREST_SHARE,
  HOSTILITY_PER_STORM,
  RESOLVE_COLD_HOME,
  SEASON_ORDER,
  hostilityResolvePenalty,
  STORM_BLIGHT_MIN_HOSTILITY,
} from './balance'
import { announceBlight, blightsAt } from './blights'
import { MAX_HOSTILITY } from './hostility'
import { seasonLengthFor, type Modifiers } from './modifiers'
import { addCondition } from './outcomes'
import { population, speciesCounts, stormEndReach } from './queries'
import { resolveBreakdowns, villagersBeyond, type ResolveBreakdown } from './society'
import { sendEnvoy } from './reputation'
import { makeRng } from './rng'
import { pushLog } from './runLog'

/*
 * The climax: the Envoy's approach.
 *
 * Reaching the maximum reputation no longer ends the run. The Queen is
 * satisfied and sends her envoy, who arrives as the next Storm to break comes
 * to an end. Until she is here:
 *
 *  - the Queen's impatience no longer matters (it stops moving);
 *  - the forest makes its last stand in that Storm: blights are certain —
 *    one, and more the angrier the forest (forecast at the Clearance before
 *    it, dearer to turn aside) — hostility surges, a dread weighs on every
 *    species' resolve in proportion to the hostility, threats strike faster,
 *    and the hearth's warm ring pulls in further (`stormReachFloor`);
 *  - the run is lost if the settlement collapses: a quarter of its people
 *    gone, the hearth cold too long, or most of it in unrest (discontented:
 *    well below the reputation threshold) for too long;
 *  - reputation still earned is Glory, for the end screen and the ledger.
 *
 * `reputation.ts` sends her (the moment the meter fills); this module steps
 * the approach, and `tick.ts` asks it when the run is decided.
 */

/** The envoy is on the road: the approach has begun and not yet ended. */
export function envoyRiding(s: Pick<RunState, 'envoy' | 'phase'>): s is RunState & { envoy: EnvoyState } {
  return !!s.envoy && !s.envoy.outcome && s.phase === 'playing'
}

/** Fewest villagers the settlement may fall to before the envoy arrives. */
export function envoyPopulationFloor(e: Pick<EnvoyState, 'population'>): number {
  return Math.max(ENVOY_POPULATION_MIN, Math.ceil(e.population * ENVOY_POPULATION_FLOOR_SHARE))
}

/**
 * 0..1 share of villagers whose species is discontented: its resolve at least
 * `ENVOY_UNREST_MARGIN` below the threshold where it earns reputation.
 */
export function discontentShare(s: RunState): number {
  const pop = population(s)
  if (pop === 0) return 0
  const counts = speciesCounts(s)
  let low = 0
  for (const sp of s.speciesPool) {
    if (counts[sp] > 0 && s.resolve[sp] <= SPECIES[sp].resolveTarget - ENVOY_UNREST_MARGIN) low += counts[sp]
  }
  return low / pop
}

/**
 * Something that will weigh on resolve in the last stand: a blight (forecast
 * or struck), the forest's dread and surge, homes left in the cold. `lift` is
 * the condition whose goal turns it aside or lifts it, when there is one.
 */
export interface ResolveBlow {
  name: string
  /** Resolve it costs (negative). */
  amount: number
  species: SpeciesId | 'all'
  lift?: ActiveCondition
}

/** One species in the last stand: the resolve it is heading for, and the line it must stay above. */
export interface LastStandSpecies {
  species: SpeciesId
  count: number
  projected: number
  /** At or below this it is discontented (`ENVOY_UNREST_MARGIN` under its threshold). */
  line: number
}

/**
 * The last stand's resolve, worked out from the moment the envoy sets out:
 * where each species' resolve is heading once the coming Storm's blights,
 * the forest's dread and surge and the shrunken warm ring land on top of
 * today's needs — and so whether most of the settlement would fall into
 * unrest, who, and what is doing it. Inside the last stand it is the resolve
 * each species is drifting toward now, with the cold at the Storm's end.
 */
export interface LastStandOutlook {
  species: LastStandSpecies[]
  /** Largest first. */
  blows: ResolveBlow[]
  /** Villagers of species that would be discontented, of `population`. */
  discontented: number
  population: number
  /** More than `ENVOY_UNREST_SHARE` would be discontented. */
  unrest: boolean
  /** The forest's blights are still to be forecast (at the coming Clearance): how many. */
  unforecast: number
  /** The last stand is under way. */
  inStand: boolean
}

/**
 * The last stand's outlook while the envoy rides and her Storm is the coming
 * one (or this one); null otherwise — when she set out mid-Storm, the Storm
 * she arrives at the end of is a year off, and today's needs say little.
 */
export function lastStandOutlook(
  s: RunState,
  mods: Modifiers,
  breakdowns: ResolveBreakdown[] = resolveBreakdowns(s, mods),
): LastStandOutlook | null {
  if (!envoyRiding(s)) return null
  const e = s.envoy
  const storm = s.season.season === 'storm'
  if (storm && !e.finalStorm) return null
  const inStand = e.finalStorm && storm
  const pop = population(s)
  const blows: ResolveBlow[] = []
  const flatBlows = (c: ActiveCondition, effects: ConditionSpec['whileActive']) => {
    for (const fx of effects ?? []) {
      if (fx.kind === 'resolveFlat' && fx.amount < 0) {
        blows.push({ name: c.name, amount: fx.amount, species: fx.species, lift: c })
      }
    }
  }
  let surge = 0
  if (inStand) {
    for (const c of s.conditions) flatBlows(c, c.whileActive)
  } else {
    for (const c of s.conditions) if (c.breaksWithStorm) flatBlows(c, c.onFail?.condition?.whileActive)
    // As the Storm breaks: its usual hostility, the last stand's surge, the dread.
    const after = Math.min(MAX_HOSTILITY, s.hostility + HOSTILITY_PER_STORM + ENVOY_STORM_HOSTILITY)
    blows.push({ name: DREAD_NAME, amount: -dreadAt(after), species: 'all' })
    surge = hostilityResolvePenalty(after) - hostilityResolvePenalty(s.hostility)
    if (surge >= 0.5) blows.push({ name: "the forest's surge", amount: -surge, species: 'all' })
  }
  // The warm ring is smallest at the Storm's end: homes beyond it then.
  const cold = pop > 0 ? villagersBeyond(s, stormEndReach(s), pop) : 0
  const chill = pop > 0 ? (RESOLVE_COLD_HOME * cold) / pop : 0
  if (chill <= -0.5) blows.push({ name: 'homes beyond the fire', amount: chill, species: 'all' })
  blows.sort((a, b) => a.amount - b.amount)

  const counts = speciesCounts(s)
  const species: LastStandSpecies[] = []
  let discontented = 0
  for (const b of breakdowns) {
    const count = counts[b.species] ?? 0
    if (count <= 0) continue
    // Today's target without today's Storm, then the last stand on top of it.
    let projected = b.target - b.chill + chill
    if (!inStand) {
      // A cornerstone's Storm resolve (Storm Lanterns) counts in the Storm.
      projected += mods.stormResolve - surge
      for (const blow of blows) {
        if (blow.name === "the forest's surge" || blow.name === 'homes beyond the fire') continue
        if (blow.species === 'all' || blow.species === b.species) projected += blow.amount
      }
    }
    const line = b.threshold - ENVOY_UNREST_MARGIN
    if (projected <= line) discontented += count
    species.push({ species: b.species, count, projected, line })
  }
  const standing = s.conditions.filter((c) => c.breaksWithStorm).length
  const unforecast = inStand || e.lastStandForecast ? 0 : Math.max(0, lastStandBlights(s.hostility) - standing)
  return {
    species,
    blows,
    discontented,
    population: pop,
    unrest: pop > 0 && discontented / pop > ENVOY_UNREST_SHARE,
    unforecast,
    inStand,
  }
}

/** Unrest: more than `ENVOY_UNREST_SHARE` of the villagers are discontented. */
export function inUnrest(s: RunState): boolean {
  return discontentShare(s) > ENVOY_UNREST_SHARE
}

/** How much faster threats strike right now (1 outside the final Storm). */
export function threatPace(s: RunState): number {
  return envoyRiding(s) && s.envoy.finalStorm && s.season.season === 'storm' ? ENVOY_THREAT_PACE : 1
}

/** Resolve the forest's dread costs every species in the last stand at `hostility`. */
export function dreadAt(hostility: number): number {
  return Math.max(ENVOY_DREAD_MIN, Math.round(hostility * ENVOY_DREAD_PER_HOSTILITY))
}

/**
 * Seconds until the envoy arrives: the rest of the season, then each season
 * after it until the next Storm to break has run its course (the Storm she
 * set out in does not count) — or the Queen's latest day, if that comes
 * first. Null when she is not riding.
 */
export function envoyArrivesIn(s: RunState, mods: Modifiers): number | null {
  if (!envoyRiding(s)) return null
  const latest = Math.max(0, ENVOY_LATEST_ARRIVAL_SECONDS - s.clock)
  let total = Math.max(0, s.season.length - s.season.elapsed)
  if (s.season.season === 'storm' && s.envoy.finalStorm) return Math.min(latest, total)
  let season: Season = s.season.season
  let year = s.season.year
  do {
    const next = SEASON_ORDER[(SEASON_ORDER.indexOf(season) + 1) % SEASON_ORDER.length] as Season
    if (next === 'drizzle') year++
    season = next
    total += seasonLengthFor(season, year, mods)
  } while (season !== 'storm')
  return Math.min(latest, total)
}

/**
 * Called as a Storm breaks (from the tick's season roll): if the envoy is on
 * her way, this is the forest's last stand.
 */
export function envoyStormBreaks(s: RunState): void {
  if (!envoyRiding(s) || s.envoy.finalStorm) return
  beginLastStand(s)
}

/**
 * Called as a Storm is about to pass: true (and the season is not rolled)
 * when it was the final Storm — the envoy rides in with the clearing sky.
 */
export function envoyArrivesWithStormEnd(s: RunState): boolean {
  if (!envoyRiding(s) || !s.envoy.finalStorm) return false
  arrive(s)
  return true
}

/**
 * Called as Clearance begins (or at once, when she set out mid-Clearance):
 * while the envoy rides, the forest's blights for her Storm are certain.
 * Returns true when it announced any (the ordinary forecast is then skipped).
 */
export function forecastFinalBlight(s: RunState): boolean {
  if (!envoyRiding(s) || s.envoy.lastStandForecast) return false
  s.envoy.lastStandForecast = true
  // A forecast already standing (she set out mid-Clearance) counts as one.
  const standing = s.conditions.filter((c) => c.breaksWithStorm).map((c) => c.name)
  const defs = drawLastStand(s, standing)
  if (defs.length === 0) return standing.length > 0
  for (const def of defs) announceBlight(s, def, ENVOY_BLIGHT_PREP_SCALE)
  pushLog(
    s,
    `🌩️ The forest gathers for its last stand before the envoy arrives: ${defs.map((d) => d.name).join(' and ')} will come with the Storm.`,
    'bad',
  )
  return true
}

/**
 * How many blights the forest's last stand brings at this hostility: one,
 * and one more for every `ENVOY_HOSTILITY_PER_EXTRA_BLIGHT` of hostility, up
 * to `ENVOY_MAX_BLIGHTS` — the angrier the forest, the harder its last stand.
 */
export function lastStandBlights(hostility: number): number {
  return Math.min(ENVOY_MAX_BLIGHTS, 1 + Math.floor(hostility / ENVOY_HOSTILITY_PER_EXTRA_BLIGHT))
}

/**
 * Draws the last stand's blights from the bands hostility has unlocked (the
 * lowest at least), no two alike and none already forecast (`standing`).
 */
function drawLastStand(s: RunState, standing: string[]): StormBlightDef[] {
  const want = lastStandBlights(s.hostility) - standing.length
  const pool = blightsAt(Math.max(s.hostility, STORM_BLIGHT_MIN_HOSTILITY)).filter(
    (b) => !standing.includes(b.name),
  )
  const out: StormBlightDef[] = []
  if (want <= 0 || pool.length === 0) return out
  const rng = makeRng(s.seed, s.rngCursor)
  while (out.length < want && pool.length > 0) {
    const def = rng.weighted(pool, (b) => b.weight * (1 + Math.max(0, s.hostility - b.minHostility) / 40))
    out.push(def)
    pool.splice(pool.indexOf(def), 1)
  }
  s.rngCursor = rng.cursor()
  return out
}

/**
 * Steps the approach once a tick: sends the envoy if reputation stands full
 * without one (a hand-edited run), announces the last stand when she set out
 * mid-Clearance, and watches for the settlement collapsing.
 */
export function stepEnvoy(s: RunState, dt: number): void {
  if (s.phase !== 'playing') return
  if (!s.envoy && s.reputation >= s.maxReputation) sendEnvoy(s)
  if (!envoyRiding(s)) return
  const e = s.envoy

  if (!e.finalStorm && s.season.season === 'clearance' && !e.lastStandForecast) {
    // She set out after this Clearance's forecast (or there was none): the
    // forest announces its last stand now, with what is left of the Clearance.
    forecastFinalBlight(s)
  }
  if (s.clock >= ENVOY_LATEST_ARRIVAL_SECONDS) {
    arrive(s)
    return
  }

  if (s.coldHearth) e.coldSeconds += dt
  e.unrestSeconds = inUnrest(s) ? e.unrestSeconds + dt : 0

  const collapse = collapseCause(s, e)
  if (collapse) {
    e.outcome = 'collapsed'
    e.collapse = collapse
    if (collapse === 'unrest') e.unrest = unrestCause(s)
    pushLog(s, `${COLLAPSE_LOG[collapse]} The envoy will find nothing to confirm.`, 'bad')
  }
}

/**
 * While the envoy rides the Queen is satisfied and her impatience stands
 * still, so her court falls quiet: a decree on offer or running, and order
 * offers waiting for a pick, are set aside without cost (a decree's penalty
 * would mean nothing, and a modal in the last stand is noise). Orders in hand
 * still count, and pay Glory. Called by the tick, before it would stop for a
 * waiting choice and after the step that may have sent her.
 */
export function quietCourt(s: RunState): void {
  if (!envoyRiding(s)) return
  const choices = s.pendingChoices.filter((c) => c.kind !== 'decree' && c.kind !== 'order')
  const offers = (s.orderOffers ?? []).length > 0
  if (choices.length === s.pendingChoices.length && !offers && !s.decree) return
  if (choices.length < s.pendingChoices.length) s.pendingChoices = choices
  if (offers) s.orderOffers = []
  const decree = !!s.decree
  s.decree = null
  pushLog(
    s,
    decree
      ? "📯 The Queen's herald withdraws the decree: her envoy is on her way. No new decrees or orders until she arrives; orders in hand still pay, as Glory."
      : '📯 The court falls quiet while the envoy rides: no new decrees or orders until she arrives. Orders in hand still pay, as Glory.',
    'info',
  )
}

/**
 * Who is in unrest right now and what is weighing on them — the struck
 * blights, the dread and anything else costing resolve — for the end screen.
 */
export function unrestCause(s: RunState): EnvoyUnrest {
  const counts = speciesCounts(s)
  const species = s.speciesPool.filter(
    (sp) => counts[sp] > 0 && s.resolve[sp] <= SPECIES[sp].resolveTarget - ENVOY_UNREST_MARGIN,
  )
  const blows: EnvoyUnrest['blows'] = []
  for (const c of s.conditions) {
    for (const fx of c.whileActive ?? []) {
      if (fx.kind === 'resolveFlat' && fx.amount < 0) blows.push({ name: c.name, amount: fx.amount })
    }
  }
  blows.sort((a, b) => a.amount - b.amount)
  return { species, blows }
}

/** What would end the approach as a loss right now, if anything. */
export function collapseCause(s: RunState, e: EnvoyState): EnvoyCollapse | null {
  const pop = population(s)
  // An empty settlement is the ordinary loss, said by the tick.
  if (pop > 0 && pop < envoyPopulationFloor(e)) return 'population'
  if (e.coldSeconds >= ENVOY_COLD_HEARTH_SECONDS) return 'hearth'
  if (e.unrestSeconds >= ENVOY_UNREST_SECONDS) return 'unrest'
  return null
}

/** How each collapse reads on the end screen. */
export const COLLAPSE_TEXT: Record<EnvoyCollapse, string> = {
  population: 'too many villagers were lost to hold it',
  hearth: 'the hearth stood cold too long',
  unrest: 'most of the settlement fell into unrest',
}

const COLLAPSE_LOG: Record<EnvoyCollapse, string> = {
  population: 'Too many villagers are gone before the envoy could arrive.',
  hearth: 'The hearth has stood cold too long — the settlement is breaking up.',
  unrest: 'Unrest has gripped most of the settlement for too long — it is breaking up.',
}

/** The forest's last stand begins: the Storm the envoy arrives at the end of. */
function beginLastStand(s: RunState): void {
  const e = s.envoy
  if (!e) return
  e.finalStorm = true
  s.hostility = Math.min(MAX_HOSTILITY, s.hostility + ENVOY_STORM_HOSTILITY)
  const dread = dreadAt(s.hostility)
  addCondition(
    s,
    {
      name: DREAD_NAME,
      icon: '🌲',
      description: `The forest makes its last stand: every species −${dread} resolve until the Storm passes, or until ${ENVOY_DREAD_OFFERING_HERBS} more herbs are gathered to burn as offerings.`,
      resolveBy: { kind: 'produced', resource: 'herb', amount: ENVOY_DREAD_OFFERING_HERBS },
      whileActive: [{ kind: 'resolveFlat', species: 'all', amount: -dread }],
      passesWithStorm: true,
    },
    '',
  )
  pushLog(
    s,
    "🌩️ The forest makes its last stand: hostility surges, a dread settles on everyone, threats strike faster and the hearth's warm ring pulls in further. Hold until the Storm ends and the envoy arrives.",
    'bad',
  )
}

/** The last stand's dread on the conditions bar. */
export const DREAD_NAME = "The Forest's Dread"

function arrive(s: RunState): void {
  const e = s.envoy
  if (!e || e.outcome) return
  e.outcome = 'arrived'
  pushLog(
    s,
    "The Queen's envoy rides in as the Storm clears. The settlement held — you are recalled to the Citadel with honours.",
    'good',
  )
}
