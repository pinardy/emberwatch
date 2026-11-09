import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../content/buildings'
import { supplyReward } from './meta'
import type { RunState } from '../types'
import {
  ARCHITECT_PLANS_GROWTH,
  ARCHITECT_PLANS_PRICE,
  PETITION_AMBER,
  PETITION_BROKEN_IMPATIENCE,
  PETITION_KEPT_RELIEF,
  PETITION_RELIEF,
  PETITION_PACE_SECONDS,
  PETITION_VOW_MIN,
  PETITION_VOW_REPUTATION,
  PETITION_VOW_SECONDS,
  PETITION_WITHIN,
  FINAL_CHARGE_FROM_YEAR,
  FINAL_CHARGE_RESOLVE_RATE,
  FINAL_CHARGE_STALL,
  FINAL_CHARGE_WITHIN,
  REROLL_BASE_COST,
  REROLL_COST_GROWTH,
  RETREAT_IMPATIENCE_SHARE,
  RETREAT_REPUTATION_SHORT,
  TARGETED_REDRAW_SURCHARGE,
  YEAR_SECONDS,
} from './balance'
import { createRun } from './createRun'
import { collectWarnings } from './diagnostics'
import { chainPieceFor } from './serviceChains'
import {
  offerBlueprint,
  redrawTargets,
  redrawToward,
  takeChoice,
  targetedRedrawCost,
} from './drafts'
import {
  architectBlocked,
  architectOffers,
  architectPrice,
  buyArchitectPlans,
  finalChargeActive,
  grandPetition,
  petitionBlocked,
  petitionOpen,
  petitionVow,
  petitionVowLeft,
  recentReputationPace,
  stepFinalCharge,
  retreatOffered,
  retreatToCitadel,
  stepPetition,
} from './levers'
import { secondsSinceReputation, stagnationImpatienceRate } from './society'
import { tick } from './tick'
import { migrateRun } from '../persistence'
import { sendEnvoy } from './reputation'

/**
 * The levers on a run going wrong: the Queen's Architect (plans for a named
 * service at the hearth, and a redraw toward one on an open draft), the
 * Grand Petition and the Retreat to the Citadel.
 */

/** A run past its founding picks, with no land modifiers to bend the rules. */
function newRun(species: RunState['speciesPool'] = ['human', 'beaver', 'lizard']): RunState {
  const s = createRun({ seed: 9090, species, modifiers: [] })
  let guard = 0
  while (s.pendingChoices.length > 0 && guard++ < 20) takeChoice(s, s.pendingChoices[0].options[0])
  return s
}

/** Locks every blueprint of the luxury chain (tavern, brewery) again. */
function lockLuxury(s: RunState): void {
  s.unlockedBuildings = s.unlockedBuildings.filter((id) => id !== 'tavern' && id !== 'brewery')
}

/** Sets the Queen's impatience to an exact level. */
function setImpatience(s: RunState, level: number): void {
  s.impatience = Math.floor(level)
  s.impatienceProgress = level - Math.floor(level)
}

/** Moves the run into Year `year` without ticking through it. */
function toYear(s: RunState, year: number): void {
  s.season.year = year
  s.clock = Math.max(s.clock, (year - 1) * YEAR_SECONDS + 1)
}

