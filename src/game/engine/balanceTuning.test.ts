import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../content/buildings'
import { SPECIES } from '../content/species'
import {
  DECREE_MISS_ESCALATION,
  DECREE_MISS_IMPATIENCE,
  FOOD_VARIETY_CAP,
  HOSTILITY_SQUEEZE_THRESHOLD,
  RESOLVE_COMFORT,
  RESOLVE_HOUSED,
  RESOLVE_PER_FOOD_VARIETY,
  RESOLVE_PER_HOSTILITY,
  RESOLVE_PER_HOSTILITY_LATE,
  RESOLVE_PER_NEED,
  hostilityResolvePenalty,
} from './balance'
import { createRun } from './createRun'
import { takeChoice } from './events'
import { computeModifiers } from './modifiers'
import { resolveBreakdowns } from './society'
import { decreeMissImpatience, stepDecree } from './structure'
import { needFloor } from './traits'
import type { RoyalDecree, RunState, SpeciesId } from '../types'

/**
 * The tuning that pulled the balance harness off its win-rate ceiling and
 * closed the gap between species trios: a hostility squeeze that only bites
 * once the forest has closed in, decree misses that escalate, and harpies who
 * meet part of their Education need among themselves.
 */

function newRun(species: SpeciesId[] = ['human', 'fox', 'harpy']): RunState {
  const state = createRun({ seed: 2024, species, modifiers: [] })
  while (state.pendingChoices.length > 0) takeChoice(state, state.pendingChoices[0].options[0])
  return state
}

function breakdownOf(state: RunState, species: SpeciesId) {
  return resolveBreakdowns(state, computeModifiers(state)).find((b) => b.species === species)!
}

function impatienceOf(state: RunState): number {
  return state.impatience + state.impatienceProgress
}

function lapsingDecree(state: RunState): RoyalDecree {
  return {
    id: `d${state.clock}`,
    defId: 'decree_glade',
    progress: 0,
    complete: false,
    timeLeft: 0.1,
    timeLimit: 270,
    baseline: state.stats.gladesCleared,
  }
}

describe('hostility squeeze', () => {
  it('leaves the opening alone and tightens once the forest closes in', () => {
    // Up to the threshold it is the old linear drag, so a newcomer's first
    // Storm (hostility ~10-15 without much clearing) feels no change.
    for (const h of [0, 5, HOSTILITY_SQUEEZE_THRESHOLD]) {
      expect(hostilityResolvePenalty(h)).toBeCloseTo(h * RESOLVE_PER_HOSTILITY)
    }
    // Past it, each point costs the late rate on top.
    const h = HOSTILITY_SQUEEZE_THRESHOLD + 30
    expect(hostilityResolvePenalty(h)).toBeCloseTo(
      h * RESOLVE_PER_HOSTILITY + 30 * RESOLVE_PER_HOSTILITY_LATE,
    )
    // Monotonic: more hostility never hurts less.
    let last = -1
    for (let x = 0; x <= 100; x += 5) {
      expect(hostilityResolvePenalty(x)).toBeGreaterThan(last)
      last = hostilityResolvePenalty(x)
    }
    // A late-game forest is still outrun by serving people: a housed, fed
    // species with both needs met clears the strictest threshold at 70.
    const strictest = Math.max(...Object.values(SPECIES).map((d) => d.resolveTarget))
    for (const def of Object.values(SPECIES)) {
      const served =
        def.baseResolve +
        2 * RESOLVE_PER_NEED +
        RESOLVE_HOUSED +
        RESOLVE_COMFORT +
        FOOD_VARIETY_CAP * RESOLVE_PER_FOOD_VARIETY
      expect(served - hostilityResolvePenalty(70), def.id).toBeGreaterThan(strictest)
    }
  })

  it('is the hostility term every species sees in its resolve breakdown', () => {
    const state = newRun()
    state.hostility = 55
    for (const b of resolveBreakdowns(state, computeModifiers(state))) {
      expect(b.hostility).toBeCloseTo(-hostilityResolvePenalty(55))
    }
  })
})

