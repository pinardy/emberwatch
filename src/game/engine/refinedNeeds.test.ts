import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../content/buildings'
import { SPECIES_LIST } from '../content/species'
import type { BuildingInstance, RunState } from '../types'
import { createRun } from './createRun'
import { computeModifiers } from './modifiers'
import { addVillager } from './newcomers'
import { population } from './queries'
import {
  REFINED_EXPECTATION_RELIEF,
  REFINED_FROM_POPULATION,
  REFINED_FROM_YEAR,
  REFINED_GOOD_SECONDS,
  REFINED_UNLOCKED_LOG,
  RESOLVE_REFINED_NEED,
  refinedCapacity,
  refinedResolve,
  refinedStatus,
  refinedUnlocked,
} from './refinedNeeds'
import { expectations, resolveBreakdowns, stepResolve } from './society'
import { discontentShare } from './climax'
import { SPECIES } from '../content/species'
import { ENVOY_UNREST_MARGIN } from './balance'
import { recipesAt } from './upgrades'

/** A settlement of humans, beavers and lizards, fed and housed, nothing built. */
function settlement(): RunState {
  const s = createRun({ seed: 7, species: ['human', 'beaver', 'lizard'] })
  s.storageCap = 9999
  s.pendingChoices = []
  return s
}

let nextId = 0
/** A finished, staffed venue (or workshop) far from everything. */
function stand(s: RunState, defId: string, tier = 0): BuildingInstance {
  const id = `t_${defId}_${nextId++}`
  const worker = Object.keys(s.villagers)[0]
  s.buildings[id] = {
    id,
    defId,
    pos: { x: 40 + nextId, y: 40 },
    gladeId: 'glade0',
    built: true,
    buildProgress: 0,
    workers: [worker],
    activeRecipeId: BUILDINGS[defId].recipes[0]?.id ?? '',
    recipeProgress: 0,
    tier,
    paused: false,
    depositsInRange: {},
  }
  return s.buildings[id]
}

/** Every service venue standing, staffed and supplied: all base needs met. */
function serveAll(s: RunState): void {
  for (const defId of ['tavern', 'temple', 'guildHouse', 'bathHouse', 'apothecary', 'arena']) {
    stand(s, defId)
    for (const good of Object.keys(BUILDINGS[defId].recipes[0].inputs)) s.stock[good as 'ale'] = 50
  }
}

const humans = (s: RunState) => resolveBreakdowns(s, computeModifiers(s)).find((b) => b.species === 'human')!
const beavers = (s: RunState) => resolveBreakdowns(s, computeModifiers(s)).find((b) => b.species === 'beaver')!

describe('refined needs: content', () => {
  it('gives every species exactly one refined form of one of its own needs', () => {
    for (const def of SPECIES_LIST) {
      expect(def.refined, def.id).toBeDefined()
      expect(def.needs, def.id).toContain(def.refined!.need)
      // A finer good handed out at the venue (or, where a def asks, a raised venue).
      expect(!!def.refined!.good || (def.refined!.venueTier ?? 0) > 0, def.id).toBe(true)
      expect(def.refined!.hint.length, def.id).toBeGreaterThan(10)
    }
  })

  it('brews spiced ale only at a Brewery raised to a Copper Still', () => {
    expect(recipesAt('brewery', 0).some((r) => r.outputs.spicedAle)).toBe(false)
    const still = recipesAt('brewery', 1).find((r) => r.outputs.spicedAle)
    expect(still?.inputs).toEqual({ ale: 2, herb: 1 })
  })
})

describe('refined needs: when they wake', () => {
  it('sleeps through Years 1 and 2 in a small settlement', () => {
    const s = settlement()
    s.season.year = REFINED_FROM_YEAR - 1
    expect(population(s)).toBeLessThan(REFINED_FROM_POPULATION)
    expect(refinedUnlocked(s)).toBe(false)
    s.season.year = REFINED_FROM_YEAR
    expect(refinedUnlocked(s)).toBe(true)
  })

  it('wakes early once the settlement reaches the population threshold', () => {
    const s = settlement()
    s.season.year = 1
    while (population(s) < REFINED_FROM_POPULATION) addVillager(s)
    expect(refinedUnlocked(s)).toBe(true)
  })

  it('pays nothing while dormant, even when the finer form is on hand', () => {
    const s = settlement()
    stand(s, 'tavern')
    s.stock.ale = 20
    s.stock.spicedAle = 20
    const b = humans(s)
    expect(b.refinedStatus?.unlocked).toBe(false)
    expect(b.refinedStatus?.met).toBe(true)
    expect(b.refined).toBe(0)
  })
})