describe("the Queen's Architect", () => {
  it('names the next piece of a chain: its venue first, then a workshop for its goods, then nothing', () => {
    const s = newRun()
    lockLuxury(s)
    expect(chainPieceFor(s, 'luxury')).toBe('tavern')
    s.unlockedBuildings.push('tavern')
    expect(chainPieceFor(s, 'luxury')).toBe('brewery')
    s.unlockedBuildings.push('brewery')
    expect(chainPieceFor(s, 'luxury')).toBeNull()
  })

  it("offers plans for the run's wanted services only, each its chain's next piece", () => {
    const s = newRun()
    const offers = architectOffers(s)
    expect(offers.length).toBeGreaterThan(0)
    for (const o of offers) {
      expect(o.piece).toBe(chainPieceFor(s, o.need))
      expect(s.unlockedBuildings).not.toContain(o.piece)
      expect(o.species.length).toBeGreaterThan(0)
    }
    // 'rest' is wanted by none of these three species.
    expect(offers.some((o) => o.need === 'rest')).toBe(false)
  })

  it('sells plans for a named service at a price that climbs with every set', () => {
    const s = newRun()
    lockLuxury(s)
    s.stock.amber = 1000
    expect(architectPrice(s)).toBe(ARCHITECT_PLANS_PRICE)
    expect(buyArchitectPlans(s, 'luxury')).toBeNull()
    expect(s.unlockedBuildings).toContain('tavern')
    expect(s.stock.amber).toBe(1000 - ARCHITECT_PLANS_PRICE)
    expect(s.architectPlans).toBe(1)
    expect(architectPrice(s)).toBe(ARCHITECT_PLANS_PRICE + ARCHITECT_PLANS_GROWTH)
    // The same service's next piece is the workshop for its goods.
    expect(buyArchitectPlans(s, 'luxury')).toBeNull()
    expect(s.unlockedBuildings).toContain('brewery')
    expect(s.stock.amber).toBe(1000 - 2 * ARCHITECT_PLANS_PRICE - ARCHITECT_PLANS_GROWTH)
    // Nothing more of that chain to draw up.
    expect(buyArchitectPlans(s, 'luxury')).toMatch(/Nothing more/)
  })

  it('refuses without the amber, while a blueprint draft is open, and for a service nobody wants', () => {
    const s = newRun()
    lockLuxury(s)
    s.stock.amber = ARCHITECT_PLANS_PRICE - 1
    expect(buyArchitectPlans(s, 'luxury')).toBe('Not enough amber.')
    expect(s.unlockedBuildings).not.toContain('tavern')
    s.stock.amber = 1000
    offerBlueprint(s)
    expect(architectBlocked(s)).toMatch(/draft/)
    expect(buyArchitectPlans(s, 'luxury')).toMatch(/draft/)
    s.pendingChoices = []
    expect(buyArchitectPlans(s, 'rest')).toMatch(/Nothing more/)
    expect(s.stock.amber).toBe(1000)
  })
})

describe('targeted redraw', () => {
  it('redraws the open blueprint draft with the named service’s next piece among fresh cards', () => {
    const s = newRun()
    lockLuxury(s)
    s.stock.amber = 500
    offerBlueprint(s, false)
    const choice = s.pendingChoices[0]
    choice.options = choice.options.filter((id) => id !== 'tavern')
    const before = [...choice.options]
    const cost = targetedRedrawCost(s)
    expect(cost).toBe(REROLL_BASE_COST + TARGETED_REDRAW_SURCHARGE)
    expect(redrawTargets(s).map((t) => t.need)).toContain('luxury')
    expect(redrawToward(s, 'luxury')).toBeNull()
    expect(choice.options).toContain('tavern')
    for (const id of choice.options) expect(before).not.toContain(id)
    expect(s.stock.amber).toBe(500 - cost)
    // It steepens the reroll ladder like any redraw.
    expect(s.rerollsUsed).toBe(1)
    expect(targetedRedrawCost(s)).toBe(REROLL_BASE_COST + REROLL_COST_GROWTH + TARGETED_REDRAW_SURCHARGE)
    // A piece the draft already shows is not offered as a target.
    expect(redrawTargets(s).some((t) => t.piece === 'tavern')).toBe(false)
  })

  it('costs amber even with a Citadel free reroll, and only works on blueprint drafts', () => {
    const s = newRun()
    lockLuxury(s)
    s.citadel = { ...s.citadel!, freeRerolls: 2 }
    s.stock.amber = 0
    offerBlueprint(s, false)
    s.pendingChoices[0].options = s.pendingChoices[0].options.filter((id) => id !== 'tavern')
    expect(redrawToward(s, 'luxury')).toBe('Not enough amber.')
    expect(s.citadel!.freeRerolls).toBe(2)
    s.pendingChoices = [{ kind: 'cornerstone', options: ['x'] }]
    expect(redrawTargets(s)).toEqual([])
    expect(redrawToward(s, 'luxury')).toMatch(/blueprint draft/)
  })
})

