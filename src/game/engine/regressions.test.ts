import { describe, expect, it } from 'vitest'
import { RESOURCES } from '../content/resources'
import { migrateRun } from '../persistence'
import type { RunState } from '../types'
import { demolishBuilding, findPlacement, placeBuilding, sootheQueen } from './actions'
import { TICK_SECONDS } from './balance'
import { createRun } from './createRun'
import { stepThreats } from './threats'
import { takeChoice } from './drafts'
import { retreatToCitadel } from './levers'
import { addImpatience } from './society'
import { stepDecree } from './structure'
import { applyOutcome } from './outcomes'
import { tick } from './tick'

/*
 * Regression tests for engine bugs found in the quality pass: each failed
 * before its fix. Trade's paid-lot fix is covered in trade.test.ts and the
 * save checks in saves.test.ts.
 */

/** A run past its founding picks, with materials to build. */
function founded(seed = 4242): RunState {
  const s = createRun({ seed, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  let guard = 0
  while (s.pendingChoices.length && guard++ < 20) takeChoice(s, s.pendingChoices[0].options[0])
  for (let i = 0; i < 5; i++) tick(s, TICK_SECONDS)
  s.stock.wood = 200
  s.stock.plank = 100
  s.stock.stone = 100
  return s
}

describe('building ids', () => {
  it('never reuses the id of a standing building after a demolition at the same clock', () => {
    const s = founded()
    expect(placeBuilding(s, 'shelter', findPlacement(s, 'shelter')!)).toBeNull()
    expect(placeBuilding(s, 'shelter', findPlacement(s, 'shelter')!)).toBeNull()
    const [first, second] = Object.keys(s.buildings).slice(-2)
    // Paused: the clock does not move between these commands.
    expect(demolishBuilding(s, first)).toBeNull()
    const before = Object.keys(s.buildings).length
    expect(placeBuilding(s, 'brazier', findPlacement(s, 'brazier')!)).toBeNull()
    expect(Object.keys(s.buildings)).toHaveLength(before + 1)
    expect(s.buildings[second].defId).toBe('shelter')
  })

  it('keeps old saves’ ids apart from the ones placed after loading', () => {
    const s = founded()
    for (let i = 0; i < 3; i++) placeBuilding(s, 'shelter', findPlacement(s, 'shelter')!)
    // An older save: ids from the building count and the clock, no counter.
    const old = JSON.parse(JSON.stringify(s)) as RunState
    const renamed: RunState['buildings'] = {}
    Object.values(old.buildings).forEach((b, i) => {
      const id = b.id === 'hearth' ? 'hearth' : `b${i + 1}_0`
      renamed[id] = { ...b, id }
    })
    old.buildings = renamed
    delete (old as { buildingCounter?: number }).buildingCounter
    const loaded = migrateRun(old)!
    expect(loaded.buildingCounter).toBe(Object.keys(renamed).length)
    const ids = new Set(Object.keys(loaded.buildings))
    for (let i = 0; i < 3; i++) {
      const before = Object.keys(loaded.buildings).length
      expect(placeBuilding(loaded, 'brazier', findPlacement(loaded, 'brazier')!)).toBeNull()
      expect(Object.keys(loaded.buildings)).toHaveLength(before + 1)
    }
    for (const id of ids) expect(loaded.buildings[id]).toBeDefined()
  })
})

describe('impatience stays whole points within its ceiling', () => {
  function metDecree(s: RunState): void {
    s.decree = {
      id: 'dx',
      defId: 'decree_planks', // forgives half a point
      progress: 0,
      complete: false,
      goal: { kind: 'stock', resource: 'wood', amount: 1 },
      baseline: 0,
      timeLeft: 100,
      timeLimit: 240,
    }
    s.stock.wood = 50
  }

  it('forgives a met decree’s half point through the fractional progress', () => {
    const s = founded()
    s.impatience = 10
    s.impatienceProgress = 0.25
    metDecree(s)
    stepDecree(s, TICK_SECONDS)
    expect(s.decree?.complete ?? true).toBe(true)
    expect(Number.isInteger(s.impatience)).toBe(true)
    expect(s.impatience + s.impatienceProgress).toBeCloseTo(9.75)
    addImpatience(s, 30)
    expect(s.impatience).toBe(s.maxImpatience)
  })

  it('never passes the ceiling, even from a fraction in the whole points', () => {
    const s = founded()
    s.impatience = s.maxImpatience - 0.5
    s.impatienceProgress = 0
    addImpatience(s, 8)
    expect(s.impatience).toBe(s.maxImpatience)
    expect(Number.isInteger(s.impatience)).toBe(true)
  })

  it('a condition’s fractional relief and the soothe go through the same helper', () => {
    const s = founded()
    s.impatience = 6
    s.impatienceProgress = 0
    applyOutcome(s, { impatience: -1.5 })
    expect(Number.isInteger(s.impatience)).toBe(true)
    expect(s.impatience + s.impatienceProgress).toBeCloseTo(4.5)
    s.stock.amber = 1000
    expect(sootheQueen(s)).toBeNull()
    expect(Number.isInteger(s.impatience)).toBe(true)
    expect(s.impatience + s.impatienceProgress).toBeCloseTo(3.5)
  })

  it('an older save with fractional or overfull impatience loads as whole points', () => {
    const s = founded()
    const old = JSON.parse(JSON.stringify(s)) as RunState
    old.impatience = 7.5
    old.impatienceProgress = 0.25
    const loaded = migrateRun(old)!
    expect(loaded.impatience).toBe(7)
    expect(loaded.impatienceProgress).toBeCloseTo(0.75)
    const over = JSON.parse(JSON.stringify(s)) as RunState
    over.impatience = over.maxImpatience + 0.5
    expect(migrateRun(over)!.impatience).toBe(over.maxImpatience)
  })
})

describe('the end of a run leaves no choice open', () => {
  it('withdraws a decree offer and an order offer that arrive on the losing tick', () => {
    const probe = founded()
    probe.decree = null
    probe.decreeTimer = TICK_SECONDS / 2
    tick(probe, TICK_SECONDS)
    expect(probe.pendingChoices.some((c) => c.kind === 'decree')).toBe(true)

    const s = founded()
    s.decree = null
    s.decreeTimer = TICK_SECONDS / 2
    s.orderOffers = [{ kind: 'order', options: ['x'], orders: [] }]
    s.impatience = s.maxImpatience
    tick(s, TICK_SECONDS)
    expect(s.phase).toBe('lost')
    expect(s.pendingChoices).toEqual([])
    expect(s.orderOffers).toEqual([])
  })

  it('a retreat withdraws them too', () => {
    const s = founded()
    s.clock = 60
    s.impatience = s.maxImpatience - 1
    s.reputation = 0
    s.orderOffers = [{ kind: 'order', options: ['x'], orders: [] }]
    s.pendingChoices = [{ kind: 'cornerstone', options: ['sturdyScaffolds'] }]
    expect(retreatToCitadel(s)).toBeNull()
    expect(s.pendingChoices).toEqual([])
    expect(s.orderOffers).toEqual([])
  })
})

describe('threat strike log', () => {
  it('names the goods and rounds what was taken', () => {
    const s = founded()
    s.stock.stone = 4.11000000000014
    s.stock.copperOre = 1.5
    s.threats.push({
      id: 't9',
      gladeId: 'glade1',
      name: 'Test Menace',
      icon: '🐺',
      description: 'test',
      interval: 10,
      timer: 0,
      appease: { amber: 10 },
      strike: { hostility: 3.75, stockLoss: { stone: 6, copperOre: 4 } },
    })
    stepThreats(s, 0.1)
    const text = s.log[0].text
    expect(text).toContain(`4.1 ${RESOURCES.stone.name} stolen`)
    expect(text).toContain(`1.5 ${RESOURCES.copperOre.name} stolen`)
    expect(text).toContain('hostility +3.8')
    expect(text).not.toMatch(/\d\.\d{2,}/)
    expect(text).not.toContain('copperOre')
  })
})

describe('migrateRun never throws', () => {
  it('reads junk as no run rather than throwing', () => {
    const junk: unknown[] = [
      null,
      1,
      'x',
      [],
      {},
      { seed: 1 },
      { seed: 1, world: {}, deposits: {} },
      { seed: 1, world: 1, deposits: 1, buildings: 5 },
      { seed: 1, world: {}, deposits: {}, unlockedBuildings: 'abc' },
      { seed: 1, world: {}, deposits: {}, buildings: { a: null } },
      { seed: 1, world: {}, deposits: {}, feats: 'x', citadel: 7 },
      { seed: 1, world: {}, deposits: {}, pendingChoices: [null], clock: 0 },
    ]
    for (const raw of junk) {
      expect(() => migrateRun(JSON.parse(JSON.stringify(raw)))).not.toThrow()
    }
  })
})
