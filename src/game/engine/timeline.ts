import { SPECIES } from '../content/species'
import type {
  EnvoyCollapse,
  EnvoyState,
  RunState,
  RunTimeline,
  SpeciesId,
  TimelineEvent,
  TimelineEventKind,
  TimelineSample,
} from '../types'
import { QUEEN_DEADLINE_YEAR } from './balance'
import { foodStock, population, speciesCounts } from './queries'

/*
 * The run timeline: a compact, bounded time series of the race between
 * reputation and impatience, plus the moments that moved it. It exists so the
 * end screen can show *why* a run ended, not just how.
 *
 * Everything here is bookkeeping only: it reads the run, never changes the
 * simulation, and never touches the RNG, so recording a timeline cannot alter
 * a seed's future.
 */

/** Game seconds between samples. */
export const TIMELINE_INTERVAL = 12
/**
 * Most samples kept. Past this the older half is thinned to every other
 * sample, so recent play stays sharp and a 40-minute run is ~100 samples.
 */
export const TIMELINE_MAX_SAMPLES = 120
/** Most events kept; season markers are never the ones dropped. */
export const TIMELINE_MAX_EVENTS = 160

/** Column index of each value in a `TimelineSample`. */
export const COL = {
  clock: 0,
  year: 1,
  reputation: 2,
  impatience: 3,
  hostility: 4,
  population: 5,
  resolve: 6,
  food: 7,
  wood: 8,
  /** First per-species resolve column; species follow `RunTimeline.species`. */
  species: 9,
} as const

const SEASON_KINDS: TimelineEventKind[] = ['storm', 'year']

const round1 = (x: number) => Math.round(x * 10) / 10

/** An empty timeline that takes its first sample on the next tick. */
export function emptyTimeline(species: SpeciesId[], clock = 0): RunTimeline {
  return {
    interval: TIMELINE_INTERVAL,
    next: clock,
    species: [...species],
    samples: [],
    limits: [],
    events: [],
  }
}

/** A fresh timeline for a run in progress. Also what older saves load with. */
export function createTimeline(s: RunState): RunTimeline {
  const tl = emptyTimeline(s.speciesPool ?? [], s.clock ?? 0)
  // A save resumed mid-Storm still shades the rest of that Storm.
  if (s.season?.season === 'storm') {
    tl.events.push({ t: round1(Math.max(0, s.clock - s.season.elapsed)), k: 'storm' })
  }
  return tl
}

function timelineOf(s: RunState): RunTimeline {
  return (s.timeline ??= createTimeline(s))
}

/** Notes a key moment for the end-screen chart. Never consumes RNG. */
export function recordEvent(s: RunState, k: TimelineEventKind, d?: string): void {
  const events = timelineOf(s).events
  events.push(d === undefined ? { t: round1(s.clock), k } : { t: round1(s.clock), k, d })
  if (events.length > TIMELINE_MAX_EVENTS) {
    const drop = events.findIndex((e) => !SEASON_KINDS.includes(e.k))
    events.splice(drop === -1 ? 0 : drop, 1)
  }
}

/** Snapshot of the run right now, in `COL` order. */
export function takeSample(s: RunState, species: SpeciesId[]): TimelineSample {
  const counts = speciesCounts(s)
  const pop = population(s)
  let weighted = 0
  for (const sp of species) weighted += (s.resolve[sp] ?? 0) * (counts[sp] ?? 0)
  const avgResolve =
    pop > 0
      ? weighted / pop
      : species.reduce((sum, sp) => sum + (s.resolve[sp] ?? 0), 0) / Math.max(1, species.length)
  return [
    round1(s.clock),
    s.season.year,
    round1(Math.min(s.maxReputation, s.reputation + s.reputationProgress)),
    round1(Math.min(s.maxImpatience, s.impatience + s.impatienceProgress)),
    round1(s.hostility),
    pop,
    round1(avgResolve),
    Math.floor(foodStock(s)),
    Math.floor(s.stock.wood ?? 0),
    ...species.map((sp) => round1(s.resolve[sp] ?? 0)),
  ]
}

/**
 * Thins the older half of the buffer to every other sample once it is over
 * the cap. Repeated thinning leaves early play coarse and recent play sharp.
 */
export function boundSamples(samples: TimelineSample[], max = TIMELINE_MAX_SAMPLES): void {
  if (samples.length <= max) return
  const recent = Math.floor(max / 2)
  const olderCount = samples.length - recent
  const thinned = samples.slice(0, olderCount).filter((_, i) => i % 2 === 0)
  samples.splice(0, olderCount, ...thinned)
}

/**
 * Called once at the end of every tick. Takes a sample on the cadence, and a
 * final one the moment the run is decided so the chart ends on the verdict.
 */
export function stepTimeline(s: RunState): void {
  const tl = timelineOf(s)
  const ended = s.phase !== 'playing'
  if (!ended && s.clock < tl.next) return

  tl.samples.push(takeSample(s, tl.species))
  boundSamples(tl.samples)
  tl.next = (Math.floor(s.clock / tl.interval) + 1) * tl.interval

  const last = tl.limits[tl.limits.length - 1]
  if (!last || last[1] !== s.maxReputation || last[2] !== s.maxImpatience) {
    tl.limits.push([round1(s.clock), s.maxReputation, s.maxImpatience])
  }
}