describe('the Grand Petition', () => {
  it('opens once impatience is near the limit, from Year 2', () => {
    const s = newRun()
    s.stock.amber = 500
    setImpatience(s, s.maxImpatience - PETITION_WITHIN)
    expect(petitionBlocked(s)).toBe('early')
    toYear(s, 2)
    expect(petitionBlocked(s)).toBeNull()
    setImpatience(s, s.maxImpatience - PETITION_WITHIN - 0.5)
    expect(petitionBlocked(s)).toBe('early')
    expect(petitionOpen(s)).toBe(false)
    setImpatience(s, s.maxImpatience - 2)
    s.stock.amber = PETITION_AMBER - 1
    expect(petitionBlocked(s)).toBe('amber')
    expect(petitionOpen(s)).toBe(true)
    expect(grandPetition(s)).toBe('Not enough amber.')
  })

  it('pays its price for relief and a fresh hearing, on a vow; once a run', () => {
    const s = newRun()
    toYear(s, 4)
    s.stock.amber = 300
    s.reputation = 12
    s.reputationRise = { at: 0, level: 12 }
    setImpatience(s, 15.5)
    expect(stagnationImpatienceRate(s)).toBeGreaterThan(0)
    expect(grandPetition(s)).toBeNull()
    expect(s.stock.amber).toBe(300 - PETITION_AMBER)
    expect(s.impatience + s.impatienceProgress).toBeCloseTo(15.5 - PETITION_RELIEF)
    expect(secondsSinceReputation(s)).toBe(0)
    // Reputation has stood still: the vow is the least, sized to that pace.
    expect(s.petition).toMatchObject({
      target: 12 + PETITION_VOW_MIN,
      vow: PETITION_VOW_MIN,
      deadline: s.clock + PETITION_VOW_SECONDS,
    })
    expect(petitionVowLeft(s)).toBe(PETITION_VOW_SECONDS)
    setImpatience(s, 16)
    expect(petitionBlocked(s)).toBe('used')
    expect(grandPetition(s)).toMatch(/one Grand Petition/)
  })

  it('a vow kept forgives a little more; a vow broken snaps her patience', () => {
    const kept = newRun()
    toYear(kept, 3)
    kept.stock.amber = 300
    setImpatience(kept, 14)
    grandPetition(kept)
    const afterKept = kept.impatience + kept.impatienceProgress
    kept.reputation += PETITION_VOW_REPUTATION
    stepPetition(kept)
    expect(kept.petition?.outcome).toBe('kept')
    expect(kept.impatience + kept.impatienceProgress).toBeCloseTo(afterKept - PETITION_KEPT_RELIEF)

    const broken = newRun()
    toYear(broken, 3)
    broken.stock.amber = 300
    setImpatience(broken, 14)
    grandPetition(broken)
    const afterBroken = broken.impatience + broken.impatienceProgress
    broken.clock = broken.petition!.deadline - 1
    stepPetition(broken)
    expect(broken.petition?.outcome).toBeUndefined()
    broken.clock += 1
    stepPetition(broken)
    expect(broken.petition?.outcome).toBe('broken')
    expect(broken.impatience + broken.impatienceProgress).toBeCloseTo(afterBroken + PETITION_BROKEN_IMPATIENCE)
    // Judged once.
    stepPetition(broken)
    expect(broken.impatience + broken.impatienceProgress).toBeCloseTo(afterBroken + PETITION_BROKEN_IMPATIENCE)
  })

  it('the tick judges the vow, and a broken vow can end the run', () => {
    const s = newRun()
    toYear(s, 4)
    s.stock.amber = 300
    setImpatience(s, s.maxImpatience - 1)
    grandPetition(s)
    s.petition!.deadline = s.clock + 1
    s.reputationRise = { at: s.clock, level: s.reputation }
    for (let i = 0; i < 16 && s.phase === 'playing'; i++) tick(s, 0.125)
    expect(s.petition?.outcome).toBe('broken')
    expect(s.phase).toBe('lost')
  })

  it('says so on the warning strip', () => {
    const s = newRun()
    toYear(s, 3)
    s.stock.amber = 300
    setImpatience(s, s.maxImpatience - 2)
    expect(collectWarnings(s).find((w) => w.id === 'impatience')?.text).toMatch(/Grand Petition/)
    grandPetition(s)
    expect(collectWarnings(s).find((w) => w.id === 'petition-vow')?.text).toMatch(
      new RegExp(`${s.petition!.vow} more reputation`),
    )
  })

  it('vows what the recent pace would earn in its time: at least one point, at most three, never past victory', () => {
    const vowAt = (gained: number, rep = 12) => {
      const s = newRun()
      toYear(s, 4)
      s.reputation = rep
      s.reputationProgress = 0
      // Six minutes ago reputation stood `gained` lower.
      s.timeline.samples = [
        [s.clock - PETITION_PACE_SECONDS - 12, 4, rep - gained, 10, 20, 15, 18, 100, 50],
        [s.clock - PETITION_PACE_SECONDS, 4, rep - gained, 10, 20, 15, 18, 100, 50],
        [s.clock - 12, 4, rep, 10, 20, 15, 18, 100, 50],
      ]
      return { pace: recentReputationPace(s), vow: petitionVow(s) }
    }
    expect(vowAt(0).vow).toBe(PETITION_VOW_MIN)
    expect(vowAt(1.5).pace).toBeCloseTo(1.5 / PETITION_PACE_SECONDS)
    expect(vowAt(1.5).vow).toBe(2)
    expect(vowAt(6).vow).toBe(PETITION_VOW_REPUTATION)
    // One point short, it vows that point.
    expect(vowAt(6, 19).vow).toBe(1)
  })
})

