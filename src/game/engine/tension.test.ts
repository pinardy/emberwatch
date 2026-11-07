import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../content/buildings'
import type { Glade, RunState } from '../types'
import { addClearer, isReachable, reclaimGlade, spareGlade } from './actions'
import {
  FROST_EXPOSURE_PER_LOSS,
  HEARTH_REACH_STEP,
  HEARTH_STORM_REACH_FLOOR,
  HEARTH_WARMTH_RADIUS,
  HOSTILITY_RATE_PER_CLEARED_GLADE,
  IMPATIENCE_PER_VILLAGER_LOST,
  IMPATIENCE_STAGNATION_GRACE,
  IMPATIENCE_STAGNATION_MAX,
  IMPATIENCE_STAGNATION_RAMP,
  RESOLVE_COLD_HOME,
  RESOLVE_EXPECTATION_CROWD_FROM,
  RESOLVE_EXPECTATION_PER_VILLAGER,
  RESOLVE_EXPECTATION_PER_YEAR,
  SPARED_GLADE_RECLAIM_HOSTILITY,
} from './balance'
import { createRun } from './createRun'
import { collectWarnings } from './diagnostics'
import { addVillager, takeChoice } from './events'
import { gladeAt } from './mapgen'
import { computeModifiers } from './modifiers'
import {
  HEARTH_STORM_END_REACH,
  hearthReachAt,
  hearthWarmthRadius,
  isWarmAt,
  population,
  totalHousing,
  warmthSources,
} from './queries'
import {
  coldVillagers,
  expectations,
  impatienceParts,
  impatienceRate,
  noteReputation,
  resolveBreakdowns,
  secondsSinceReputation,
  stagnationImpatienceRate,
  stepFrost,
} from './society'
import { tick } from './tick'
import { hostilityGrowth, hostilityRate, sparedGladeCalmOf } from './hostility'

/**
 * Mid-run tension: a Queen who minds reputation standing still, expectations
 * that rise with the years, glades that can be left to the forest, and a
 * Storm whose cold reaches further into a sprawling settlement.
 */

const SEED = 4711

