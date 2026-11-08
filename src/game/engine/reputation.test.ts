import { describe, expect, it } from 'vitest'
import { COMMISSIONS } from '../content/commissions'
import { ALL_RUN_MODIFIER_LIST, RUN_MODIFIERS } from '../content/runModifiers'
import { STORM_BLIGHTS } from '../content/stormBlights'
import type { BuildingInstance, RunState } from '../types'
import { addClearer } from './actions'
import {
  GLADES_PER_REPUTATION,
  HEARTH_STORM_REACH_FLOOR,
  HEARTH_WARMTH_RADIUS,
  LONG_NIGHT_BRAZIERS,
  LONG_NIGHT_REACH_PERCENT,
  REPUTATION_PER_CARAVAN,
  REPUTATION_PER_TRADE_AMBER,
  SEASON_LENGTH,
} from './balance'
import { announceBlight, breakStormBlights } from './blights'
import { createRun } from './createRun'
import { takeChoice } from './drafts'
import { computeModifiers } from './modifiers'
import { orderReputation, stepOrders } from './orders'
import { hearthReachAt, hearthWarmthRadius, stormEndReach, stormReachFloor } from './queries'
import {
  combineProfiles,
  describeProfile,
  reputationFor,
  reputationMultiplier,
  runReputationProfile,
} from './reputation'
import { addReputation, resolveBreakdowns, stepReputation } from './society'
import { stepConditions } from './structure'
import { tick } from './tick'
import { sellResource, stepCaravan } from './trade'
import { stepClearing } from './glades'

const SEED = 4711
const TRIO = ['human', 'beaver', 'lizard'] as const

function runWith(modifiers: string[], commission?: string): RunState {
  const s = createRun({ seed: SEED, species: [...TRIO], modifiers, commission })
  let guard = 0
  while (s.pendingChoices.length > 0 && guard++ < 20) takeChoice(s, s.pendingChoices[0].options[0])
  return s
}

describe('reputation profiles', () => {
  it('are data on lands and commissions, several of each, and multiply together', () => {
    expect(ALL_RUN_MODIFIER_LIST.filter((d) => d.reputation).length).toBeGreaterThanOrEqual(5)
    expect(Object.values(COMMISSIONS).filter((d) => d.reputation).length).toBeGreaterThanOrEqual(3)
    expect(combineProfiles([{ glades: 2 }, { glades: 1.5, orders: 0.5 }])).toEqual({ glades: 3, orders: 0.5 })
    const s = runWith(['wildFrontier'], 'holdFrontier')
    expect(runReputationProfile(s).glades).toBeCloseTo(
      RUN_MODIFIERS.wildFrontier.reputation!.glades! * COMMISSIONS.holdFrontier.reputation!.glades!,
    )
    // A land with no profile pays as always, and trade pays nothing.
    const plain = runWith([])
    expect(reputationMultiplier(plain, 'orders')).toBe(1)
    expect(reputationMultiplier(plain, 'trade')).toBe(0)
  })

  it('read as the Queen’s values on a card', () => {
    expect(describeProfile(RUN_MODIFIERS.wildFrontier.reputation!)).toEqual([
      'completed orders ×0.75',
      'reclaimed land ×2',
    ])
    expect(describeProfile(RUN_MODIFIERS.amberSprings.reputation!)).toEqual(['caravan trade'])
    expect(describeProfile({})).toEqual([])
  })

  it('Wild Frontier: a reclaimed-land point pays double, and orders pay less', () => {
    const s = runWith(['wildFrontier'])
    const glade = Object.values(s.glades).find((g) => !g.cleared && g.discovered && g.kind === 'small')!
    s.stats.gladesCleared = GLADES_PER_REPUTATION - 1
    glade.eventId = undefined
    addClearer(s, glade.id)
    glade.clearProgress = glade.clearWork
    const before = s.reputation + s.reputationProgress
    stepClearing(s, 0.125, computeModifiers(s))
    expect(s.reputation + s.reputationProgress - before).toBeCloseTo(2)
    expect(s.reputationBy?.glades).toBeCloseTo(2)
    const order = { id: 'probe', defId: 'stock_plank_30', progress: 0, complete: false }
    expect(orderReputation(s, order)).toBeCloseTo(0.75)
    s.orders = [order]
    s.stock.plank = 30
    const r0 = s.reputation + s.reputationProgress
    stepOrders(s)
    expect(s.reputation + s.reputationProgress - r0).toBeCloseTo(0.75)
  })

  it('Pilgrim Road: contentment pays half again', () => {
    const plain = runWith([])
    const pilgrim = runWith(['pilgrimRoad'])
    for (const s of [plain, pilgrim]) for (const sp of s.speciesPool) s.resolve[sp] = 60
    const gain = (s: RunState) => stepReputation(s, 10, computeModifiers(s), resolveBreakdowns(s, computeModifiers(s)))
    const base = gain(plain)
    expect(base).toBeGreaterThan(0)
    expect(gain(pilgrim)).toBeCloseTo(base * 1.5)
  })

  it('Ill Omens: glade events pay double', () => {
    const s = runWith(['illOmens'])
    const before = s.reputation + s.reputationProgress
    addReputation(s, 1)
    expect(s.reputation + s.reputationProgress - before).toBeCloseTo(2)
    expect(s.reputationBy?.events).toBeCloseTo(2)
    expect(reputationFor(s, 'events', 1.5)).toBeCloseTo(3)
  })

  it('Amber Springs: caravans calling and goods sold earn reputation, which they never do elsewhere', () => {
    for (const [mods, pays] of [[['amberSprings', 'wanderingTraders'], true], [['wanderingTraders'], false]] as const) {
      const s = runWith([...mods])
      s.caravan.timer = 0.01
      stepCaravan(s, 1, computeModifiers(s))
      expect(s.caravan.here).toBe(true)
      expect(s.reputationBy?.trade ?? 0).toBeCloseTo(pays ? REPUTATION_PER_CARAVAN : 0)
      s.stock.stone = 50
      const amber = s.stock.amber ?? 0
      expect(sellResource(s, 'stone')).toBeNull()
      const paid = (s.stock.amber ?? 0) - amber
      expect(s.reputationBy?.trade ?? 0).toBeCloseTo(pays ? REPUTATION_PER_CARAVAN + paid * REPUTATION_PER_TRADE_AMBER : 0)
    }
  })
})

