import { describe, expect, it } from 'vitest'
import { STORM_BLIGHTS } from '../content/stormBlights'
import { migrateRun } from '../persistence'
import type { RunState, Season } from '../types'
import {
  ENVOY_BLIGHT_PREP_SCALE,
  ENVOY_COLD_HEARTH_SECONDS,
  ENVOY_HOSTILITY_PER_EXTRA_BLIGHT,
  ENVOY_LATEST_ARRIVAL_SECONDS,
  ENVOY_MAX_BLIGHTS,
  ENVOY_STORM_HOSTILITY,
  ENVOY_THREAT_PACE,
  ENVOY_UNREST_SECONDS,
  HEARTH_STORM_REACH_FLOOR,
  HEARTH_WARMTH_RADIUS,
  HOSTILITY_PER_STORM,
  SEASON_LENGTH,
} from './balance'
import { blightPrepAmount } from './blights'
import {
  DREAD_NAME,
  dreadAt,
  envoyArrivesIn,
  envoyPopulationFloor,
  envoyRiding,
  lastStandBlights,
  threatPace,
} from './climax'
import { createRun } from './createRun'
import { collectWarnings } from './diagnostics'
import { addVillager } from './newcomers'
import { takeChoice } from './drafts'
import { computeModifiers } from './modifiers'
import { hearthReachAt, hearthWarmthRadius, population, stormEndReach } from './queries'
import { gainReputation } from './reputation'
import { addImpatience, loseVillager } from './society'
import { tick } from './tick'
import { describeOutcome } from './timeline'

/**
 * The climax: reaching the maximum reputation sends the Queen's envoy, who
 * arrives as the next Storm ends. Until then the Queen's impatience does not
 * matter, the forest makes its last stand, and a collapse loses the run.
 */

const SEED = 4711

