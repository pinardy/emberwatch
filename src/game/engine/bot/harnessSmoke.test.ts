import { describe, expect, it } from 'vitest'
import { createRun } from '../createRun'
import { foodStock, population, totalHousing } from '../queries'
import { tick } from '../tick'
import { ALL_SEEDS, TRIOS, VERDICT_BY_MINUTES, isEarlyCollapse, summarise, winShare } from './harness'
import { DECISION_INTERVAL, STEP, answerChoices, build, explore, playRun, staff } from './play'

/*
 * A quick pass of the balance harness for `npm test`: four seeds spread over
 * the sweep's list (the first few are easy maps) on every trio, and the
 * economy-only control on one. The full sweep and its
 * tight bands are `npm run test:balance` (the playtest*.test.ts files); this
 * only catches a change that breaks the bot or the game outright, so its
 * bands are wide enough to survive ordinary retuning.
 */
const SMOKE_SEEDS = [0, 6, 12, 18].map((i) => ALL_SEEDS[i])

describe('balance harness smoke', () => {
  it('the bot still finishes runs, wins some and loses some, and services still matter', () => {
    const competent = TRIOS.flatMap((trio) => SMOKE_SEEDS.map((seed) => playRun(seed, trio)))
    const econ = TRIOS.map((trio) => playRun(SMOKE_SEEDS[0], trio, { economyOnly: true }))
    console.log(`${summarise('smoke', competent)}\n${summarise('smoke economy-only', econ)}`)

    for (const r of [...competent, ...econ]) {
      expect(r.phase).not.toBe('playing')
      expect(r.exactMinutes).toBeLessThan(VERDICT_BY_MINUTES)
    }
    expect(competent.filter(isEarlyCollapse).length).toBeLessThanOrEqual(1)

    const share = winShare(competent)
    expect(share).toBeGreaterThanOrEqual(0.25)
    expect(share).toBeLessThan(1)
    expect(winShare(econ)).toBeLessThanOrEqual(0.25)

    for (const r of competent.filter((x) => x.phase === 'won')) {
      expect(r.buildings).toBeGreaterThan(8)
      expect(r.population).toBeGreaterThan(10)
      expect(r.minutes).toBeGreaterThan(8)
    }
  }, 120_000)

  // Moved here from playtest.test.ts: it takes a fraction of a second, so it
  // belongs in the default suite rather than only in the full harness.
  it('grows a settlement past its starting six villagers', () => {
    const s = createRun({ seed: 4242, species: ['human', 'fox', 'harpy'] })
    let sinceDecision = Infinity
    while (s.phase === 'playing' && s.clock < 600) {
      answerChoices(s)
      if (sinceDecision >= DECISION_INTERVAL) {
        sinceDecision = 0
        build(s)
        explore(s)
        staff(s)
      }
      tick(s, STEP)
      sinceDecision += STEP
    }
    expect(population(s)).toBeGreaterThan(6)
    expect(totalHousing(s)).toBeGreaterThan(0)
    expect(foodStock(s)).toBeGreaterThan(0)
    expect(s.stats.buildingsBuilt).toBeGreaterThan(3)
  }, 60_000)
})
