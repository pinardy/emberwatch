import { withRunCache } from './runCache'
import { feats } from './feats'
import type { RunState, Season } from '../types'
import {
  BASE_STORAGE,
  HOSTILITY_PER_STORM,
  NEWCOMER_SEASONS,
  newcomerInterval,
  QUEEN_DEADLINE_YEAR,
  SEASON_INFO,
  SEASON_ORDER,
} from './balance'
import { MAX_HOSTILITY, stepHostility } from './hostility'
import { pushLog } from './runLog'
import {
  breakStormBlights,
  forecastStormBlight,
  passStormConditions,
} from './blights'
import { checkMilestones } from './drafts'
import { stepClearing } from './glades'
import { stepNewcomers } from './newcomers'
import { stepThreats } from './threats'
import { stepOrders } from './orders'
import { computeModifiers, seasonLengthFor, type Modifiers } from './modifiers'
import { stepProduction } from './production'
import { computeStorageCap, population, totalHousing } from './queries'
import { checkCharter, stepConditions, stepDecree } from './structure'
import { stepCaravan } from './trade'
import { stepFinalCharge, stepPetition } from './levers'
import {
  envoyArrivesWithStormEnd,
  envoyRiding,
  envoyStormBreaks,
  forecastFinalBlight,
  quietCourt,
  stepEnvoy,
  threatPace,
} from './climax'
import { stepErrands } from './errands'
import { displayName } from './upgrades'
import { recordEvent, stepTimeline } from './timeline'
import {
  QUEEN_DEADLINE_SECONDS,
  stepBraziers,
  stepDepartures,
  hearthFuelRate,
  noteReputation,
  stepFood,
  stepFrost,
  stepHearth,
  stepImpatience,
  stepReputation,
  stepResolve,
} from './society'

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
  // A decree or order offer left waiting as the envoy set out is set aside.
  quietCourt(s)
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
  // The forest's last stand: threats strike faster through the final Storm.
  stepThreats(s, dt * threatPace(s))
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
  // Reputation from choices made between ticks, and from resolve just now.
  noteReputation(s)
  // While the envoy rides the Queen is satisfied: her patience stops moving.
  if (!envoyRiding(s)) stepImpatience(s, dt, mods)
  // The Grand Petition's vow is judged on the same reputation.
  stepPetition(s)
  // Within reach of victory and stalled: the Queen's final charge.
  stepFinalCharge(s)

  for (const message of stepDepartures(s, dt)) pushLog(s, message, 'bad')
  for (const message of stepFrost(s, dt)) pushLog(s, message, 'bad')

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
  stepOrders(s, dt)
  stepErrands(s, dt)
  checkMilestones(s)
  checkCharter(s)
  stepEnvoy(s, dt)
  quietCourt(s)
  checkEndConditions(s)
  if (s.phase !== 'playing') closeOpenChoices(s)
  stepTimeline(s)
}

/**
 * A finished run asks nothing more: any choice still waiting (a glade event
 * opened this very tick, a decree on offer, an order offer) is withdrawn, so
 * the end-of-run summary is the only dialog.
 */
export function closeOpenChoices(s: RunState): void {
  if (s.pendingChoices.length > 0) s.pendingChoices = []
  if ((s.orderOffers ?? []).length > 0) s.orderOffers = []
}

function advanceSeason(s: RunState, dt: number, mods: Modifiers): void {
  s.season.elapsed += dt
  if (s.season.elapsed < s.season.length) return
  // The envoy rides in as her Storm ends: the run is decided in that Storm's
  // year, and no new season begins.
  if (s.season.season === 'storm' && envoyArrivesWithStormEnd(s)) return

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
      `The Blightstorm breaks over the settlement. Keep the hearth burning — its warmth will pull in as the Storm wears on.`,
      'bad',
    )
    // Whatever the forest promised at Clearance arrives with the rain.
    breakStormBlights(s)
    // With the envoy on the road, this is the forest's last stand.
    envoyStormBreaks(s)
  } else if (next === 'drizzle') {
    recordEvent(s, 'year', String(s.season.year))
    pushLog(s, `Year ${s.season.year} begins. The storm has passed.`, 'good')
    passStormConditions(s)
    if (s.season.year === QUEEN_DEADLINE_YEAR - 1 && s.clock < QUEEN_DEADLINE_SECONDS) {
      pushLog(
        s,
        `The Queen expects the settlement secured within the year. After that, her patience drains by the day.`,
        'bad',
      )
    }
  } else {
    pushLog(s, `${SEASON_INFO[next].name}. ${SEASON_INFO[next].blurb}`, 'info')
    if (next === 'clearance') {
      // The forest's mood sets the coming Storm's blight, said (as a
      // lingering condition) while there is still a Clearance to prepare in.
      // With the envoy on the road, one is guaranteed.
      if (!forecastFinalBlight(s)) forecastStormBlight(s)
    }
  }
}

function checkEndConditions(s: RunState): void {
  // Reputation at the maximum sends the envoy (`climax.ts`); the run is won
  // when she arrives, and lost if the settlement collapses first.
  if (s.envoy?.outcome === 'arrived') {
    s.phase = 'won'
    return
  }
  if (s.envoy?.outcome === 'collapsed') {
    s.phase = 'lost'
    return
  }
  if (!envoyRiding(s) && s.impatience >= s.maxImpatience) {
    s.phase = 'lost'
    pushLog(s, `The Queen's patience is spent. The settlement is abandoned.`, 'bad')
    return
  }
  if (population(s) === 0) {
    s.phase = 'lost'
    pushLog(s, `The last villager has gone. Nothing remains but the cold hearth.`, 'bad')
  }
}
