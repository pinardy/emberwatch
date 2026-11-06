import { resourceName } from '../content/resources'
import { STORM_BLIGHT_LIST, type StormBlightDef } from '../content/stormBlights'
import type { ActiveCondition, RunState } from '../types'
import {
  BLIGHT_PREP_GROWTH,
  STORM_BLIGHT_FROM_YEAR,
  STORM_BLIGHT_MIN_HOSTILITY,
} from './balance'
import { pushLog } from './runLog'
import { makeRng } from './rng'
import { addCondition, applyOutcome } from './structure'

/**
 * Storm blights: the forest's hostility made concrete. At each Clearance one
 * is forecast from the blights the current hostility has unlocked; when the
 * Storm breaks it strikes unless its goods were handed over first. The
 * forecast and any lasting damage are ordinary lingering conditions, so they
 * show on the conditions bar with a countdown and what lifts them.
 */

/** Blights the forest can send at `hostility`, lowest band first. */
export function blightsAt(hostility: number): StormBlightDef[] {
  if (hostility < STORM_BLIGHT_MIN_HOSTILITY) return []
  return STORM_BLIGHT_LIST.filter((b) => hostility >= b.minHostility)
}

/** The live forecast for the coming Storm, if one is pending. */
export function pendingBlight(s: RunState): ActiveCondition | undefined {
  return s.conditions.find((c) => c.breaksWithStorm)
}

function tally(s: RunState): NonNullable<RunState['stormBlights']> {
  s.stormBlights ??= { forecast: 0, struck: 0, blunted: 0 }
  return s.stormBlights
}

/**
 * Called as Clearance begins: rolls the coming Storm's blight and announces
 * it. Higher hostility unlocks harsher blights and makes them likelier — each
 * blight's weight grows with how far hostility has passed its band.
 */
export function forecastStormBlight(s: RunState): StormBlightDef | null {
  // A settlement's first Storm is its own lesson; the forest waits a year.
  if (s.season.year < STORM_BLIGHT_FROM_YEAR || pendingBlight(s)) return null
  const pool = blightsAt(s.hostility)
  if (pool.length === 0) return null
  const rng = makeRng(s.seed, s.rngCursor)
  const def = rng.weighted(pool, (b) => b.weight * (1 + (s.hostility - b.minHostility) / 40))
  s.rngCursor = rng.cursor()
  announceBlight(s, def)
  return def
}

/** Puts `def`'s forecast on the conditions bar, counting down to the Storm. */
export function announceBlight(s: RunState, def: StormBlightDef): ActiveCondition {
  const { resource } = def.prep
  const amount = blightPrepAmount(s, def)
  const condition = addCondition(
    s,
    {
      name: def.name,
      icon: def.icon,
      description: `The forest is restless. ${def.warning} Make ${amount} more ${resourceName(resource)} before it breaks to turn it aside.`,
      // Preparing takes work during the Clearance, not a full store: only
      // goods made after the forecast count.
      resolveBy: { kind: 'produced', resource, amount },
      breaksWithStorm: true,
      onFail: def.strike,
    },
    '',
  )
  // Counts down to the Storm; the outcome lands when it breaks, not on a timer.
  condition.timeLeft = Math.max(0, s.season.length - s.season.elapsed)
  tally(s).forecast++
  return condition
}

/** Called as the Storm breaks: every forecast still standing strikes. */
export function breakStormBlights(s: RunState): void {
  const remaining: ActiveCondition[] = []
  const striking: ActiveCondition[] = []
  for (const c of s.conditions) (c.breaksWithStorm ? striking : remaining).push(c)
  if (striking.length === 0) return
  s.conditions = remaining
  for (const c of striking) {
    tally(s).struck++
    const parts = applyOutcome(s, c.onFail)
    pushLog(
      s,
      `${c.icon} The Storm breaks and ${c.name} strikes${parts.length ? ` — ${parts.join(', ')}` : ''}.`,
      'bad',
    )
  }
}

/** Called as the Storm passes: damage that lasts "for the Storm" lifts. */
export function passStormConditions(s: RunState): void {
  if (!s.conditions.some((c) => c.passesWithStorm)) return
  const remaining: ActiveCondition[] = []
  for (const c of s.conditions) {
    if (c.passesWithStorm) pushLog(s, `${c.icon} ${c.name} passes with the Storm.`, 'good')
    else remaining.push(c)
  }
  s.conditions = remaining
}

/**
 * Goods to make during the Clearance to turn a blight aside this year: the
 * Year 2 amount, growing each year after, so a settlement that keeps the
 * forest angry keeps working harder for it.
 */
export function blightPrepAmount(s: RunState, def: StormBlightDef): number {
  const years = Math.max(0, s.season.year - 2)
  return Math.round(def.prep.amount * (1 + BLIGHT_PREP_GROWTH * years))
}
