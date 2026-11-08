import { describe, expect, it } from 'vitest'
import { ALL_RUN_MODIFIER_LIST } from '../content/runModifiers'
import { playRun } from './bot/play'
import {
  ALL_SEEDS,
  FROST_SEED_COUNT,
  MODIFIER_SEED_COUNT,
  TRIOS,
  VERDICT_BY_MINUTES,
  isEarlyCollapse,
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
   * Every run now draws one or two map modifiers, so the sweep above already
   * mixes them in — but a seed sample can miss one entirely. Force each in
   * turn on a smaller set (rotating the trios) and compare against the same
   * seeds with no modifier, so no single twist makes runs unwinnable or turns
   * them into a formality.
   */
  it('no single map modifier makes runs unwinnable or trivial', () => {
    const seeds = ALL_SEEDS.slice(0, MODIFIER_SEED_COUNT)
    const sweep = (modifiers: string[]) =>
      seeds.map((seed, i) => playRun(seed, TRIOS[i % TRIOS.length], { modifiers }))
    const baseline = sweep([])
    const lines = [summarise('no modifier', baseline)]
    // The Citadel-locked lands too: an upgrade can put any of them in play.
    const results = ALL_RUN_MODIFIER_LIST.map((def) => {
      const reports = sweep([def.id])
      lines.push(summarise(def.id, reports))
      return { id: def.id, reports }
    })
    console.log(lines.join('\n'))

    const baseShare = winShare(baseline)
    for (const { id, reports } of results) {
      const share = winShare(reports)
      const wins = reports.filter((r) => r.phase === 'won')
      // Winnable: a competent player still takes a fair share of these maps,
      // and not far fewer than without the modifier.
      expect(share, `${id} win share`).toBeGreaterThanOrEqual(1 / 3)
      expect(share, `${id} vs baseline`).toBeGreaterThanOrEqual(baseShare - 0.5)
      // Not trivial: wins still take a real settlement and a real while.
      expect(mean(wins.map((r) => r.exactMinutes)), `${id} avg win`).toBeGreaterThanOrEqual(12)
      for (const r of wins) expect(r.exactMinutes, `${id} win time`).toBeGreaterThan(8)
      // And a twist must not empty the settlement in the opening minutes.
      expect(reports.filter(isEarlyCollapse).length, `${id} early collapses`).toBeLessThanOrEqual(1)
      for (const r of reports) expect(r.exactMinutes).toBeLessThan(VERDICT_BY_MINUTES)
    }
  }, 600_000)

  /*
   * Frost has killed nobody in the competent bot's runs: it keeps its homes
   * inside the hearth's reach, raises braziers for any that sprawl, and its
   * comfort upgrades insulate the starting shelters. That is a careful
   * player's reward, not a toothless rule — a player who under-builds warmth
   * (homes beside the camps, no braziers, no insulating upgrades) must still
   * lose villagers to the cold in a fair share of runs.
   */
  it('the cold takes villagers from a player who under-builds warmth', () => {
    const seeds = ALL_SEEDS.slice(0, FROST_SEED_COUNT)
    const reports = TRIOS.flatMap((trio) => seeds.map((seed) => playRun(seed, trio, { carelessWarmth: true })))
    const frozen = reports.reduce((n, r) => n + r.frozen, 0)
    const struck = reports.filter((r) => r.frozen > 0).length
    console.log(
      `${summarise('careless warmth', reports)}\n${''.padEnd(20)} frost: ${frozen} villagers lost in ${struck}/${reports.length} runs` +
        ` · median cold villager-seconds ${median(reports.map((r) => r.coldSeconds)).toFixed(0)}` +
        ` · most cold at once ${Math.max(...reports.map((r) => r.peakCold))}`,
    )
    expect(struck).toBeGreaterThanOrEqual(Math.ceil(reports.length / 8))
    expect(frozen).toBeGreaterThanOrEqual(struck)
    // Punishing, not a death sentence: careless runs still reach a verdict in time.
    for (const r of reports) expect(r.exactMinutes).toBeLessThan(VERDICT_BY_MINUTES)
  }, 600_000)
})
