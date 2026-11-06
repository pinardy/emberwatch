import { withRunCache } from './runCache'
import { feats } from './feats'
import type { RunState, Season } from '../types'
import {
  BASE_STORAGE,
  HOSTILITY_PER_POPULATION,
  HOSTILITY_PER_SECOND,
  HOSTILITY_PER_STORM,
  HOSTILITY_SEASON_MULTIPLIER,
  HOSTILITY_YEAR_SCALING,
  NEWCOMER_SEASONS,
  newcomerInterval,
  QUEEN_DEADLINE_YEAR,
  SEASON_INFO,
  SEASON_ORDER,
} from './balance'
import { pushLog } from './createRun'
import {
  checkMilestones,
  stepClearing,
  stepNewcomers,
  stepOrders,
  stepThreats,
} from './events'
import { computeModifiers, seasonLengthFor, type Modifiers } from './modifiers'
import { stepProduction } from './production'
import { computeStorageCap, population, totalHousing } from './queries'
import { checkCharter, stepConditions, stepDecree } from './structure'
import { stepCaravan } from './trade'
import { displayName } from './upgrades'
import { recordEvent, stepTimeline } from './timeline'
import {
  QUEEN_DEADLINE_SECONDS,
  stepBraziers,
  stepDepartures,
  hearthFuelRate,
  stepFood,
  stepHearth,
  stepImpatience,
  stepReputation,
  stepResolve,
} from './society'

export const MAX_HOSTILITY = 100

/** The Queen's deadline log line: the toast and the Log both read it. */
export const DEADLINE_PASSED_LOG =
  "The Queen's deadline has passed. Her patience now drains faster every minute."

const BRAZIER_COLD_LOG = 'A brazier has gone cold — the homes around it are freezing. It needs wood.'

/**
 * Advances the whole simulation by `dt` seconds. Mutates `s` in place — the
 * store hands us a draft copy, which keeps per-tick allocation near zero.
 *
 * The sim halts while a choice is pending (glade event, cornerstone) so players
 * are never asked to make a decision against a running clock.
 */
export function tick(s: RunState, dt: number): void {
  if (s.phase !== 'playing') return
  if (s.pendingChoices.length > 0) return
  // Settlement-wide derivations are remembered across ticks (see `withRunCache`).
  withRunCache(s, () => tickPlaying(s, dt))
}

function tickPlaying(s: RunState, dt: number): void {
  const mods = computeModifiers(s)
  s.storageCap = computeStorageCap(s, BASE_STORAGE + mods.globalStorage)
  s.clock += dt

  advanceSeason(s, dt, mods)

  // Said when the overtime actually starts, which season-length modifiers can
  // move away from the start of a year.
  if (s.clock >= QUEEN_DEADLINE_SECONDS && s.clock - dt < QUEEN_DEADLINE_SECONDS) {
    pushLog(s, DEADLINE_PASSED_LOG, 'bad')
  }

  const production = stepProduction(s, dt, mods)
  for (const id of production.upgraded) {
    const b = s.buildings[id]
    if (b) pushLog(s, `Upgrade complete: the ${displayName(b)} stands ready.`, 'good')
  }
  stepClearing(s, dt, mods)
  stepThreats(s, dt)
  stepConditions(s, dt)
  stepCaravan(s, dt, mods)

  s.coldHearth = stepHearth(s, dt, hearthFuelRate(s.season.season, mods))
  if (s.coldHearth) feats(s).hearthWentCold = true
  // Braziers draw on the same woodpile, after the hearth. Said once a Storm,
  // however often a thin woodpile makes them gutter.
  if (stepBraziers(s, dt, mods.hearthFuel * mods.brazierFuel) > 0) {
    const said = s.log.some(
      (e) => e.text === BRAZIER_COLD_LOG && e.year === s.season.year && e.season === 'storm',
    )
    if (!said) pushLog(s, BRAZIER_COLD_LOG, 'bad')
  }

  stepFood(s, dt, mods)
  stepHostility(s, dt, mods.hostilityRate)

  const breakdowns = stepResolve(s, dt, mods)
  stepReputation(s, dt, mods, breakdowns)
  stepImpatience(s, dt, mods)

  for (const message of stepDepartures(s, dt)) pushLog(s, message, 'bad')

  // Nobody moves to a settlement that cannot feed the mouths it has.
  if (NEWCOMER_SEASONS.includes(s.season.season) && !s.starving) {
    stepNewcomers(
      s,
      dt,
      newcomerInterval(population(s)) * mods.newcomerRate,
      totalHousing(s),
    )
  }

  stepDecree(s, dt)
  stepOrders(s)
  checkMilestones(s)
  checkCharter(s)
  checkEndConditions(s)
  stepTimeline(s)
}

/**
 * Passive hostility gained per second right now (before storms, glades and
 * threat strikes). Shared with the HUD so its forecast matches the sim.
 */
export function hostilityRate(s: RunState, rateMultiplier: number): number {
  const yearScale = 1 + (s.season.year - 1) * HOSTILITY_YEAR_SCALING
  const popScale = 1 + population(s) * HOSTILITY_PER_POPULATION
  const seasonScale = HOSTILITY_SEASON_MULTIPLIER[s.season.season]
  return HOSTILITY_PER_SECOND * yearScale * popScale * seasonScale * rateMultiplier
}

function stepHostility(s: RunState, dt: number, rateMultiplier: number): void {
  const gain = hostilityRate(s, rateMultiplier) * dt
  s.hostility = Math.min(MAX_HOSTILITY, Math.max(0, s.hostility + gain))
}

function advanceSeason(s: RunState, dt: number, mods: Modifiers): void {
  s.season.elapsed += dt
  if (s.season.elapsed < s.season.length) return

  s.season.elapsed -= s.season.length
  const index = SEASON_ORDER.indexOf(s.season.season)
  const next = SEASON_ORDER[(index + 1) % SEASON_ORDER.length] as Season
  if (next === 'drizzle') s.season.year++
  s.season.season = next
  s.season.length = seasonLengthFor(next, s.season.year, mods)

  if (next === 'storm') {
    recordEvent(s, 'storm')
    s.hostility = Math.min(MAX_HOSTILITY, s.hostility + HOSTILITY_PER_STORM)
    pushLog(
      s,
      `The Blightstorm breaks over the settlement. Keep the hearth burning.`,
      'bad',
    )
  } else if (next === 'drizzle') {
    recordEvent(s, 'year', String(s.season.year))
    pushLog(s, `Year ${s.season.year} begins. The storm has passed.`, 'good')
    if (s.season.year === QUEEN_DEADLINE_YEAR - 1 && s.clock < QUEEN_DEADLINE_SECONDS) {
      pushLog(
        s,
        `The Queen expects the settlement secured within the year. After that, her patience drains by the day.`,
        'bad',
      )
    }
  } else {
    pushLog(s, `${SEASON_INFO[next].name}. ${SEASON_INFO[next].blurb}`, 'info')
  }
}

function checkEndConditions(s: RunState): void {
  if (s.reputation >= s.maxReputation) {
    s.phase = 'won'
    pushLog(
      s,
      `The settlement is secure. The Queen recalls you to the Citadel with honours.`,
      'good',
    )
    return
  }
  if (s.impatience >= s.maxImpatience) {
    s.phase = 'lost'
    pushLog(s, `The Queen's patience is spent. The settlement is abandoned.`, 'bad')
    return
  }
  if (population(s) === 0) {
    s.phase = 'lost'
    pushLog(s, `The last villager has gone. Nothing remains but the cold hearth.`, 'bad')
  }
}
