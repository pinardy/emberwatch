import { describe, expect, it } from 'vitest'
import { playRun } from './bot/play'
import {
  ECON_SEEDS,
  ENV,
  SEEDS,
  TRIOS,
  VERDICT_BY_MINUTES,
  isEarlyCollapse,
  logRun,
  mean,
  summarise,
  summariseAmber,
  summarisePlateaus,
  winShare,
} from './bot/harness'
import { summariseTerrain } from './bot/terrainReport'

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
  it('a competent player can win, and the run has a real shape', () => {
    const lines: string[] = []
    const byTrio = TRIOS.map((trio) => {
      const reports = SEEDS.map((seed) => playRun(seed, trio))
      if (ENV.PLAYTEST_VERBOSE) reports.forEach((r, i) => logRun(SEEDS[i], r))
      lines.push(summarise(trio.join('/'), reports))
      return reports
    })
    const competent = byTrio.flat()
    const econ = TRIOS.flatMap((trio) => {
      const reports = ECON_SEEDS.map((seed) => playRun(seed, trio, { economyOnly: true }))
      if (ENV.PLAYTEST_VERBOSE) reports.forEach((r, i) => logRun(ECON_SEEDS[i], r))
      return reports
    })
    lines.push(summarise('all trios', competent))
    lines.push(summarisePlateaus('all trios', competent))
    lines.push(summarise('economy-only', econ))
    lines.push(summariseAmber('amber, all trios', competent))
    lines.push(summariseAmber('amber, economy-only', econ))
    lines.push(summariseTerrain('ground, all trios', competent))
    console.log(lines.join('\n'))

    // A roguelite that can stalemate is broken: every run must reach a verdict,
    // and the Queen's deadline must deliver it in reasonable time.
    for (const r of [...competent, ...econ]) {
      expect(r.phase).not.toBe('playing')
      expect(r.exactMinutes).toBeLessThan(VERDICT_BY_MINUTES)
    }

    // A settlement that slips should have time to notice and respond: emptying
    // out inside the first twelve minutes must be rare.
    expect(competent.filter(isEarlyCollapse).length).toBeLessThanOrEqual(
      Math.ceil(competent.length * 0.05),
    )

    /*
     * The bot plays competently but not well — it trades only by rote, never
     * soothes the Queen, and steers a draft only toward the chain piece it
     * ranks first. Most maps but not all
     * is the shape we want: a real player should comfortably beat this, and a
     * careless one should still lose sometimes.
     */
    const competentShare = winShare(competent)
    expect(competentShare).toBeGreaterThanOrEqual(0.4)
    expect(competentShare).toBeLessThan(0.95)

    // Services are the game. Idling above threshold with none must not win.
    const econShare = winShare(econ)
    expect(econShare).toBeLessThanOrEqual(0.1)
    expect(econShare).toBeLessThanOrEqual(competentShare / 4)

    // Buying a charter must not make the game harder (or much easier).
    const shares = byTrio.map(winShare)
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(0.25)

    const wins = competent.filter((x) => x.phase === 'won')
    // Every win comes through the Envoy's approach, and the approach is a real
    // test without being a coin flip: most settlements that fill their
    // reputation hold for her, and some do not.
    for (const r of wins) expect(r.approach).toBe('held')
    const entered = competent.filter((r) => r.approach !== 'none')
    const held = entered.filter((r) => r.approach === 'held').length
    expect(held / entered.length).toBeGreaterThanOrEqual(0.7)
    expect(held).toBeLessThan(entered.length)
    // Reputation must come mostly from what the player did, not from idling.
    expect(mean(wins.map((r) => r.sources.resolve))).toBeLessThan(10)

    // A win should take a real settlement, not a lucky opening.
    for (const r of wins) {
      expect(r.buildings).toBeGreaterThan(8)
      expect(r.population).toBeGreaterThan(10)
      expect(r.minutes).toBeGreaterThan(8)
    }
  }, 300_000)
})
