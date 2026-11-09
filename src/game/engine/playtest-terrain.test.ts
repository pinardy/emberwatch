import { describe, expect, it } from 'vitest'
import { BIOME_LIST, LAYOUT_LIST } from '../content/layouts'
import { playRun, type BotReport } from './bot/play'
import { ALL_SEEDS, ENV, TRIOS, VERDICT_BY_MINUTES, isEarlyCollapse, mean, summarise, winShare } from './bot/harness'
import { summariseTerrain } from './bot/terrainReport'
import { summariseOrders } from './bot/orderReport'

/**
 * The balance harness on every map layout and biome (`content/layouts.ts`).
 * The main sweep plays whatever its seeds draw — about half of them rings —
 * so this one pins each layout in turn on the same seeds (trios rotating),
 * in the old woodland, and then the Cinderwood on each layout, and checks
 * that none makes runs a formality or a lost cause. See playtest.test.ts for
 * how the harness is split.
 */

/** Seeds per layout, and for the Cinderwood (rotating the layouts). */
const TERRAIN_SEED_COUNT = Number(ENV.PLAYTEST_TERRAIN_SEEDS ?? 16)

describe('balance harness', () => {
  it('every layout and biome stays winnable but not trivial', () => {
    const seeds = ALL_SEEDS.slice(0, TERRAIN_SEED_COUNT)
    const groups: { label: string; reports: BotReport[] }[] = []
    for (const layout of LAYOUT_LIST) {
      groups.push({
        label: layout.id,
        reports: seeds.map((seed, i) => playRun(seed, TRIOS[i % TRIOS.length], { layout: layout.id, biome: 'woodland' })),
      })
    }
    for (const biome of BIOME_LIST.filter((b) => b.terrain)) {
      groups.push({
        label: biome.id,
        reports: seeds.map((seed, i) =>
          playRun(seed, TRIOS[i % TRIOS.length], {
            layout: LAYOUT_LIST[i % LAYOUT_LIST.length].id,
            biome: biome.id,
          }),
        ),
      })
    }
    const all = groups.flatMap((g) => g.reports)
    console.log(
      [
        ...groups.map((g) => summarise(g.label, g.reports)),
        summariseTerrain('terrain sweep', all),
        summariseOrders('orders, terrain', all),
      ].join('\n'),
    )

    for (const { label, reports } of groups) {
      const share = winShare(reports)
      const wins = reports.filter((r) => r.phase === 'won')
      // Winnable for a competent player, and never a formality.
      expect(share, `${label} win share`).toBeGreaterThanOrEqual(0.55)
      expect(share, `${label} win share`).toBeLessThanOrEqual(0.92)
      expect(mean(wins.map((r) => r.exactMinutes)), `${label} avg win`).toBeGreaterThanOrEqual(12)
      expect(reports.filter(isEarlyCollapse).length, `${label} early collapses`).toBeLessThanOrEqual(1)
      for (const r of reports) expect(r.exactMinutes, `${label} verdict`).toBeLessThan(VERDICT_BY_MINUTES)
    }
  }, 600_000)
})