// ---------------------------------------------------------------------------
// Reading the timeline (shared by the end screen and the live sparkline)
// ---------------------------------------------------------------------------

/** The reputation and impatience goals in force at clock `t`. */
export function limitsAt(tl: RunTimeline, t: number, fallback: [number, number]): [number, number] {
  let out = fallback
  for (const [at, rep, imp] of tl.limits) {
    if (at <= t + 1e-6) out = [rep, imp]
    else break
  }
  if (tl.limits.length > 0 && t < tl.limits[0][0]) out = [tl.limits[0][1], tl.limits[0][2]]
  return out
}

/** 0..1 progress of reputation and impatience toward their goals at a sample. */
export function raceAt(tl: RunTimeline, sample: TimelineSample, fallback: [number, number]) {
  const [maxRep, maxImp] = limitsAt(tl, sample[COL.clock], fallback)
  return {
    reputation: Math.min(1, sample[COL.reputation] / Math.max(1, maxRep)),
    impatience: Math.min(1, sample[COL.impatience] / Math.max(1, maxImp)),
    maxRep,
    maxImp,
  }
}

/** Storm windows `[start, end]` in clock seconds; an open Storm ends at `endClock`. */
export function stormPeriods(tl: RunTimeline, endClock: number): [number, number][] {
  const out: [number, number][] = []
  let start: number | null = null
  for (const e of tl.events) {
    if (e.k === 'storm') start = e.t
    else if (e.k === 'year' && start !== null) {
      out.push([start, e.t])
      start = null
    }
  }
  if (start !== null) out.push([start, Math.max(start, endClock)])
  return out
}

export function inStorm(storms: [number, number][], t: number): boolean {
  return storms.some(([a, b]) => t >= a && t <= b)
}

// ---------------------------------------------------------------------------
// The one-sentence explanation
// ---------------------------------------------------------------------------

const LOSS_KINDS: TimelineEventKind[] = ['left', 'lost']

/** How a collapse during the Envoy's approach reads in the summary. */
const ENVOY_COLLAPSE_CLAUSE: Record<EnvoyCollapse, string> = {
  population: 'too many villagers were lost to hold the settlement',
  hearth: 'the hearth stood cold too long',
  unrest: 'most of the settlement fell into unrest',
}
/**
 * " (Lizards and Harpies, under Leaking Roofs −8 and The Forest's Dread −3)":
 * who fell into unrest and what pushed them, for a collapse into unrest.
 * Empty when the save does not say.
 */
export function unrestDetail(envoy: Pick<EnvoyState, 'collapse' | 'unrest'> | undefined): string {
  const u = envoy?.collapse === 'unrest' ? envoy.unrest : undefined
  if (!u || (u.species.length === 0 && u.blows.length === 0)) return ''
  const and = (parts: string[]) =>
    parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  const who = and(u.species.map(speciesPlural))
  const why = and(u.blows.map((b) => `${b.name} −${Math.round(-b.amount)}`))
  return ` (${[who, why && `under ${why}`].filter(Boolean).join(', ')})`
}

/** How far before a turning point to look for what caused it. */
const CAUSE_WINDOW = 180

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `${one}` : `${n} ${many}`
}

function speciesPlural(id: string): string {
  return SPECIES[id as SpeciesId]?.name ?? 'villagers'
}

/** What went wrong (or right) between two clocks, as a short clause. */
function causeClause(
  tl: RunTimeline,
  from: number,
  to: number,
  storms: [number, number][],
): string | null {
  const inWindow = (e: TimelineEvent) => e.t >= from && e.t <= to
  const losses = tl.events.filter((e) => LOSS_KINDS.includes(e.k) && inWindow(e))
  if (losses.length > 0) {
    const n = losses.length
    const species = new Set(losses.map((e) => e.d))
    const who =
      species.size === 1 && n > 1
        ? `${n} ${speciesPlural(losses[0].d ?? '')}`
        : plural(n, 'a villager', 'villagers')
    const walked = losses.every((e) => e.k === 'left') ? 'left' : 'were lost'
    const stormy = losses.filter((e) => inStorm(storms, e.t)).length * 2 > n
    return `after ${who} ${n === 1 && walked === 'were lost' ? 'was lost' : walked}${stormy ? ' during the Storm' : ''}`
  }
  const missed = tl.events.filter((e) => e.k === 'decreeMissed' && inWindow(e)).length
  if (missed > 0)
    return missed === 1 ? 'after a royal decree lapsed' : `after ${missed} royal decrees lapsed`
  const threats = tl.events.filter((e) => e.k === 'threat' && inWindow(e)).length
  if (threats > 0)
    return threats === 1
      ? 'after a threat was unleashed'
      : `after ${threats} threats were unleashed`
  return null
}