describe('decree strikes', () => {
  it('makes each unanswered miss cost more than the last', () => {
    const state = newRun()
    const mods = computeModifiers(state)
    const costs: number[] = []
    for (let i = 0; i < 3; i++) {
      state.decree = lapsingDecree(state)
      const before = impatienceOf(state)
      stepDecree(state, 0.125)
      costs.push(impatienceOf(state) - before)
    }
    const base = DECREE_MISS_IMPATIENCE * mods.decreeMissPenalty
    const step = DECREE_MISS_ESCALATION * mods.decreeMissPenalty
    expect(costs[0]).toBeCloseTo(base)
    expect(costs[1]).toBeCloseTo(base + step)
    expect(costs[2]).toBeCloseTo(base + 2 * step)
    expect(state.decreeStrikes).toBe(3)
  })

  it('forgives one strike for every decree met', () => {
    const state = newRun()
    state.decreeStrikes = 2
    state.storageCap = 999
    state.decree = {
      id: 'dmet',
      defId: 'decree_planks',
      progress: 0,
      complete: false,
      timeLeft: 100,
      timeLimit: 240,
      baseline: state.producedTotals.plank ?? 0,
    }
    state.producedTotals.plank = (state.producedTotals.plank ?? 0) + 30
    stepDecree(state, 0.125)
    expect(state.decreeStrikes).toBe(1)
    // The decree card quotes exactly what the next miss will cost.
    const mods = computeModifiers(state)
    expect(decreeMissImpatience(state)).toBeCloseTo(
      (DECREE_MISS_IMPATIENCE + DECREE_MISS_ESCALATION) * mods.decreeMissPenalty,
    )
  })

  it('reads a save from before strikes existed as a clean record', () => {
    const state = newRun()
    delete state.decreeStrikes
    const mods = computeModifiers(state)
    expect(decreeMissImpatience(state)).toBeCloseTo(DECREE_MISS_IMPATIENCE * mods.decreeMissPenalty)
    state.decree = lapsingDecree(state)
    stepDecree(state, 0.125)
    expect(state.decreeStrikes).toBe(1)
  })
})

describe('harpies teach one another', () => {
  it('only harpies, and only for Education, get a floor', () => {
    expect(needFloor('harpy', 'education')).toBe(0.75)
    expect(needFloor('harpy', 'rest')).toBe(0)
    for (const sp of ['human', 'beaver', 'lizard', 'fox'] as SpeciesId[]) {
      for (const need of SPECIES[sp].needs) expect(needFloor(sp, need), `${sp} ${need}`).toBe(0)
    }
  })

  it('counts Education three-quarters met without a Guild House, and no more', () => {
    const state = newRun()
    const harpy = breakdownOf(state, 'harpy')
    expect(harpy.needRatio.education).toBe(0.75)
    expect(harpy.needDetail.education).toBe(false)
    expect(harpy.needRatio.rest).toBe(0)
    expect(harpy.needs).toBeCloseTo(0.75 * RESOLVE_PER_NEED)
    expect(harpy.needsMet).toBeCloseTo(0.375)
    // Nobody else's needs move.
    expect(breakdownOf(state, 'fox').needs).toBe(0)
    expect(breakdownOf(state, 'human').needs).toBe(0)
  })

  it('gives way to a Guild House that covers more', () => {
    const state = newRun(['beaver', 'lizard', 'harpy'])
    state.buildings.guild = {
      id: 'guild',
      defId: 'guildHouse',
      pos: { x: 99, y: 99 },
      gladeId: 'glade0',
      built: true,
      buildProgress: BUILDINGS.guildHouse.buildSeconds,
      workers: [Object.keys(state.villagers)[0]],
      activeRecipeId: 'serve',
      recipeProgress: 0,
      paused: false,
      depositsInRange: {},
    }
    state.stock.scroll = 20
    const harpy = breakdownOf(state, 'harpy')
    const beaver = breakdownOf(state, 'beaver')
    // A staffed, stocked Guild House serves the small starting settlement in
    // full: the floor adds nothing on top, and beavers get the same coverage.
    expect(harpy.needRatio.education).toBe(1)
    expect(beaver.needRatio.education).toBe(1)
  })
})
