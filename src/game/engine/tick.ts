import type { RunState, Season } from '../types'
import {
  BASE_STORAGE,
  HEARTH_FUEL_PER_SECOND,
  HEARTH_IDLE_FUEL_PER_SECOND,
  HOSTILITY_PER_POPULATION,
  HOSTILITY_PER_SECOND,
  HOSTILITY_PER_STORM,
  HOSTILITY_SEASON_MULTIPLIER,
  HOSTILITY_YEAR_SCALING,
  NEWCOMER_SEASONS,
  newcomerInterval,
  SEASON_INFO,
  SEASON_LENGTH,
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
import { computeModifiers } from './modifiers'
import { stepProduction } from './production'
import { computeStorageCap, population, totalHousing } from './queries'
import { stepCaravan } from './trade'
import {
  stepBraziers,
  stepDepartures,
  stepFood,
  stepHearth,
  stepImpatience,
  stepReputation,
  stepResolve,
} from './society'

export const MAX_HOSTILITY = 100

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

  const mods = computeModifiers(s)
  s.storageCap = computeStorageCap(s, BASE_STORAGE + mods.globalStorage)
  s.clock += dt

  advanceSeason(s, dt)

  stepProduction(s, dt, mods)
  stepClearing(s, dt, mods)
  stepThreats(s, dt)
  stepCaravan(s, dt)

  const fuelRate =
    (s.season.season === 'storm' ? HEARTH_FUEL_PER_SECOND : HEARTH_IDLE_FUEL_PER_SECOND) *
    mods.hearthFuel
  s.coldHearth = stepHearth(s, dt, fuelRate)
  // Braziers draw on the same woodpile, after the hearth. Said once a Storm,
  // however often a thin woodpile makes them gutter.
  if (stepBraziers(s, dt, mods.hearthFuel) > 0) {
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

  if (NEWCOMER_SEASONS.includes(s.season.season)) {
    stepNewcomers(
      s,
      dt,
      newcomerInterval(population(s)) * mods.newcomerRate,
      totalHousing(s),
    )
  }

  stepOrders(s)
  checkMilestones(s)
  checkEndConditions(s)
}

function stepHostility(s: RunState, dt: number, rateMultiplier: number): void {
  const yearScale = 1 + (s.season.year - 1) * HOSTILITY_YEAR_SCALING
  const popScale = 1 + population(s) * HOSTILITY_PER_POPULATION
  const seasonScale = HOSTILITY_SEASON_MULTIPLIER[s.season.season]
  const gain =
    HOSTILITY_PER_SECOND * yearScale * popScale * seasonScale * rateMultiplier * dt
  s.hostility = Math.min(MAX_HOSTILITY, Math.max(0, s.hostility + gain))
}

function advanceSeason(s: RunState, dt: number): void {
  s.season.elapsed += dt
  if (s.season.elapsed < s.season.length) return

  s.season.elapsed -= s.season.length
  const index = SEASON_ORDER.indexOf(s.season.season)
  const next = SEASON_ORDER[(index + 1) % SEASON_ORDER.length] as Season
  if (next === 'drizzle') s.season.year++
  s.season.season = next
  s.season.length = SEASON_LENGTH[next]

  if (next === 'storm') {
    s.hostility = Math.min(MAX_HOSTILITY, s.hostility + HOSTILITY_PER_STORM)
    pushLog(
      s,
      `The Blightstorm breaks over the settlement. Keep the hearth burning.`,
      'bad',
    )
  } else if (next === 'drizzle') {
    pushLog(s, `Year ${s.season.year} begins. The storm has passed.`, 'good')
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
