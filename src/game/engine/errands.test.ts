import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../content/buildings'
import { ERRANDS, ERRAND_LIST, ERRAND_PACING } from '../content/errands'
import type { Errand, ErrandGoal, RunState } from '../types'
import { migrateRun } from '../persistence'
import { runProblem } from '../runCheck'
import { PETITION_AMBER, PETITION_FROM_YEAR, RETREAT_IMPATIENCE_SHARE, TRADE_LOT, YEAR_SECONDS } from './balance'
import { createRun } from './createRun'
import { takeChoice } from './drafts'
import {
  dismissErrand,
  drawErrand,
  errandBlocked,
  errandReward,
  errandSlots,
  openErrands,
  runErrand,
  stepErrands,
  whereFromHearth,
} from './errands'
import { grandPetition, queensCourt } from './levers'
import { SOOTHE_ENVOY_REFUSAL, sootheQueen } from './actions'
import { sendEnvoy } from './reputation'
import { gladeAt } from './mapgen'
import { secondsSinceReputation, stagnationImpatienceRate } from './society'
import { tick } from './tick'

/**
 * Errands: small optional tasks offered while reputation stands still —
 * when they turn up, how each kind is measured, what they pay (and when that
 * is amber rather than reputation), that they lapse without penalty, that
 * they leave the run's RNG and the Queen's stagnation count alone, and older
 * or damaged saves. Also the Queen's court summary of her three levers.
 */