function newRun(): RunState {
  const s = createRun({ seed: SEED, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  let guard = 0
  while (s.pendingChoices.length > 0 && guard++ < 20) takeChoice(s, s.pendingChoices[0].options[0])
  s.stock.wood = 400
  s.stock.berry = 400
  return s
}

function setSeason(s: RunState, year: number, season: Season, elapsed = 0): void {
  s.season = { year, season, elapsed, length: SEASON_LENGTH[season] }
}

/** Fills reputation the way play does: a grant that tips the meter over. */
function fill(s: RunState): void {
  s.reputation = s.maxReputation - 1
  s.reputationProgress = 0
  gainReputation(s, 1, 'orders')
}

/**
 * Ticks a well-kept settlement until the run ends or `seconds` pass: choices
 * settled as they block the clock, the woodpile and larder full, everyone
 * content.
 */
function run(s: RunState, seconds: number, step = 0.5): void {
  for (let t = 0; t < seconds && s.phase === 'playing'; t += step) {
    while (s.pendingChoices.length > 0) takeChoice(s, s.pendingChoices[0].options[0])
    s.stock.wood = Math.max(s.stock.wood ?? 0, 200)
    s.stock.berry = Math.max(s.stock.berry ?? 0, 200)
    for (const sp of s.speciesPool) s.resolve[sp] = 60
    tick(s, step)
  }
}

describe('the envoy sets out', () => {
  it('when reputation fills: the run goes on, logged and marked on the timeline', () => {
    const s = newRun()
    setSeason(s, 2, 'drizzle', 10)
    fill(s)
    expect(s.reputation).toBe(s.maxReputation)
    expect(s.envoy).toMatchObject({ year: 2, finalStorm: false, glory: 0 })
    expect(s.envoy!.population).toBe(population(s))
    expect(s.timeline.events.some((e) => e.k === 'envoy')).toBe(true)
    expect(s.log[0].text).toMatch(/envoy sets out.*next Storm ends/)
    tick(s, 0.125)
    expect(s.phase).toBe('playing')
    expect(envoyRiding(s)).toBe(true)
  })

  it("stops the Queen's impatience mattering: it no longer moves, and a full meter does not lose", () => {
    const s = newRun()
    s.impatience = 5
    s.impatienceProgress = 0.5
    fill(s)
    addImpatience(s, 3)
    run(s, 20)
    expect(s.impatience).toBe(5)
    expect(s.impatienceProgress).toBeCloseTo(0.5)
    s.impatience = s.maxImpatience
    tick(s, 0.125)
    expect(s.phase).toBe('playing')
  })

  it('banks anything earned past the maximum as Glory, tallied by source', () => {
    const s = newRun()
    s.reputation = s.maxReputation - 1
    s.reputationProgress = 0.5
    gainReputation(s, 1, 'orders')
    expect(s.envoy!.glory).toBeCloseTo(0.5)
    gainReputation(s, 2, 'decrees')
    expect(s.reputation).toBe(s.maxReputation)
    expect(s.envoy!.glory).toBeCloseTo(2.5)
    expect(s.reputationBy).toMatchObject({ orders: 1, decrees: 2 })
  })

  it('a hand-set full meter without an envoy sends her on the next tick', () => {
    const s = newRun()
    s.reputation = s.maxReputation
    tick(s, 0.125)
    expect(s.envoy).toBeDefined()
    expect(s.phase).toBe('playing')
  })
})

describe('the envoy arrives', () => {
  it('as the next Storm ends: the run is won in that Storm’s year, and no new year begins', () => {
    const s = newRun()
    setSeason(s, 3, 'drizzle', 100)
    fill(s)
    const mods = computeModifiers(s)
    const eta = envoyArrivesIn(s, mods)!
    expect(eta).toBeCloseTo(
      SEASON_LENGTH.drizzle - 100 + SEASON_LENGTH.clearance + SEASON_LENGTH.storm,
      0,
    )
    const start = s.clock
    run(s, eta + 5, 0.25)
    expect(s.phase).toBe('won')
    expect(s.envoy!.outcome).toBe('arrived')
    expect(s.season.year).toBe(3)
    expect(s.season.season).toBe('storm')
    expect(s.clock - start).toBeCloseTo(eta, 0)
    expect(describeOutcome(s)).toMatch(/held through the forest's last stand.*envoy arrived in Year 3/)
  })

  it('mid-Storm: not this Storm but the next — a whole year of warning', () => {
    const s = newRun()
    setSeason(s, 2, 'storm', SEASON_LENGTH.storm - 10)
    fill(s)
    const eta = envoyArrivesIn(s, computeModifiers(s))!
    expect(eta).toBeCloseTo(10 + SEASON_LENGTH.drizzle + SEASON_LENGTH.clearance + SEASON_LENGTH.storm, 0)
    run(s, 15, 0.25)
    expect(s.phase).toBe('playing')
    expect(s.season).toMatchObject({ year: 3, season: 'drizzle' })
    expect(s.envoy!.finalStorm).toBe(false)
    run(s, eta, 0.25)
    expect(s.phase).toBe('won')
    expect(s.season.year).toBe(3)
  })

  it('by the Queen’s latest day at the most, so every run still ends in time', () => {
    const s = newRun()
    setSeason(s, 6, 'drizzle', 10)
    s.clock = ENVOY_LATEST_ARRIVAL_SECONDS - 30
    fill(s)
    expect(envoyArrivesIn(s, computeModifiers(s))).toBeCloseTo(30, 0)
    run(s, 40, 0.25)
    expect(s.phase).toBe('won')
    expect(s.clock).toBeLessThanOrEqual(ENVOY_LATEST_ARRIVAL_SECONDS + 1)
  })
})

describe("the forest's last stand", () => {
  it('a blight is certain at Clearance whatever the year or hostility, dearer to turn aside', () => {
    const s = newRun()
    setSeason(s, 1, 'drizzle', SEASON_LENGTH.drizzle - 0.0625)
    s.hostility = 0
    fill(s)
    tick(s, 0.125)
    expect(s.season.season).toBe('clearance')
    const forecasts = s.conditions.filter((c) => c.breaksWithStorm)
    expect(forecasts).toHaveLength(1)
    const def = Object.values(STORM_BLIGHTS).find((d) => d.name === forecasts[0].name)!
    const goal = forecasts[0].resolveBy as { amount: number }
    expect(goal.amount).toBe(Math.round(blightPrepAmount(s, def) * ENVOY_BLIGHT_PREP_SCALE))
  })

  it('brings more blights the angrier the forest, no two alike', () => {
    expect(lastStandBlights(0)).toBe(1)
    expect(lastStandBlights(ENVOY_HOSTILITY_PER_EXTRA_BLIGHT)).toBe(2)
    expect(lastStandBlights(500)).toBe(ENVOY_MAX_BLIGHTS)
    const s = newRun()
    setSeason(s, 3, 'drizzle', SEASON_LENGTH.drizzle - 0.0625)
    s.hostility = ENVOY_HOSTILITY_PER_EXTRA_BLIGHT * 2 + 1
    fill(s)
    tick(s, 0.125)
    const names = s.conditions.filter((c) => c.breaksWithStorm).map((c) => c.name)
    expect(names).toHaveLength(Math.min(3, ENVOY_MAX_BLIGHTS))
    expect(new Set(names).size).toBe(names.length)
  })

  it('when she set out mid-Clearance, the forest announces it with what is left of the Clearance', () => {
    const s = newRun()
    setSeason(s, 1, 'clearance', 40)
    s.hostility = 0
    fill(s)
    tick(s, 0.125)
    expect(s.conditions.filter((c) => c.breaksWithStorm)).toHaveLength(1)
    // …once: a blight turned aside is not replaced.
    s.conditions = s.conditions.filter((c) => !c.breaksWithStorm)
    tick(s, 0.125)
    expect(s.conditions.filter((c) => c.breaksWithStorm)).toHaveLength(0)
  })

  it('surges hostility, quickens threats and pulls the warm ring in further as the Storm breaks', () => {
    const s = newRun()
    setSeason(s, 2, 'clearance', SEASON_LENGTH.clearance - 0.0625)
    s.hostility = 30
    fill(s)
    s.conditions = []
    s.envoy!.lastStandForecast = true
    expect(threatPace(s)).toBe(1)
    tick(s, 0.125)
    expect(s.season.season).toBe('storm')
    expect(s.envoy!.finalStorm).toBe(true)
    expect(s.hostility).toBeGreaterThanOrEqual(30 + HOSTILITY_PER_STORM + ENVOY_STORM_HOSTILITY - 0.1)
    expect(threatPace(s)).toBe(ENVOY_THREAT_PACE)
    const dread = s.conditions.find((c) => c.name === DREAD_NAME)!
    expect(dread.passesWithStorm).toBe(true)
    expect(dread.whileActive).toEqual([{ kind: 'resolveFlat', species: 'all', amount: -dreadAt(s.hostility) }])
    expect(dreadAt(60)).toBeGreaterThan(dreadAt(20))
    s.season.elapsed = s.season.length - 0.01
    expect(hearthWarmthRadius(s)).toBeLessThan(hearthReachAt(1))
    expect(stormEndReach(s)).toBeLessThan(HEARTH_WARMTH_RADIUS * HEARTH_STORM_REACH_FLOOR)
  })
})

describe('collapse before the envoy arrives', () => {
  it('too few villagers left: the run is lost', () => {
    const s = newRun()
    setSeason(s, 2, 'drizzle', 10)
    fill(s)
    const floor = envoyPopulationFloor(s.envoy!)
    while (population(s) >= floor) loseVillager(s, Object.values(s.villagers)[0])
    tick(s, 0.125)
    expect(s.phase).toBe('lost')
    expect(s.envoy).toMatchObject({ outcome: 'collapsed', collapse: 'population' })
    expect(describeOutcome(s)).toMatch(/too many villagers were lost.*before she arrived/)
  })

  it('the hearth cold too long: the run is lost', () => {
    const s = newRun()
    setSeason(s, 2, 'storm', 5)
    fill(s)
    s.envoy!.finalStorm = true
    for (let t = 0; t <= ENVOY_COLD_HEARTH_SECONDS + 1 && s.phase === 'playing'; t += 0.5) {
      delete s.stock.wood
      tick(s, 0.5)
    }
    expect(s.phase).toBe('lost')
    expect(s.envoy!.collapse).toBe('hearth')
  })

  it('most of the settlement in unrest too long: the run is lost; a contented majority is not', () => {
    const s = newRun()
    setSeason(s, 2, 'drizzle', 10)
    fill(s)
    const [first, ...rest] = s.speciesPool
    const hold = (low: string[]) => {
      for (const sp of s.speciesPool) s.resolve[sp] = low.includes(sp) ? 0 : 60
    }
    // One species of three below its threshold is not unrest.
    for (let t = 0; t < ENVOY_UNREST_SECONDS + 5; t += 0.5) {
      hold([first])
      tick(s, 0.5)
    }
    expect(s.envoy!.outcome).toBeUndefined()
    expect(s.envoy!.unrestSeconds).toBe(0)
    for (let t = 0; t < ENVOY_UNREST_SECONDS + 5 && s.phase === 'playing'; t += 0.5) {
      hold([first, ...rest])
      tick(s, 0.5)
    }
    expect(s.phase).toBe('lost')
    expect(s.envoy!.collapse).toBe('unrest')
  })
})

describe('saves', () => {
  it('an old save still playing at the maximum ends as the win it already was', () => {
    const s = newRun()
    s.reputation = s.maxReputation
    const raw = JSON.parse(JSON.stringify(s)) as RunState
    delete raw.envoy
    const loaded = migrateRun(raw)!
    expect(loaded.phase).toBe('won')
    expect(loaded.pendingChoices).toEqual([])
  })

  it('a save made during the approach keeps it, and a mangled envoy reads as none', () => {
    const s = newRun()
    fill(s)
    const kept = migrateRun(JSON.parse(JSON.stringify(s)))!
    expect(kept.phase).toBe('playing')
    expect(kept.envoy).toEqual(s.envoy)
    const bad = JSON.parse(JSON.stringify(s)) as RunState
    bad.reputation = 3
    ;(bad as unknown as { envoy: unknown }).envoy = { setOutAt: 'soon' }
    const fixed = migrateRun(bad)!
    expect(fixed.envoy).toBeUndefined()
    expect(fixed.phase).toBe('playing')
  })
})

describe('the warning strip while the envoy rides', () => {
  it('counts down each collapse that is closing in', () => {
    const s = newRun()
    setSeason(s, 2, 'storm', 10)
    for (let i = 0; i < 6; i++) addVillager(s)
    fill(s)
    expect(collectWarnings(s).some((w) => w.id.startsWith('envoy-'))).toBe(false)
    s.coldHearth = true
    s.envoy!.coldSeconds = 10
    s.envoy!.unrestSeconds = 30
    while (population(s) > envoyPopulationFloor(s.envoy!)) loseVillager(s, Object.values(s.villagers)[0])
    const warnings = collectWarnings(s).filter((w) => w.id.startsWith('envoy-'))
    expect(warnings.map((w) => w.id).sort()).toEqual(['envoy-hearth', 'envoy-population', 'envoy-unrest'])
    expect(warnings.find((w) => w.id === 'envoy-hearth')!.text).toMatch(/20s more/)
    expect(warnings.find((w) => w.id === 'envoy-unrest')!.text).toMatch(/1m 00s more/)
  })
})
