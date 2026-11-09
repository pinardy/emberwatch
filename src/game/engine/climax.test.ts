import { describe, expect, it } from 'vitest'
import { STORM_BLIGHTS } from '../content/stormBlights'
import { migrateRun } from '../persistence'
import type { RunState, Season } from '../types'
import {
  ENVOY_BLIGHT_PREP_SCALE,
  ENVOY_COLD_HEARTH_SECONDS,
  ENVOY_DREAD_OFFERING_HERBS,
  ENVOY_HOSTILITY_PER_EXTRA_BLIGHT,
  ENVOY_LATEST_ARRIVAL_SECONDS,
  ENVOY_MAX_BLIGHTS,
  ENVOY_STORM_HOSTILITY,
  ENVOY_THREAT_PACE,
  ENVOY_UNREST_MARGIN,
  ENVOY_UNREST_SECONDS,
  HEARTH_STORM_REACH_FLOOR,
  HEARTH_WARMTH_RADIUS,
  HOSTILITY_PER_STORM,
  SEASON_LENGTH,
} from './balance'
import { announceBlight, blightPrepAmount } from './blights'
import { SPECIES } from '../content/species'
import { resolveBreakdowns } from './society'
import {
  DREAD_NAME,
  dreadAt,
  envoyArrivesIn,
  envoyPopulationFloor,
  envoyRiding,
  lastStandBlights,
  lastStandOutlook,
  threatPace,
} from './climax'
import { sootheQueen } from './actions'
import { petitionOpen } from './levers'
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
    // Nothing to buy back: soothing and the Grand Petition are closed.
    s.stock.amber = 500
    expect(sootheQueen(s)).toMatch(/satisfied/)
    expect(s.stock.amber).toBe(500)
    expect(petitionOpen(s)).toBe(false)
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
    // Only the approach's rules, standing on every screen: nothing is closing in yet.
    const calm = collectWarnings(s).filter((w) => w.id.startsWith('envoy-'))
    expect(calm.map((w) => w.id)).toEqual(['envoy-hold'])
    expect(calm[0].severity).toBe('caution')
    expect(calm[0].text).toMatch(new RegExp(`keep ${envoyPopulationFloor(s.envoy!)}\\+ villagers.*the hearth lit \\(${ENVOY_COLD_HEARTH_SECONDS} s.*${ENVOY_UNREST_SECONDS} s straight`))
    s.coldHearth = true
    s.envoy!.coldSeconds = 10
    s.envoy!.unrestSeconds = 30
    while (population(s) > envoyPopulationFloor(s.envoy!)) loseVillager(s, Object.values(s.villagers)[0])
    const warnings = collectWarnings(s).filter((w) => w.id.startsWith('envoy-') && w.id !== 'envoy-hold')
    expect(warnings.map((w) => w.id).sort()).toEqual(['envoy-hearth', 'envoy-population', 'envoy-unrest'])
    expect(warnings.find((w) => w.id === 'envoy-hearth')!.text).toMatch(/20s more/)
    expect(warnings.find((w) => w.id === 'envoy-unrest')!.text).toMatch(/1m 00s more/)
  })
})

/**
 * Puts every species' resolve target `margin` above the line where it counts
 * as discontented in the last stand (a run-long effect per species), and
 * resolve itself at its target.
 */
function targetsAbove(s: RunState, margin: number): void {
  s.ongoing = s.ongoing.filter((o) => o.name !== 'test margin')
  const mods = computeModifiers(s)
  const effects = resolveBreakdowns(s, mods).map((b) => ({
    kind: 'resolveFlat' as const,
    species: b.species,
    amount: b.threshold - ENVOY_UNREST_MARGIN + margin - b.target,
  }))
  s.ongoing.push({ id: 'test-margin', name: 'test margin', icon: '', description: '', effects })
  for (const b of resolveBreakdowns(s, computeModifiers(s))) s.resolve[b.species] = b.target
}

/** The Gathering Clouds forecast standing for the envoy's Storm. */
function gatheringClouds(s: RunState): void {
  s.conditions = s.conditions.filter((c) => !c.breaksWithStorm)
  announceBlight(s, STORM_BLIGHTS.leakingRoofs, ENVOY_BLIGHT_PREP_SCALE)
  s.envoy!.lastStandForecast = true
}

const resolveWarning = (s: RunState) => collectWarnings(s).find((w) => w.id === 'envoy-resolve')