describe('the Long Night', () => {
  function put(s: RunState, defId: string, id: string): BuildingInstance {
    const hearth = s.buildings.hearth
    const b: BuildingInstance = {
      ...hearth,
      id,
      defId,
      pos: { x: hearth.pos.x + 3, y: hearth.pos.y },
      workers: [],
      built: true,
      activeRecipeId: '',
    }
    s.buildings[id] = b
    return b
  }

  it('is a Storm blight with wood to turn it aside', () => {
    const def = STORM_BLIGHTS.longNight
    expect(def.prep.resource).toBe('wood')
    expect(def.strike.condition?.whileActive).toEqual([{ kind: 'hearthReach', percent: LONG_NIGHT_REACH_PERCENT }])
    expect(def.strike.condition?.passesWithStorm).toBe(true)
  })

  it('unprepared, pulls the warm ring in to half by the Storm’s end; braziers lit lift it; it passes with the Storm', () => {
    const s = runWith([])
    s.stock.wood = 400
    s.season = { year: 3, season: 'clearance', elapsed: 0, length: SEASON_LENGTH.clearance }
    announceBlight(s, STORM_BLIGHTS.longNight)
    // Planning already sees the smaller ring.
    expect(stormEndReach(s)).toBeLessThan(hearthReachAt(1))
    s.season = { year: 3, season: 'storm', elapsed: 0, length: SEASON_LENGTH.storm }
    breakStormBlights(s)
    expect(s.conditions.some((c) => c.name === 'The Long Night')).toBe(true)
    const floor = HEARTH_STORM_REACH_FLOOR * (1 + LONG_NIGHT_REACH_PERCENT / 100)
    expect(stormReachFloor(s)).toBeCloseTo(floor)
    s.season.elapsed = s.season.length
    expect(hearthWarmthRadius(s)).toBeLessThanOrEqual(HEARTH_WARMTH_RADIUS * floor + 0.25)
    expect(hearthWarmthRadius(s)).toBeLessThan(hearthReachAt(1))
    for (let i = 0; i < LONG_NIGHT_BRAZIERS; i++) put(s, 'brazier', `bz${i}`)
    stepConditions(s, 0.125)
    expect(s.conditions.some((c) => c.name === 'The Long Night')).toBe(false)
    expect(hearthWarmthRadius(s)).toBe(hearthReachAt(1))
  })

  it('lifts quietly as the Storm passes', () => {
    const s = runWith([])
    s.stock.wood = 400
    s.season = { year: 3, season: 'clearance', elapsed: SEASON_LENGTH.clearance - 0.0625, length: SEASON_LENGTH.clearance }
    s.conditions = []
    announceBlight(s, STORM_BLIGHTS.longNight)
    tick(s, 0.125)
    expect(s.season.season).toBe('storm')
    expect(s.conditions.some((c) => c.name === 'The Long Night')).toBe(true)
    s.season.elapsed = s.season.length - 0.0625
    tick(s, 0.125)
    expect(s.season.season).toBe('drizzle')
    expect(s.conditions.some((c) => c.name === 'The Long Night')).toBe(false)
  })
})