describe("the Queen's final charge", () => {
  it('within three points of victory and stalled: contented villagers earn reputation twice as fast', () => {
    const s = newRun()
    toYear(s, 4)
    for (const sp of s.speciesPool) s.resolve[sp] = 40
    const earn = () => {
      const before = s.reputation + s.reputationProgress
      for (let i = 0; i < 8; i++) {
        // Any milestone offer (the charter) would stop the clock: settle it.
        while (s.pendingChoices.length > 0) takeChoice(s, s.pendingChoices[0].options[0])
        for (const sp of s.speciesPool) s.resolve[sp] = 40
        tick(s, 0.125)
      }
      return s.reputation + s.reputationProgress - before
    }
    // Four short: no charge, however long the stall.
    s.reputation = s.maxReputation - FINAL_CHARGE_WITHIN - 1
    s.reputationProgress = 0
    s.reputationRise = { at: s.clock - 600, level: s.reputation }
    stepFinalCharge(s)
    expect(s.finalCharge).toBeUndefined()
    // Three short, but reputation only just rose: not yet.
    s.reputation = s.maxReputation - FINAL_CHARGE_WITHIN
    s.reputationRise = { at: s.clock, level: s.reputation }
    stepFinalCharge(s)
    expect(s.finalCharge).toBeUndefined()
    expect(finalChargeActive(s)).toBe(false)
    const plain = earn()
    // Stalled past the mark: the charge is given, logged, and resolve pays double.
    s.reputationRise = { at: s.clock - FINAL_CHARGE_STALL, level: s.reputation }
    stepFinalCharge(s)
    expect(s.finalCharge).toEqual({ at: s.clock })
    expect(s.log[0].text).toMatch(/final charge/)
    const charged = earn()
    expect(plain).toBeGreaterThan(0)
    expect(charged / plain).toBeCloseTo(FINAL_CHARGE_RESOLVE_RATE, 1)
    // Once the envoy rides it is over.
    sendEnvoy(s)
    expect(finalChargeActive(s)).toBe(false)
  })

  it('waits for the deadline to near: not before Year 4', () => {
    const s = newRun()
    toYear(s, FINAL_CHARGE_FROM_YEAR - 1)
    s.reputation = s.maxReputation - 1
    s.reputationRise = { at: s.clock - 600, level: s.reputation }
    stepFinalCharge(s)
    expect(s.finalCharge).toBeUndefined()
    toYear(s, FINAL_CHARGE_FROM_YEAR)
    s.reputationRise = { at: s.clock - 600, level: s.reputation }
    stepFinalCharge(s)
    expect(s.finalCharge).toBeDefined()
  })

  it('pays nothing for species below their threshold: a catch-up to earn, not a gift', () => {
    const s = newRun()
    toYear(s, 4)
    s.reputation = s.maxReputation - 2
    s.reputationProgress = 0
    s.finalCharge = { at: s.clock }
    const before = s.reputation + s.reputationProgress
    for (let i = 0; i < 8; i++) {
      while (s.pendingChoices.length > 0) takeChoice(s, s.pendingChoices[0].options[0])
      for (const sp of s.speciesPool) s.resolve[sp] = 0
      tick(s, 0.125)
    }
    expect(s.reputation + s.reputationProgress).toBe(before)
  })

  it('survives a save; a mangled one reads as none', () => {
    const s = newRun()
    s.finalCharge = { at: 600 }
    expect(migrateRun(JSON.parse(JSON.stringify(s)))!.finalCharge).toEqual({ at: 600 })
    const bad = JSON.parse(JSON.stringify(s))
    bad.finalCharge = { at: 'soon' }
    expect(migrateRun(bad)!.finalCharge).toBeUndefined()
  })
})