describe("the last stand's resolve, from the moment she sets out", () => {
  it('projects each species past the forecast blight, the dread and the surge — and the Storm bears it out', () => {
    const s = newRun()
    setSeason(s, 2, 'clearance', SEASON_LENGTH.clearance - 0.0625)
    s.hostility = 20
    fill(s)
    gatheringClouds(s)
    targetsAbove(s, 4)
    const outlook = lastStandOutlook(s, computeModifiers(s))!
    expect(outlook.inStand).toBe(false)
    const after = 20 + HOSTILITY_PER_STORM + ENVOY_STORM_HOSTILITY
    expect(outlook.blows.map((b) => [b.name, Math.round(b.amount)])).toEqual(
      expect.arrayContaining([
        ['Gathering Clouds', -8],
        [DREAD_NAME, -dreadAt(after)],
      ]),
    )
    // −8 and the dread take every species well under its line: unrest.
    expect(outlook.unrest).toBe(true)
    expect(outlook.discontented).toBe(population(s))
    // Into the Storm: the blight strikes, the dread settles, and each species'
    // target lands where the outlook said it would.
    const projected = Object.fromEntries(outlook.species.map((x) => [x.species, x.projected]))
    tick(s, 0.125)
    expect(s.envoy!.finalStorm).toBe(true)
    for (const b of resolveBreakdowns(s, computeModifiers(s))) {
      expect(Math.abs(b.target - projected[b.species])).toBeLessThan(0.75)
    }
  })

  it('a settlement with room to spare is not warned', () => {
    const s = newRun()
    setSeason(s, 2, 'clearance', 10)
    s.hostility = 20
    fill(s)
    gatheringClouds(s)
    targetsAbove(s, 20)
    expect(lastStandOutlook(s, computeModifiers(s))!.unrest).toBe(false)
    expect(resolveWarning(s)).toBeUndefined()
  })

  it('warns who would fall, how many of how many, and the way out — the blight’s goods, the dread’s herbs, the needs', () => {
    const s = newRun()
    setSeason(s, 2, 'clearance', 10)
    s.hostility = 20
    fill(s)
    gatheringClouds(s)
    targetsAbove(s, 4)
    const w = resolveWarning(s)!
    expect(w.severity).toBe('caution')
    const pop = population(s)
    const names = s.speciesPool.map((sp) => SPECIES[sp].name)
    expect(w.text).toContain('In the last stand, Gathering Clouds −8')
    expect(w.text).toMatch(new RegExp(`${DREAD_NAME} −\\d`))
    expect(w.text).toContain(`(${pop} of ${pop} villagers) in unrest`)
    for (const name of names) expect(w.text).toContain(name)
    const planks = (s.conditions.find((c) => c.breaksWithStorm)!.resolveBy as { amount: number }).amount
    expect(w.text).toContain(`Make ${planks} more Planks to turn Gathering Clouds aside (+8)`)
    expect(w.text).toContain(`${ENVOY_DREAD_OFFERING_HERBS} herbs gathered in the Storm lift the dread`)
    // A minute from the Storm it is a danger.
    s.season.elapsed = s.season.length - 30
    expect(resolveWarning(s)!.severity).toBe('danger')
  })

  it('before the blights are forecast, warns when one resolve blight would tip it', () => {
    const s = newRun()
    setSeason(s, 2, 'drizzle', 10)
    s.hostility = 10
    fill(s)
    s.conditions = s.conditions.filter((c) => !c.breaksWithStorm)
    // Enough to ride out the dread, not the dread and Gathering Clouds together.
    targetsAbove(s, 7)
    const outlook = lastStandOutlook(s, computeModifiers(s))!
    expect(outlook.unforecast).toBe(1)
    expect(outlook.unrest).toBe(false)
    const w = resolveWarning(s)!
    expect(w.severity).toBe('caution')
    expect(w.text).toMatch(/names its last-stand blight at the Clearance/)
    expect(w.text).toMatch(/Gathering Clouds −8\) would leave .* in unrest/)
  })

  it('in the last stand, unrest names who and what, and what lifts it; she may arrive first', () => {
    const s = newRun()
    setSeason(s, 2, 'clearance', SEASON_LENGTH.clearance - 0.0625)
    s.hostility = 20
    fill(s)
    gatheringClouds(s)
    targetsAbove(s, 4)
    s.stock.plank = 3
    tick(s, 0.125)
    expect(s.envoy!.finalStorm).toBe(true)
    for (const sp of s.speciesPool) s.resolve[sp] = 0
    s.envoy!.unrestSeconds = 30
    const w = collectWarnings(s).find((x) => x.id === 'envoy-unrest')!
    expect(w.severity).toBe('danger')
    expect(w.text).toMatch(/^🐎 Unrest: .* \(\d+ of \d+ villagers\) are discontented under Leaking Roofs −8 and The Forest's Dread −\d/)
    expect(w.text).toContain('1m 00s more of this and the settlement breaks up')
    expect(w.text).toContain('12 Planks in store lift Leaking Roofs (you have 3) (+8)')
    // With the Storm nearly over, she arrives before the clock runs out.
    s.season.elapsed = s.season.length - 20
    const late = collectWarnings(s).find((x) => x.id === 'envoy-unrest')!
    expect(late.severity).toBe('caution')
    expect(late.text).toMatch(/but the envoy arrives in \S*20s, before it can break the settlement .*Hold on\./)
  })

  it('the end screen names the blight, the dread and who fell into unrest', () => {
    const s = newRun()
    setSeason(s, 2, 'clearance', SEASON_LENGTH.clearance - 0.0625)
    s.hostility = 20
    fill(s)
    gatheringClouds(s)
    targetsAbove(s, 4)
    s.stock.plank = 0
    tick(s, 0.125)
    for (let t = 0; t < ENVOY_UNREST_SECONDS + 5 && s.phase === 'playing'; t += 0.5) {
      while (s.pendingChoices.length > 0) takeChoice(s, s.pendingChoices[0].options[0])
      for (const sp of s.speciesPool) s.resolve[sp] = 0
      s.stock.wood = 200
      s.stock.plank = 0
      tick(s, 0.5)
    }
    expect(s.envoy!.collapse).toBe('unrest')
    expect(s.envoy!.unrest!.species).toEqual(s.speciesPool)
    expect(s.envoy!.unrest!.blows.map((b) => b.name)).toEqual(['Leaking Roofs', DREAD_NAME])
    const text = describeOutcome(s)
    expect(text).toMatch(/most of the settlement fell into unrest \(.+, under Leaking Roofs −8 and The Forest's Dread −\d\)/)
    for (const sp of s.speciesPool) expect(text).toContain(SPECIES[sp].name)
    // It survives a save; a mangled one is dropped, the collapse kept.
    expect(migrateRun(JSON.parse(JSON.stringify(s)))!.envoy!.unrest).toEqual(s.envoy!.unrest)
    const bad = JSON.parse(JSON.stringify(s)) as RunState
    ;(bad.envoy as unknown as { unrest: unknown }).unrest = { species: 'all' }
    const fixed = migrateRun(bad)!
    expect(fixed.envoy!.unrest).toBeUndefined()
    expect(fixed.envoy!.collapse).toBe('unrest')
  })
})

describe('the court falls quiet while the envoy rides', () => {
  it('a decree on offer or running, and order offers, are set aside without cost; no new decree comes', () => {
    const s = newRun()
    setSeason(s, 2, 'drizzle', 10)
    s.decreeTimer = 0.01
    tick(s, 0.125)
    expect(s.pendingChoices.some((c) => c.kind === 'decree')).toBe(true)
    s.orderOffers = [{ kind: 'order', options: ['x'], orders: [] }]
    const impatience = s.impatience + s.impatienceProgress
    fill(s)
    tick(s, 0.125)
    expect(s.pendingChoices).toEqual([])
    expect(s.orderOffers).toEqual([])
    expect(s.log.some((l) => /court falls quiet/.test(l.text))).toBe(true)
    // A live decree is withdrawn, with no penalty.
    const t = newRun()
    setSeason(t, 2, 'drizzle', 10)
    t.decreeTimer = 0.01
    tick(t, 0.125)
    takeChoice(t, t.pendingChoices[0].options[0])
    expect(t.decree).not.toBeNull()
    const strikes = t.decreeStrikes ?? 0
    fill(t)
    tick(t, 0.125)
    expect(t.decree).toBeNull()
    expect(t.decreeStrikes ?? 0).toBe(strikes)
    expect(t.log.some((l) => /herald withdraws the decree/.test(l.text))).toBe(true)
    // However long she rides, no herald comes.
    for (let i = 0; i < 400 && t.phase === 'playing'; i++) {
      t.stock.wood = 200
      t.stock.berry = 200
      for (const sp of t.speciesPool) t.resolve[sp] = 60
      tick(t, 0.5)
      expect(t.pendingChoices.some((c) => c.kind === 'decree')).toBe(false)
      expect(t.decree).toBeNull()
    }
    expect(s.impatience + s.impatienceProgress).toBeCloseTo(impatience)
  })
})
