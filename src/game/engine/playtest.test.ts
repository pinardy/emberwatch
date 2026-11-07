import { describe, expect, it } from 'vitest'
import { ALL_RUN_MODIFIER_LIST } from '../content/runModifiers'
import { COMMISSIONS, COMMISSION_LIST } from '../content/commissions'
import { createRun } from './createRun'
import { foodStock, population, totalHousing } from './queries'
import { tick } from './tick'
import { DECISION_INTERVAL, STEP, answerChoices, build, explore, playRun, staff } from './bot/play'
import {
  ALL_SEEDS,
  COMMISSION_SEED_COUNT,
  ECON_SEEDS,
  ENV,
  FROST_SEED_COUNT,
  MODIFIER_SEED_COUNT,
  SEEDS,
  TRIOS,
  VERDICT_BY_MINUTES,
  isEarlyCollapse,
  logRun,
  mean,
  median,
  summarise,
  summariseAmber,
  winShare,
} from './bot/harness'

/**
 * End-to-end balance harness: the bot in `bot/play.ts` plays whole runs and
 * these bands say what a competent player's results must look like. If a
 * competent player cannot finish a run, the numbers in `balance.ts` are wrong.
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
    lines.push(summarise('economy-only', econ))
    lines.push(summariseAmber('amber, all trios', competent))
    lines.push(summariseAmber('amber, economy-only', econ))
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
    // Reputation must come mostly from what the player did, not from idling.
    expect(mean(wins.map((r) => r.sources.resolve))).toBeLessThan(10)

    // A win should take a real settlement, not a lucky opening.
    for (const r of wins) {
      expect(r.buildings).toBeGreaterThan(8)
      expect(r.population).toBeGreaterThan(10)
      expect(r.minutes).toBeGreaterThan(8)
    }
  }, 300_000)

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
  }, 300_000)

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
  }, 300_000)

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
  }, 300_000)

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