describe('the Retreat to the Citadel', () => {
  it('is offered only once the run is lost in all but name', () => {
    const s = newRun()
    expect(retreatOffered(s)).toBe(false)
    toYear(s, 4)
    s.reputation = s.maxReputation - RETREAT_REPUTATION_SHORT
    setImpatience(s, s.maxImpatience * RETREAT_IMPATIENCE_SHARE - 0.5)
    expect(retreatOffered(s)).toBe(false)
    expect(retreatToCitadel(s)).toMatch(/can still be held/)
    expect(s.phase).toBe('playing')
    setImpatience(s, s.maxImpatience * RETREAT_IMPATIENCE_SHARE)
    expect(retreatOffered(s)).toBe(true)
    s.reputation += 1
    expect(retreatOffered(s)).toBe(false)
  })

  it('ends the run as a loss that sends home what it has earned', () => {
    const s = newRun()
    toYear(s, 4)
    s.reputation = 9
    s.stats.gladesCleared = 8
    setImpatience(s, 15)
    const asLoss = supplyReward({ ...s, phase: 'lost' })
    expect(retreatToCitadel(s)).toBeNull()
    expect(s.phase).toBe('lost')
    expect(s.retreated).toBe(true)
    expect(supplyReward(s)).toBe(asLoss)
    // Nothing ticks once it is over.
    const clock = s.clock
    tick(s, 1)
    expect(s.clock).toBe(clock)
  })
})

describe('older and mangled saves', () => {
  it('load without the new fields and treat them as never used', () => {
    const s = newRun()
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>
    delete raw.architectPlans
    delete raw.petition
    delete raw.retreated
    const run = migrateRun(raw)!
    expect(architectPrice(run)).toBe(ARCHITECT_PLANS_PRICE)
    expect(petitionBlocked(run)).not.toBe('used')
    expect(run.retreated).toBeUndefined()
  })

  it('drop a mangled petition or plan count', () => {
    const s = newRun()
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>
    raw.architectPlans = 'lots'
    raw.petition = { at: 'soon' }
    raw.retreated = 'yes'
    const run = migrateRun(raw)!
    expect(run.architectPlans).toBeUndefined()
    expect(run.petition).toBeUndefined()
    expect(run.retreated).toBeUndefined()
  })
})

it('every architect piece is a draftable building', () => {
  const s = newRun(['human', 'fox', 'harpy'])
  s.unlockedBuildings = s.unlockedBuildings.filter((id) => !BUILDINGS[id]?.service)
  for (const o of architectOffers(s)) expect(BUILDINGS[o.piece]?.service?.need).toBe(o.need)
})