describe('refined needs: resolve', () => {
  it('a better good: spiced ale at a serving tavern adds resolve above the base need', () => {
    const s = settlement()
    s.season.year = REFINED_FROM_YEAR
    serveAll(s)
    const without = humans(s)
    expect(without.needsMet).toBe(1)
    expect(without.needDetail.luxury).toBe(true)
    expect(without.refinedStatus?.met).toBe(false)
    expect(without.refined).toBe(0)

    s.stock.spicedAle = 10
    const withIt = humans(s)
    const owed = expectations(s)
    expect(withIt.refinedStatus?.met).toBe(true)
    expect(withIt.refined).toBeCloseTo(RESOLVE_REFINED_NEED + REFINED_EXPECTATION_RELIEF * owed)
    expect(withIt.target - without.target).toBeCloseTo(withIt.refined)
    // The base need is untouched either way.
    expect(withIt.needs).toBeCloseTo(without.needs)
  })

  it('waits for the basics: on hand, it pays nothing until every base need is met', () => {
    const s = settlement()
    s.season.year = REFINED_FROM_YEAR
    stand(s, 'tavern')
    s.stock.ale = 20
    s.stock.spicedAle = 10
    const b = humans(s)
    expect(b.needDetail.religion).toBe(false)
    expect(b.refinedStatus?.met).toBe(true)
    expect(b.refinedStatus?.basicsMet).toBe(false)
    expect(b.refined).toBe(0)
    stepResolve(s, 1, computeModifiers(s))
    expect(s.feats?.refinedMet).toBeUndefined()
    stand(s, 'temple')
    s.stock.incense = 20
    expect(humans(s).refined).toBeGreaterThan(RESOLVE_REFINED_NEED)
  })

  it('needs the base venue serving: spiced ale with a dry tavern meets nothing', () => {
    const s = settlement()
    s.season.year = REFINED_FROM_YEAR
    stand(s, 'tavern')
    s.stock.spicedAle = 10
    const b = humans(s)
    expect(b.needDetail.luxury).toBe(false)
    expect(b.refinedStatus?.ratio).toBe(0)
    expect(b.refined).toBe(0)
  })

  it('a second new good: the beavers want blueprint folios at the Guild House', () => {
    const s = settlement()
    s.season.year = REFINED_FROM_YEAR
    serveAll(s)
    expect(beavers(s).needDetail.education).toBe(true)
    expect(beavers(s).refinedStatus?.met).toBe(false)
    s.stock.folio = 5
    expect(beavers(s).refinedStatus?.met).toBe(true)
    expect(beavers(s).refined).toBeGreaterThan(RESOLVE_REFINED_NEED)
  })

  it('a def may also ask for the venue raised a tier', () => {
    const s = settlement()
    const hall = stand(s, 'guildHouse')
    s.stock.scroll = 20
    const def = { need: 'education' as const, name: 'a reading room', icon: '📚', venueTier: 1, hint: '' }
    expect(refinedCapacity(s, def)).toBe(0)
    hall.tier = 1
    expect(refinedCapacity(s, def)).toBeGreaterThan(0)
  })

  it('is never a penalty: missing it leaves resolve exactly where the base needs put it', () => {
    const s = settlement()
    s.season.year = 4
    stand(s, 'tavern')
    s.stock.ale = 20
    const b = humans(s)
    expect(b.refinedStatus?.unlocked).toBe(true)
    expect(b.refined).toBe(0)
    const sum =
      b.base + b.needs + b.housing + b.comfort + b.variety + b.hostility + b.expectations + b.cornerstone + b.penalties
    expect(b.target).toBeCloseTo(sum)
  })

  it('gives back only part of rising expectations, never more than they cost', () => {
    const s = settlement()
    s.season.year = 5
    stand(s, 'tavern')
    stand(s, 'temple')
    s.stock.ale = 20
    s.stock.incense = 20
    s.stock.spicedAle = 20
    const b = humans(s)
    const relief = b.refined - RESOLVE_REFINED_NEED
    expect(relief).toBeGreaterThan(0)
    expect(relief).toBeLessThan(-b.expectations)
  })

  it('scales with reach, and reads zero without a status', () => {
    const status = { unlocked: true, basicsMet: true, ratio: 0.5 } as Parameters<typeof refinedResolve>[0]
    expect(refinedResolve(status, 8)).toBeCloseTo(0.5 * (RESOLVE_REFINED_NEED + REFINED_EXPECTATION_RELIEF * 8))
    expect(refinedResolve(null, 8)).toBe(0)
    expect(refinedResolve({ ...status!, unlocked: false }, 8)).toBe(0)
    expect(refinedResolve({ ...status!, basicsMet: false }, 8)).toBe(0)
  })
})