/**
 * A plain-language sentence explaining the outcome, e.g. "Impatience overtook
 * your pace in Year 4 after 3 Foxes left during the Storm." Used as the
 * chart's caption and accessible summary.
 */
export function describeOutcome(run: RunState): string {
  const tl = run.timeline
  const won = run.phase === 'won'
  const samples = tl?.samples ?? []
  const endYear = run.season.year
  if (!won && run.envoy) {
    const why = run.envoy.collapse
      ? `${ENVOY_COLLAPSE_CLAUSE[run.envoy.collapse]}${unrestDetail(run.envoy)}`
      : 'the last villager left'
    const setOut = run.envoy.setOutAt
    const lost = (tl?.events ?? []).filter((e) => LOSS_KINDS.includes(e.k) && e.t >= setOut).length
    const losses = lost > 0 ? ` after ${plural(lost, 'a villager', 'villagers')} ${lost === 1 ? 'was' : 'were'} lost` : ''
    return `Reputation filled in Year ${run.envoy.year} and the Queen's envoy set out, but in Year ${endYear} ${why}${losses} before she arrived.`
  }
  if (!tl || samples.length < 2) {
    return won
      ? `The settlement was secured in Year ${endYear}.`
      : `The settlement fell in Year ${endYear}.`
  }

  const fallback: [number, number] = [run.maxReputation, run.maxImpatience]
  const end = samples[samples.length - 1][COL.clock]
  const storms = stormPeriods(tl, end)
  const lead = samples.map((smp) => {
    const r = raceAt(tl, smp, fallback)
    return r.reputation - r.impatience
  })
  // The last moment the lead changed hands, in the direction that decided it.
  let turn = -1
  for (let i = 1; i < samples.length; i++) {
    const flipped = won ? lead[i - 1] <= 0 && lead[i] > 0 : lead[i - 1] >= 0 && lead[i] < 0
    if (flipped) turn = i
  }
  const turnClock = turn >= 0 ? samples[turn][COL.clock] : samples[0][COL.clock]
  const turnYear = turn >= 0 ? samples[turn][COL.year] : samples[0][COL.year]
  const finalRace = raceAt(tl, samples[samples.length - 1], fallback)

  if (won) {
    const patience = Math.round(finalRace.impatience * 100)
    const met = tl.events.filter((e) => e.k === 'decreeMet').length
    const boost = met > 0 ? `, with ${plural(met, 'a decree', 'decrees')} met` : ''
    const opening =
      turn > 0
        ? `Reputation pulled ahead of the Queen's impatience in Year ${turnYear}`
        : `Reputation led the Queen's impatience all run`
    if (run.envoy) {
      const lost = tl.events.filter((e) => LOSS_KINDS.includes(e.k) && e.t >= run.envoy!.setOutAt).length
      const cost = lost > 0 ? `, losing ${plural(lost, 'a villager', 'villagers')}` : ''
      return `${opening}, filled it in Year ${run.envoy.year} with her patience ${patience}% spent, and held through the forest's last stand${cost} until her envoy arrived in Year ${endYear}${boost}.`
    }
    return `${opening} and secured the settlement in Year ${endYear}${boost}. Her patience was ${patience}% spent.`
  }


  const emptied = run.impatience < run.maxImpatience && Object.keys(run.villagers).length === 0
  const repAt = (t: number) => {
    let rep = samples[0][COL.reputation]
    for (const smp of samples) {
      if (smp[COL.clock] > t) break
      rep = smp[COL.reputation]
    }
    return rep
  }
  const repAtTurn = repAt(turnClock)
  const stalled =
    repAtTurn - repAt(turnClock - CAUSE_WINDOW) < 1
      ? `while reputation stalled at ${Math.floor(repAtTurn)}`
      : null

  let opening: string
  let counted = turnClock
  if (turn > 0) {
    const cause = causeClause(tl, turnClock - CAUSE_WINDOW, turnClock, storms)
    const deadline = turnYear >= QUEEN_DEADLINE_YEAR ? `once the Queen's deadline had passed` : null
    const why = [cause, stalled].filter(Boolean).join(', ') || deadline
    opening = `Impatience overtook your pace in Year ${turnYear}${why ? ` ${why}` : ''}.`
  } else {
    const cause = causeClause(tl, -Infinity, end, storms)
    counted = end
    opening = `Impatience led your reputation all run${cause ? ` and pulled away ${cause}` : ''}.`
  }

  const later = tl.events.filter((e) => LOSS_KINDS.includes(e.k) && e.t > counted).length
  const ending = run.retreated
    ? ` You retreated to the Citadel in Year ${endYear} with reputation at ${Math.round(finalRace.reputation * 100)}%.`
    : emptied
    ? ` The last villager left in Year ${endYear}.`
    : later > 0
      ? ` ${later === 1 ? 'Another villager' : `${later} more villagers`} left before her patience ran out in Year ${endYear}.`
      : ` Her patience ran out in Year ${endYear} with reputation at ${Math.round(finalRace.reputation * 100)}%.`
  return opening + ending
}