/** A run past its opening drafts, with no map modifiers to bend the rules. */
function newRun(): RunState {
  const s = createRun({ seed: SEED, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  let guard = 0
  while (s.pendingChoices.length > 0 && guard++ < 20) {
    takeChoice(s, s.pendingChoices[0].options[0])
  }
  return s
}

/** Drops a finished building at an exact spot, bypassing placement rules. */
function put(s: RunState, defId: string, pos: { x: number; y: number }) {
  const id = `test_${defId}_${Object.keys(s.buildings).length}`
  s.buildings[id] = {
    id,
    defId,
    pos,
    gladeId: gladeAt(s.glades, pos)?.id ?? Object.keys(s.glades)[0],
    built: true,
    buildProgress: BUILDINGS[defId].buildSeconds,
    workers: [],
    activeRecipeId: BUILDINGS[defId].recipes[0]?.id ?? '',
    recipeProgress: 0,
    paused: false,
    depositsInRange: {},
  }
  return s.buildings[id]
}

/** An uncleared glade on the settlement's border. */
function borderGlade(s: RunState, kind: Glade['kind'] = 'small'): Glade {
  const glade = Object.values(s.glades).find(
    (g) => !g.cleared && g.kind === kind && isReachable(s, g.id),
  )
  if (!glade) throw new Error(`no reachable ${kind} glade on seed ${SEED}`)
  return glade
}

describe('the Queen minds reputation standing still', () => {
  it('adds nothing within the grace, then a rate that grows and is capped', () => {
    const s = newRun()
    s.reputationRise = { at: 0, level: s.reputation }
    s.clock = IMPATIENCE_STAGNATION_GRACE - 1
    expect(stagnationImpatienceRate(s)).toBe(0)
    s.clock = IMPATIENCE_STAGNATION_GRACE + 60
    expect(stagnationImpatienceRate(s)).toBeCloseTo(60 * IMPATIENCE_STAGNATION_RAMP)
    s.clock = IMPATIENCE_STAGNATION_GRACE + 120
    expect(stagnationImpatienceRate(s)).toBeCloseTo(
      Math.min(IMPATIENCE_STAGNATION_MAX, 120 * IMPATIENCE_STAGNATION_RAMP),
    )
    s.clock = IMPATIENCE_STAGNATION_GRACE + 100_000
    expect(stagnationImpatienceRate(s)).toBe(IMPATIENCE_STAGNATION_MAX)
  })

  it('eases the moment reputation rises, from orders and choices as much as resolve', () => {
    const s = newRun()
    s.reputationRise = { at: 0, level: s.reputation }
    s.clock = 1000
    expect(stagnationImpatienceRate(s)).toBeGreaterThan(0)
    // A point from anywhere — here, straight onto the meter, as an order does.
    s.reputation += 1
    tick(s, 0.125)
    expect(secondsSinceReputation(s)).toBeLessThan(0.2)
    expect(stagnationImpatienceRate(s)).toBe(0)
    expect(s.reputationRise?.level).toBe(s.reputation)
  })

  it('is part of the impatience rate, named apart from the calendar', () => {
    const s = newRun()
    const mods = computeModifiers(s)
    s.reputationRise = { at: s.clock, level: s.reputation }
    const calm = impatienceRate(s, mods)
    expect(impatienceParts(s, mods).stagnation).toBe(0)
    s.reputationRise = { at: s.clock - IMPATIENCE_STAGNATION_GRACE - 100, level: s.reputation }
    const parts = impatienceParts(s, mods)
    expect(parts.stagnation).toBeCloseTo(
      100 * IMPATIENCE_STAGNATION_RAMP * mods.impatienceRate,
    )
    expect(parts.total).toBeCloseTo(
      parts.calendar + parts.hostility + parts.stalling + parts.stagnation + parts.deadline,
    )
    expect(impatienceRate(s, mods)).toBeCloseTo(calm + parts.stagnation)
  })

  it('starts counting when an older save first ticks, not from the start of the run', () => {
    const s = newRun()
    delete s.reputationRise
    s.clock = 2000
    expect(stagnationImpatienceRate(s)).toBe(0)
    noteReputation(s)
    expect(s.reputationRise).toEqual({ at: 2000, level: s.reputation })
    expect(stagnationImpatienceRate(s)).toBe(0)
  })

  it('fills the meter over a long stall that an earning settlement never sees', () => {
    const stalled = newRun()
    const earning = newRun()
    for (const s of [stalled, earning]) s.reputationRise = { at: 0, level: s.reputation }
    stalled.clock = earning.clock = 600
    // The earning settlement scored a point a minute ago.
    earning.reputationRise = { at: 540, level: earning.reputation }
    const mods = computeModifiers(stalled)
    expect(impatienceParts(stalled, mods).stagnation).toBeGreaterThan(0)
    expect(impatienceParts(earning, mods).stagnation).toBe(0)
  })
})

describe('rising expectations', () => {
  it('ask nothing in Year 1, then more each year and of a bigger settlement', () => {
    const s = newRun()
    s.season.year = 1
    expect(expectations(s, 6)).toBe(0)
    s.season.year = 3
    expect(expectations(s, 6)).toBeCloseTo(2 * RESOLVE_EXPECTATION_PER_YEAR)
    expect(
      expectations(s, RESOLVE_EXPECTATION_CROWD_FROM + 10) -
        expectations(s, RESOLVE_EXPECTATION_CROWD_FROM),
    ).toBeCloseTo(10 * RESOLVE_EXPECTATION_PER_VILLAGER)
    expect(expectations(s, RESOLVE_EXPECTATION_CROWD_FROM - 3)).toBeCloseTo(
      2 * RESOLVE_EXPECTATION_PER_YEAR,
    )
  })

  it('lower a species’ resolve target by the share of its needs met, and say by how much', () => {
    const s = newRun()
    const mods = computeModifiers(s)
    s.season.year = 1
    const before = resolveBreakdowns(s, mods)
    expect(before.every((b) => b.expectations === 0)).toBe(true)
    s.season.year = 4
    const after = resolveBreakdowns(s, mods)
    const owed = expectations(s)
    expect(owed).toBeGreaterThan(0)
    after.forEach((b, i) => {
      expect(b.expectations).toBeCloseTo(-owed * b.needsMet)
      expect(b.target).toBeCloseTo(before[i].target - owed * b.needsMet)
    })
    // A species with every need met (here, by a cornerstone that waives them
    // all) feels the whole of it; one with none met feels none.
    s.ongoing.push({
      id: 'test',
      name: 'Every need waived',
      icon: '✨',
      description: '',
      effects: [{ kind: 'needsFewerServices', species: 'all', amount: 9 }],
    })
    const served = resolveBreakdowns(s, computeModifiers(s))
    for (const b of served) {
      expect(b.needsMet).toBe(1)
      expect(b.expectations).toBeCloseTo(-owed)
    }
  })
})

describe('leaving a glade to the forest', () => {
  it('calls the crew home, blocks clearing and calms hostility while it stands', () => {
    const s = newRun()
    const glade = borderGlade(s)
    const mods = computeModifiers(s)
    expect(addClearer(s, glade.id)).toBeNull()
    const before = hostilityRate(s, mods.hostilityRate)

    expect(spareGlade(s, glade.id)).toBeNull()
    expect(glade.spared).toBe(true)
    expect(glade.clearers).toBe(0)
    expect(Object.values(s.villagers).some((v) => v.assignment === `clearing:${glade.id}`)).toBe(
      false,
    )
    expect(addClearer(s, glade.id)).toMatch(/forest/)
    expect(sparedGladeCalmOf(glade.kind)).toBeGreaterThan(0)
    expect(hostilityRate(s, mods.hostilityRate)).toBeCloseTo(
      before - sparedGladeCalmOf(glade.kind),
    )
    // A wilder glade calms more.
    expect(sparedGladeCalmOf('forbidden')).toBeGreaterThan(sparedGladeCalmOf('dangerous'))
    expect(sparedGladeCalmOf('dangerous')).toBeGreaterThan(sparedGladeCalmOf('small'))
  })

  it('only spares an uncleared glade on the border, once', () => {
    const s = newRun()
    expect(spareGlade(s, 'glade0')).not.toBeNull()
    const far = Object.values(s.glades).find((g) => !g.cleared && !isReachable(s, g.id))!
    expect(spareGlade(s, far.id)).not.toBeNull()
    expect(far.spared).toBeFalsy()
    const glade = borderGlade(s)
    expect(spareGlade(s, glade.id)).toBeNull()
    expect(spareGlade(s, glade.id)).not.toBeNull()
    expect(spareGlade(s, 'nope')).not.toBeNull()
  })

  it('can be undone, but breaking the truce angers the forest', () => {
    const s = newRun()
    const glade = borderGlade(s)
    expect(reclaimGlade(s, glade.id)).not.toBeNull()
    spareGlade(s, glade.id)
    s.hostility = 10
    expect(reclaimGlade(s, glade.id)).toBeNull()
    expect(glade.spared).toBe(false)
    expect(s.hostility).toBeCloseTo(10 + SPARED_GLADE_RECLAIM_HOSTILITY)
    expect(addClearer(s, glade.id)).toBeNull()
  })

  it('enough of them turn the forest back, and the tick applies it', () => {
    const s = newRun()
    const mods = computeModifiers(s)
    for (const g of Object.values(s.glades)) {
      if (!g.cleared && g.kind !== 'settlement') g.spared = true
    }
    expect(hostilityRate(s, mods.hostilityRate)).toBeLessThan(0)
    s.hostility = 20
    tick(s, 10)
    expect(s.hostility).toBeLessThan(20)
  })

  it('every glade reclaimed makes the forest grow faster for the rest of the run', () => {
    const s = newRun()
    const mods = computeModifiers(s)
    s.stats.gladesCleared = 0
    const wild = hostilityGrowth(s, mods.hostilityRate)
    s.stats.gladesCleared = 10
    expect(hostilityGrowth(s, mods.hostilityRate)).toBeCloseTo(
      wild * (1 + 10 * HOSTILITY_RATE_PER_CLEARED_GLADE),
    )
  })
})

describe('the Storm pulls the hearth’s warmth in', () => {
  /** A Storm settlement with a shelter beyond the hearth and people in it. */
  function coldSuburb() {
    const s = newRun()
    const shelter = put(s, 'shelter', { x: HEARTH_WARMTH_RADIUS + 4, y: 0 })
    while (population(s) <= 6) addVillager(s)
    s.season.season = 'storm'
    s.season.elapsed = 0
    s.stock.wood = 50
    return { s, shelter }
  }

  it('holds its reach outside the Storm and shrinks in steps to the floor by its end', () => {
    const s = newRun()
    s.season.season = 'clearance'
    expect(hearthWarmthRadius(s)).toBe(HEARTH_WARMTH_RADIUS)
    s.season.season = 'storm'
    s.season.elapsed = 0
    expect(hearthWarmthRadius(s)).toBe(HEARTH_WARMTH_RADIUS)
    let last = HEARTH_WARMTH_RADIUS
    for (let i = 1; i <= 20; i++) {
      s.season.elapsed = (s.season.length * i) / 20
      const r = hearthWarmthRadius(s)
      expect(r).toBeLessThanOrEqual(last)
      expect((r / HEARTH_REACH_STEP) % 1).toBeCloseTo(0)
      last = r
    }
    expect(last).toBeCloseTo(HEARTH_WARMTH_RADIUS * HEARTH_STORM_REACH_FLOOR)
    expect(HEARTH_STORM_END_REACH).toBeCloseTo(hearthReachAt(1))
    // The maps draw the hearth's ring from the same source.
    expect(warmthSources(s).find((w) => w.kind === 'hearth')?.radius).toBe(last)
  })

  it('leaves a home on the edge warm early in the Storm and cold late in it', () => {
    const s = newRun()
    const edge = { x: HEARTH_WARMTH_RADIUS - 0.4, y: 0 }
    put(s, 'shelter', edge)
    // Every bed taken: villagers fill warm homes first, so the edge home's
    // residents are the ones left out when the reach pulls in.
    while (population(s) < totalHousing(s)) addVillager(s)
    s.season.season = 'storm'
    s.season.elapsed = 0
    expect(isWarmAt(s, edge)).toBe(true)
    expect(coldVillagers(s)).toBe(0)
    s.season.elapsed = s.season.length * 0.95
    expect(isWarmAt(s, edge)).toBe(false)
    expect(coldVillagers(s)).toBeGreaterThan(0)
  })

  it('chills resolve by the exposed share, shown as its own term', () => {
    const { s } = coldSuburb()
    const pop = population(s)
    const cold = coldVillagers(s)
    expect(cold).toBeGreaterThan(0)
    const b = resolveBreakdowns(s, computeModifiers(s))[0]
    expect(b.chill).toBeCloseTo(RESOLVE_COLD_HOME * (cold / pop))
    expect(b.penalties).toBeLessThanOrEqual(b.chill)
  })

  it('takes a villager once enough exposure builds, and the Queen notices', () => {
    const { s } = coldSuburb()
    const cold = coldVillagers(s)
    const pop = population(s)
    const lost = s.stats.villagersLost
    const impatience = s.impatience + s.impatienceProgress
    expect(stepFrost(s, FROST_EXPOSURE_PER_LOSS / cold - 0.5)).toHaveLength(0)
    expect(population(s)).toBe(pop)
    expect(collectWarnings(s).some((w) => w.id === 'frost')).toBe(true)
    const said = stepFrost(s, 1)
    expect(said).toHaveLength(1)
    expect(said[0]).toMatch(/cold/)
    expect(population(s)).toBe(pop - 1)
    expect(s.stats.villagersLost).toBe(lost + 1)
    expect(s.impatience + s.impatienceProgress).toBeCloseTo(
      impatience + IMPATIENCE_PER_VILLAGER_LOST,
    )
  })

  it('spares lizards, who shrug off the cold', () => {
    const { s } = coldSuburb()
    for (const v of Object.values(s.villagers)) v.species = 'lizard'
    const pop = population(s)
    stepFrost(s, FROST_EXPOSURE_PER_LOSS * 5)
    expect(population(s)).toBe(pop)
  })

  it('forgets exposure when the Storm passes', () => {
    const { s } = coldSuburb()
    stepFrost(s, 10)
    expect(s.frostExposure ?? 0).toBeGreaterThan(0)
    s.season.season = 'drizzle'
    stepFrost(s, 1)
    expect(s.frostExposure ?? 0).toBe(0)
    expect(coldVillagers(s)).toBe(0)
  })

  it('a lit brazier keeps them safe', () => {
    const { s, shelter } = coldSuburb()
    put(s, 'brazier', { x: shelter.pos.x + 1.2, y: shelter.pos.y })
    expect(coldVillagers(s)).toBe(0)
    const pop = population(s)
    stepFrost(s, FROST_EXPOSURE_PER_LOSS * 5)
    expect(population(s)).toBe(pop)
  })

  it('warns at Clearance about villagers the Storm will leave in the cold', () => {
    const s = newRun()
    put(s, 'shelter', { x: HEARTH_STORM_END_REACH + 0.6, y: 0 })
    s.season.season = 'clearance'
    // Room to spare in warm homes: nobody need sleep out there.
    while (population(s) > 1) delete s.villagers[Object.keys(s.villagers)[0]]
    expect(collectWarnings(s).some((w) => w.id === 'frost-forecast')).toBe(false)
    while (population(s) < totalHousing(s)) addVillager(s)
    expect(collectWarnings(s).some((w) => w.id === 'frost-forecast')).toBe(true)
    s.season.season = 'drizzle'
    expect(collectWarnings(s).some((w) => w.id === 'frost-forecast')).toBe(false)
  })
})