describe('refined needs: the step', () => {
  it('burns the finer good at each serving venue, logs the wake-up once, and keeps the feats', () => {
    const s = settlement()
    s.season.year = REFINED_FROM_YEAR
    serveAll(s)
    s.stock.folio = 50
    s.stock.jerky = 50
    s.stock.spicedAle = 10
    const mods = computeModifiers(s)
    stepResolve(s, REFINED_GOOD_SECONDS, mods)
    expect(s.stock.spicedAle).toBeCloseTo(9)
    expect(s.stock.folio).toBeCloseTo(49)
    // Jerky is food as well: the step burns one at the arena, nobody eats here.
    expect(s.stock.jerky).toBeCloseTo(49)
    expect(s.log.filter((e) => e.text === REFINED_UNLOCKED_LOG)).toHaveLength(1)
    expect(s.feats?.refinedFrom).toBe(s.clock)
    expect([...(s.feats?.refinedMet ?? [])].sort()).toEqual(['beaver', 'human', 'lizard'])
    expect(s.feats?.refinedAll).toBe(true)
    stepResolve(s, 1, mods)
    expect(s.log.filter((e) => e.text === REFINED_UNLOCKED_LOG)).toHaveLength(1)
  })

  it('does not count a species as met while its form is missing', () => {
    const s = settlement()
    s.season.year = REFINED_FROM_YEAR
    serveAll(s)
    s.stock.spicedAle = 1.2
    stepResolve(s, 1, computeModifiers(s))
    expect(s.feats?.refinedMet).toEqual(['human'])
    expect(s.feats?.refinedAll).toBeFalsy()
    // Under one in stock, the tavern has none to pour.
    stepResolve(s, REFINED_GOOD_SECONDS, computeModifiers(s))
    expect(refinedStatus(s, 'human')?.met).toBe(false)
  })

  it('touches nothing before the settlement wants refined needs', () => {
    const s = settlement()
    stand(s, 'tavern')
    s.stock.ale = 50
    s.stock.spicedAle = 10
    stepResolve(s, REFINED_GOOD_SECONDS, computeModifiers(s))
    expect(s.stock.spicedAle).toBe(10)
    expect(s.feats?.refinedFrom).toBeUndefined()
    expect(s.feats?.refinedMet).toBeUndefined()
  })
})

describe('refined needs and the envoy', () => {
  it("lift resolve the way the unrest check reads it: a met refined need can carry a species out of discontent", () => {
    const make = (spiced: boolean) => {
      const s = settlement()
      s.season.year = 5
      serveAll(s)
      if (spiced) s.stock.spicedAle = 20
      // Every species just inside discontent.
      for (const sp of s.speciesPool) s.resolve[sp] = SPECIES[sp].resolveTarget - ENVOY_UNREST_MARGIN - 0.5
      return s
    }
    const plain = make(false)
    const refined = make(true)
    expect(discontentShare(plain)).toBe(discontentShare(refined))
    const without = humans(plain)
    const withIt = humans(refined)
    expect(withIt.target - without.target).toBeCloseTo(withIt.refined)
    expect(withIt.refined).toBeGreaterThan(RESOLVE_REFINED_NEED)
    // Drift for a while: the humans with spiced ale climb further from discontent.
    for (let i = 0; i < 20; i++) {
      stepResolve(plain, 1, computeModifiers(plain))
      stepResolve(refined, 1, computeModifiers(refined))
    }
    expect(refined.resolve.human).toBeGreaterThan(plain.resolve.human)
    expect(discontentShare(refined)).toBeLessThanOrEqual(discontentShare(plain))
  })
})