/** A founded run (every opening pick made), with no land modifiers. */
function newRun(seed = 5150): RunState {
  const s = createRun({ seed, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  let guard = 0
  while (s.pendingChoices.length > 0 && guard++ < 20) takeChoice(s, s.pendingChoices[0].options[0])
  return s
}

/** A built lumber mill with nobody in it: something for a staffing errand. */
function emptyMill(s: RunState): string {
  const id = `test_mill_${Object.keys(s.buildings).length}`
  const pos = { x: 0, y: -14 }
  s.buildings[id] = {
    id,
    defId: 'lumberMill',
    pos,
    gladeId: gladeAt(s.glades, pos)?.id ?? 'glade0',
    built: true,
    buildProgress: BUILDINGS.lumberMill.buildSeconds,
    workers: [],
    activeRecipeId: BUILDINGS.lumberMill.recipes[0]?.id ?? '',
    recipeProgress: 0,
    paused: false,
    depositsInRange: {},
    tier: 0,
  }
  return id
}

/** Reputation has stood still for `seconds` at clock `at`. */
function stalled(s: RunState, seconds: number, at = 600): void {
  s.clock = at
  s.reputationRise = { at: at - seconds, level: s.reputation }
}

/** An open errand put straight into the run. */
function give(s: RunState, defId: string, goal: ErrandGoal, extra: Partial<Errand> = {}): Errand {
  const errand: Errand = {
    id: `e${(s.errands ?? []).length + 100}`,
    defId,
    title: ERRANDS[defId].title,
    goal,
    progress: 0,
    timeLeft: 60,
    timeLimit: 60,
    reward: { reputation: 0.35 },
    ...extra,
  }
  s.errands = [...(s.errands ?? []), errand]
  return errand
}

describe('errand content', () => {
  it('every errand is small, short and concrete', () => {
    expect(ERRAND_LIST.length).toBeGreaterThanOrEqual(8)
    const ids = ERRAND_LIST.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const def of ERRAND_LIST) {
      expect(def.seconds, def.id).toBeGreaterThanOrEqual(30)
      expect(def.seconds, def.id).toBeLessThanOrEqual(90)
      const rep = def.reward.reputation ?? 0
      if (rep > 0) {
        expect(rep, def.id).toBeGreaterThanOrEqual(0.25)
        expect(rep, def.id).toBeLessThanOrEqual(0.5)
      } else {
        expect(def.reward.amber ?? 0, def.id).toBeGreaterThan(0)
      }
      expect(def.weight, def.id).toBeGreaterThan(0)
      expect(def.title.length, def.id).toBeLessThanOrEqual(60)
    }
  })

  it('errands start turning up when the Queen starts counting the stall', () => {
    // Tied to the stagnation timer, not a clock of their own.
    const s = newRun()
    stalled(s, ERRAND_PACING.stallAfter)
    expect(stagnationImpatienceRate(s)).toBe(0)
    stalled(s, ERRAND_PACING.stallAfter + 1)
    expect(stagnationImpatienceRate(s)).toBeGreaterThan(0)
  })
})

describe('when errands turn up', () => {
  it('not in the opening, then once reputation has stood still', () => {
    const s = newRun()
    emptyMill(s)
    stalled(s, ERRAND_PACING.stallAfter + 5, ERRAND_PACING.firstAt - 1)
    stepErrands(s, 0.25)
    expect(openErrands(s)).toHaveLength(0)

    stalled(s, ERRAND_PACING.stallAfter + 5, ERRAND_PACING.firstAt + 30)
    stepErrands(s, 0.25)
    expect(openErrands(s)).toHaveLength(1)
    expect(s.errandBook?.offered).toBe(1)
    expect(s.log[0].text).toContain('An errand:')
  })

  it('only now and then while reputation is rising', () => {
    const s = newRun()
    emptyMill(s)
    stalled(s, 10, ERRAND_PACING.firstAt + 30)
    s.errandBook = { next: 0, lastOffer: s.clock - 60, cursor: 0, counter: 0, offered: 1, met: 1, lapsed: 0, reputation: 0, amber: 0 }
    stepErrands(s, 0.25)
    expect(openErrands(s)).toHaveLength(0)
    s.errandBook.lastOffer = s.clock - ERRAND_PACING.quietGap
    stepErrands(s, 0.25)
    expect(openErrands(s)).toHaveLength(1)
  })

  it('one open at a time, two once the stall runs long — never more', () => {
    const s = newRun()
    emptyMill(s)
    emptyMill(s)
    emptyMill(s)
    s.stock.wood = 200
    stalled(s, ERRAND_PACING.stallAfter + 5)
    expect(errandSlots(s)).toBe(1)
    for (let i = 0; i < 400; i++) {
      s.clock += 0.25
      stepErrands(s, 0)
      expect(openErrands(s).length).toBeLessThanOrEqual(errandSlots(s))
    }
    stalled(s, ERRAND_PACING.secondAfter + 5, s.clock)
    expect(errandSlots(s)).toBe(2)
    for (let i = 0; i < 400; i++) {
      s.clock += 0.25
      stepErrands(s, 0)
      expect(openErrands(s).length).toBeLessThanOrEqual(2)
    }
    expect(openErrands(s)).toHaveLength(2)
    // Never the same template twice at once.
    expect(new Set(openErrands(s).map((e) => e.defId)).size).toBe(2)
  })

  it('never while a choice is waiting: a dialog, or an order slot to fill', () => {
    const s = newRun()
    emptyMill(s)
    stalled(s, ERRAND_PACING.stallAfter + 5)
    s.orderOffers = [{ kind: 'order', options: ['x'], orders: [] }]
    stepErrands(s, 0.25)
    expect(openErrands(s)).toHaveLength(0)
    s.orderOffers = []
    s.pendingChoices = [{ kind: 'cornerstone', options: ['x'] }]
    stepErrands(s, 0.25)
    expect(openErrands(s)).toHaveLength(0)
    s.pendingChoices = []
    stepErrands(s, 0.25)
    expect(openErrands(s)).toHaveLength(1)
  })

  it('drawn only from what the settlement can do now, and named for it', () => {
    const s = newRun()
    const mill = emptyMill(s)
    s.stock.wood = 0
    s.stock.amber = 0
    stalled(s, ERRAND_PACING.stallAfter + 5)
    const errand = drawErrand(s)
    expect(errand?.defId).toBe('staffWorkplace')
    expect(errand?.buildingId).toBe(mill)
    expect(errand?.title).toBe(`Staff the Lumber Mill ${whereFromHearth(s, s.buildings[mill].pos)}`)
    expect(errand?.title).toContain('north of the hearth')
    // With nobody idle, there is nobody to staff it with.
    for (const v of Object.values(s.villagers)) v.assignment = 'clearing:nowhere'
    expect(drawErrand(s)?.defId).not.toBe('staffWorkplace')
  })

  it('draws from its own stream: the run’s RNG cursor never moves', () => {
    const s = newRun()
    emptyMill(s)
    const cursor = s.rngCursor
    stalled(s, ERRAND_PACING.stallAfter + 5)
    stepErrands(s, 0.25)
    expect(openErrands(s)).toHaveLength(1)
    expect(s.rngCursor).toBe(cursor)
    // ...and the same seed draws the same errand.
    const t = newRun()
    emptyMill(t)
    stalled(t, ERRAND_PACING.stallAfter + 5)
    stepErrands(t, 0.25)
    expect(openErrands(t)[0].title).toBe(openErrands(s)[0].title)
  })
})

describe('meeting, paying and lapsing', () => {
  it('a hand-over takes the goods and pays at once; short of goods it says why', () => {
    const s = newRun()
    const e = give(s, 'haulToClearers', { kind: 'deliver', resource: 'wood', amount: 10 })
    s.stock.wood = 6
    expect(errandBlocked(s, e)).toBe('Needs 10 Wood; you have 6.')
    expect(runErrand(s, e.id)).toBe('Needs 10 Wood; you have 6.')
    s.stock.wood = 30
    s.reputationProgress = 0.8
    const rep = s.reputation
    expect(runErrand(s, e.id)).toBeNull()
    expect(s.stock.wood).toBe(20)
    // 0.8 + 0.35 carries into a whole point.
    expect(s.reputation).toBe(rep + 1)
    expect(s.reputationProgress).toBeCloseTo(0.15)
    expect(openErrands(s)).toHaveLength(0)
    expect(s.errandBook?.met).toBe(1)
    expect(s.errandBook?.reputation).toBeCloseTo(0.35)
  })

  it('a sale goes through the caravan, and lapses when it leaves', () => {
    const s = newRun()
    s.caravan.here = true
    s.caravan.timer = 60
    s.stock.berry = TRADE_LOT + 5
    s.stock.amber = 0
    const e = give(s, 'sellToCaravan', { kind: 'sell', resource: 'berry' }, { reward: { amber: 10 } })
    expect(runErrand(s, e.id)).toBeNull()
    expect(s.stock.berry).toBe(5)
    expect(s.stock.amber).toBeGreaterThan(10) // the sale, then the reward
    const f = give(s, 'sellToCaravan', { kind: 'sell', resource: 'berry' })
    s.caravan.here = false
    expect(errandBlocked(s, f)).toBe('The caravan has gone.')
    stepErrands(s, 0.25)
    expect(openErrands(s)).toHaveLength(0)
  })

  it('a staffing errand counts the seconds someone works there', () => {
    const s = newRun()
    const mill = emptyMill(s)
    give(s, 'staffWorkplace', { kind: 'staff', buildingId: mill, seconds: 30 }, { buildingId: mill })
    stepErrands(s, 10)
    expect(openErrands(s)[0].progress).toBe(0)
    s.buildings[mill].workers = [Object.keys(s.villagers)[0]]
    stepErrands(s, 10)
    expect(openErrands(s)[0].progress).toBeCloseTo(1 / 3)
    stepErrands(s, 10)
    stepErrands(s, 10)
    expect(openErrands(s)).toHaveLength(0)
    expect(s.errandBook?.met).toBe(1)
  })

  it('a held stock goal and a counting goal reuse the goal machinery', () => {
    const s = newRun()
    s.stock.wood = 10
    give(s, 'keepHearth', { kind: 'hold', goal: { kind: 'stock', resource: 'wood', amount: 25 }, seconds: 20 })
    stepErrands(s, 5)
    expect(openErrands(s)[0].held ?? 0).toBe(0)
    s.stock.wood = 30
    stepErrands(s, 5)
    expect(openErrands(s)[0].progress).toBeCloseTo(0.25)

    const t = newRun()
    give(t, 'raiseHome', { kind: 'count', goal: { kind: 'buildingsOfCategory', category: 'housing', amount: 1 } }, { baseline: 0 })
    stepErrands(t, 1)
    expect(openErrands(t)[0].progress).toBe(0)
    const mill = emptyMill(t)
    t.buildings[mill].defId = 'shelter' // a home stands now
    stepErrands(t, 1)
    expect(openErrands(t)).toHaveLength(0)
    expect(t.errandBook?.met).toBe(1)
  })

  it('an errand left alone lapses with no penalty at all', () => {
    const s = newRun()
    const mill = emptyMill(s)
    give(s, 'staffWorkplace', { kind: 'staff', buildingId: mill, seconds: 30 }, { timeLeft: 1 })
    const before = { rep: s.reputation, progress: s.reputationProgress, imp: s.impatience, impP: s.impatienceProgress }
    stepErrands(s, 2)
    expect(openErrands(s)).toHaveLength(0)
    expect(s.errandBook?.lapsed).toBe(1)
    expect([s.reputation, s.reputationProgress, s.impatience, s.impatienceProgress]).toEqual([
      before.rep,
      before.progress,
      before.imp,
      before.impP,
    ])
    expect(s.log[0].text).toContain('No harm done')
    // Letting one go is the same.
    const e = give(s, 'staffWorkplace', { kind: 'staff', buildingId: mill, seconds: 30 })
    expect(dismissErrand(s, e.id)).toBeNull()
    expect(openErrands(s)).toHaveLength(0)
    expect(s.errandBook?.lapsed).toBe(2)
  })

  it('an errand about a demolished building lapses', () => {
    const s = newRun()
    const mill = emptyMill(s)
    give(s, 'staffWorkplace', { kind: 'staff', buildingId: mill, seconds: 30 })
    delete s.buildings[mill]
    stepErrands(s, 0.25)
    expect(openErrands(s)).toHaveLength(0)
  })

  it('reputation only once the stall runs long, a set number of errands a stall, and not for the last points', () => {
    const s = newRun()
    s.reputation = 5
    const rep = { reputation: 0.35 }
    // Early in a stall: amber.
    stalled(s, ERRAND_PACING.stallAfter + 5)
    expect(errandReward(s, rep)).toEqual({ amber: Math.round(0.35 * ERRAND_PACING.amberPerPoint) })
    // A long stall: reputation, up to the per-stall number.
    stalled(s, ERRAND_PACING.reputationAfter + 5)
    for (let i = 0; i < ERRAND_PACING.reputationPerStall; i++) expect(errandReward(s, rep)).toEqual(rep)
    expect(errandReward(s, rep).reputation).toBeUndefined()
    // A new stall gets its own.
    stalled(s, ERRAND_PACING.reputationAfter + 5, s.clock + 1000)
    expect(errandReward(s, rep)).toEqual(rep)
    // Within reach of victory, errands pay amber: the last points come from the settlement.
    s.reputation = s.maxReputation - ERRAND_PACING.reputationShortOf + 1
    stalled(s, ERRAND_PACING.reputationAfter + 5, s.clock + 1000)
    expect(errandReward(s, rep).reputation).toBeUndefined()
  })

  it('leaves the Queen’s stagnation count alone unless a whole point lands', () => {
    const s = newRun()
    s.reputationProgress = 0
    stalled(s, 200)
    const e = give(s, 'haulToClearers', { kind: 'deliver', resource: 'wood', amount: 10 })
    s.stock.wood = 50
    runErrand(s, e.id)
    tick(s, 0.25)
    expect(secondsSinceReputation(s)).toBeGreaterThan(200)
  })

  it('a long stalled run offers errands, meets some by play, and stays within its slots', () => {
    const s = newRun(424242)
    s.clock = ERRAND_PACING.firstAt
    for (let i = 0; i < 4 * 240 && s.phase === 'playing'; i++) {
      // Keep the Queen counting: no point lands while we watch.
      s.reputationRise = { at: ERRAND_PACING.firstAt - 100, level: s.reputation }
      s.pendingChoices = []
      tick(s, 0.25)
      expect(openErrands(s).length).toBeLessThanOrEqual(2)
    }
    expect(s.errandBook?.offered ?? 0).toBeGreaterThan(0)
  })
})

describe('errands and the envoy', () => {
  it('errand reputation goes through gainReputation as its own source', () => {
    const s = newRun()
    const e = give(s, 'haulToClearers', { kind: 'deliver', resource: 'wood', amount: 10 })
    s.stock.wood = 30
    const before = s.reputationBy?.errands ?? 0
    expect(runErrand(s, e.id)).toBeNull()
    expect(s.reputationBy?.errands).toBeCloseTo(before + 0.35)
  })

  it('an errand that fills the meter sends the envoy', () => {
    const s = newRun()
    s.reputation = s.maxReputation - 1
    s.reputationProgress = 0.9
    const e = give(s, 'haulToClearers', { kind: 'deliver', resource: 'wood', amount: 10 })
    s.stock.wood = 30
    runErrand(s, e.id)
    expect(s.reputation).toBe(s.maxReputation)
    expect(s.envoy).toBeTruthy()
  })

  it('none are offered while the envoy rides, and open ones are set aside at no cost', () => {
    const s = newRun()
    const mill = emptyMill(s)
    give(s, 'staffWorkplace', { kind: 'staff', buildingId: mill, seconds: 30 })
    s.reputation = s.maxReputation
    sendEnvoy(s)
    const before = { imp: s.impatience, impP: s.impatienceProgress, glory: s.envoy!.glory }
    stalled(s, ERRAND_PACING.secondAfter + 5)
    stepErrands(s, 0.25)
    expect(openErrands(s)).toHaveLength(0)
    expect(s.errandBook?.lapsed).toBe(1)
    expect([s.impatience, s.impatienceProgress, s.envoy!.glory]).toEqual([before.imp, before.impP, before.glory])
    for (let i = 0; i < 200; i++) {
      s.clock += 1
      stepErrands(s, 1)
    }
    expect(openErrands(s)).toHaveLength(0)
    expect(s.errandBook?.offered ?? 0).toBe(0)
    // A hand-over is refused too.
    const e = give(s, 'haulToClearers', { kind: 'deliver', resource: 'wood', amount: 10 })
    s.stock.wood = 50
    expect(errandBlocked(s, e)).toBe('The envoy is on her way: errands are done.')
  })

  it("the Queen's court closes soothing, the petition and the retreat while she rides", () => {
    const s = newRun()
    s.season.year = 3
    s.clock = 2 * YEAR_SECONDS + 10
    s.impatience = s.maxImpatience - 2
    s.stock.amber = 1000
    s.reputation = s.maxReputation
    sendEnvoy(s)
    const court = queensCourt(s)
    expect(court.map((l) => l.state)).toEqual(['closed', 'closed', 'closed'])
    expect(court[0].note).toBe(SOOTHE_ENVOY_REFUSAL)
    expect(sootheQueen(s)).toBe(court[0].note)
    expect(court[1].note).toContain('envoy is on her way')
    expect(grandPetition(s)).not.toBeNull()
  })
})

describe('saves', () => {
  it('older saves load with no errands; damaged ones are dropped', () => {
    const s = newRun()
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>
    delete raw.errands
    delete raw.errandBook
    const loaded = migrateRun(raw)!
    expect(loaded.errands).toBeUndefined()
    expect(openErrands(loaded)).toEqual([])
    expect(runProblem(loaded)).toBeNull()
    tick(loaded, 0.25)

    const damaged = JSON.parse(JSON.stringify(s)) as Record<string, unknown>
    damaged.errands = [{ id: 'e1', defId: 'nope' }, 'junk', { id: 'e2', defId: 'haulToClearers', title: 't', goal: { kind: 'deliver', resource: 'wood', amount: 10 }, progress: 0, timeLeft: 30, timeLimit: 60, reward: {} }]
    damaged.errandBook = { next: 'soon' }
    const fixed = migrateRun(damaged)!
    expect(fixed.errands?.map((e) => e.id)).toEqual(['e2'])
    expect(fixed.errandBook?.counter).toBe(3)
    expect(Number.isFinite(fixed.errandBook?.next)).toBe(true)
  })

  it('an open errand survives a save and load', () => {
    const s = newRun()
    emptyMill(s)
    stalled(s, ERRAND_PACING.stallAfter + 5)
    stepErrands(s, 0.25)
    const loaded = migrateRun(JSON.parse(JSON.stringify(s)))!
    expect(loaded.errands).toEqual(s.errands)
    expect(loaded.errandBook).toEqual(s.errandBook)
  })
})

describe("the Queen's court", () => {
  it('names all three levers with their state and when each opens', () => {
    const s = newRun()
    s.season.year = PETITION_FROM_YEAR
    s.clock = YEAR_SECONDS + 10
    s.impatience = 0
    s.impatienceProgress = 0
    s.reputation = 3
    s.stock.amber = 0
    const [soothe, petition, retreat] = queensCourt(s)
    expect([soothe.id, petition.id, retreat.id]).toEqual(['soothe', 'petition', 'retreat'])
    expect(soothe.state).toBe('later')
    expect(petition.state).toBe('later')
    expect(petition.note).toMatch(/^Opens when impatience reaches \d+ \(now 0\)/)
    expect(retreat.state).toBe('later')
    expect(retreat.note).toContain(`Offered if impatience reaches ${Math.ceil(s.maxImpatience * RETREAT_IMPATIENCE_SHARE)}`)
  })

  it('follows the levers as the run slips', () => {
    const s = newRun()
    s.season.year = 4
    s.clock = 3 * YEAR_SECONDS + 10
    s.reputation = 8
    s.impatience = s.maxImpatience - 3
    s.impatienceProgress = 0
    s.stock.amber = 20
    let court = queensCourt(s)
    expect(court.map((l) => l.state)).toEqual(['short', 'short', 'open'])
    s.stock.amber = PETITION_AMBER + 100
    court = queensCourt(s)
    expect(court.map((l) => l.state)).toEqual(['open', 'open', 'open'])
    expect(grandPetition(s)).toBeNull()
    court = queensCourt(s)
    expect(court[1].state).toBe('used')
    expect(court[1].note).toMatch(/^Made — your vow: 0\/3 reputation/)
    // Close to victory the Retreat is not on the table.
    s.reputation = s.maxReputation - 2
    expect(queensCourt(s)[2].note).toContain('Not while victory is within')
  })
})
