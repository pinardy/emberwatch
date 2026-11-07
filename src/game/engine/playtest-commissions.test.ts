import { describe, expect, it } from 'vitest'
import { COMMISSIONS, COMMISSION_LIST } from '../content/commissions'
import { playRun } from './bot/play'
import {
  ALL_SEEDS,
  COMMISSION_SEED_COUNT,
  ENV,
  TRIOS,
  VERDICT_BY_MINUTES,
  isEarlyCollapse,
  logRun,
  mean,
  median,
  summarise,
  winShare,
} from './bot/harness'

/**
 * End-to-end balance harness: the bot in `bot/play.ts` plays whole runs and
 * these bands say what a competent player's results must look like. If a
 * competent player cannot finish a run, the numbers in `balance.ts` are wrong.
 *
 * The harness is split over playtest.test.ts (the main sweep),
 * playtest-lands.test.ts (map modifiers, frost) and
 * playtest-commissions.test.ts so vitest runs the three in parallel.
 * `npm run test:balance` runs them all; `npm test` runs only the quick
 * smoke in bot/harnessSmoke.test.ts.
 */

describe('balance harness', () => {
  /*
   * A commission's twist is a run-long change like a land's, so each gets the
   * same check as the modifiers: forced on in turn over a few seeds (rotating
   * the trios) against the same seeds with none. The bot pursues each
   * commission's terms the way a competent player would (its tactics are in
   * `playtestCommissions.ts`), so how often the objective is met in wins is
   * a measure of its difficulty — printed per commission, and never zero.
   */
  it('no Citadel commission makes runs unwinnable or trivial', () => {
    const seeds = ALL_SEEDS.slice(0, COMMISSION_SEED_COUNT)
    const sweep = (commission?: string) =>
      seeds.map((seed, i) => playRun(seed, TRIOS[i % TRIOS.length], { commission }))
    const baseline = sweep()
    const lines = [summarise('no commission', baseline)]
    const results = COMMISSION_LIST.map((def) => {
      const reports = sweep(def.id)
      if (ENV.PLAYTEST_VERBOSE) {
        reports.forEach((r, i) => {
          logRun(seeds[i], r)
          console.log(`    commission ${def.id}: ${r.commissionMet ? 'MET' : 'not met'} · ${r.commissionTerms}`)
        })
      }
      const met = reports.filter((r) => r.commissionMet).length
      const wins = reports.filter((r) => r.phase === 'won').length
      lines.push(`${summarise(def.id, reports)} · objective met ${met}/${wins} wins`)
      return { id: def.id, reports }
    })
    // One line per commission: how winnable, how often met, how long.
    for (const { id, reports } of results) {
      const wins = reports.filter((r) => r.phase === 'won')
      const met = wins.filter((r) => r.commissionMet)
      lines.push(
        `${`commission ${id}`.padEnd(28)} won ${wins.length}/${reports.length}` +
          ` · met ${met.length}/${wins.length} wins (+${COMMISSIONS[id].bonusPercent}%)` +
          ` · median run ${median(reports.map((r) => r.exactMinutes)).toFixed(1)}min` +
          ` · median win ${median(wins.map((r) => r.exactMinutes)).toFixed(1)}min`,
      )
    }
    console.log(lines.join('\n'))

    const baseShare = winShare(baseline)
    for (const { id, reports } of results) {
      const share = winShare(reports)
      const wins = reports.filter((r) => r.phase === 'won')
      expect(share, `${id} win share`).toBeGreaterThanOrEqual(1 / 3)
      expect(share, `${id} vs baseline`).toBeGreaterThanOrEqual(baseShare - 0.5)
      expect(mean(wins.map((r) => r.exactMinutes)), `${id} avg win`).toBeGreaterThanOrEqual(12)
      for (const r of wins) expect(r.exactMinutes, `${id} win time`).toBeGreaterThan(8)
      expect(reports.filter(isEarlyCollapse).length, `${id} early collapses`).toBeLessThanOrEqual(1)
      for (const r of reports) expect(r.exactMinutes).toBeLessThan(VERDICT_BY_MINUTES)
      // Never met without a win, whatever else held.
      for (const r of reports) if (r.commissionMet) expect(r.phase).toBe('won')
      // And never out of reach: a competent player pursuing it meets it in
      // at least one win, so retuning cannot quietly make one impossible.
      expect(wins.filter((r) => r.commissionMet).length, `${id} met in a win`).toBeGreaterThanOrEqual(1)
    }
  }, 600_000)
})
