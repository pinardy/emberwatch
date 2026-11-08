import type { SpeciesId } from '../../types'
import type { BotReport, ReputationSources } from './play'

/*
 * The balance harness's seeds, trios, env knobs and report lines, shared by
 * the `playtest*.test.ts` files and the quick harness smoke test.
 */

/**
 * One trio from the starting species and three that need a charter. The
 * fourth, beaver/lizard/fox, was the weakest of all ten possible trios when
 * it was added (lizards' and foxes' deep needs, brawling and rest, both sat
 * behind the weaver at the end of the draft), so the parity check now
 * covers it.
 */
export const TRIOS: SpeciesId[][] = [
  ['human', 'beaver', 'lizard'],
  ['human', 'fox', 'harpy'],
  ['beaver', 'lizard', 'harpy'],
  ['beaver', 'lizard', 'fox'],
]

export const ALL_SEEDS = [
  1, 20260726, 777, 424242, 99, 31337, 8080, 555000, 2024, 13, 4242, 90210, 1234567,
  271828, 314159, 8675309, 42, 1001, 65535, 7, 123, 5150, 60606, 98765,
]

/**
 * Env knobs for local balance sweeps, e.g.
 *   PLAYTEST_SEEDS=8 PLAYTEST_VERBOSE=1 npx vitest run playtest --reporter=verbose --silent=false
 * PLAYTEST_SEED=<n> replays a single seed across every trio.
 */
export const ENV: Record<string, string | undefined> =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
/*
 * Every seed by default. The trio-parity check compares win rates across
 * three groups, and at 16 seeds a single lucky or unlucky map moves a trio by
 * six points — enough to trip a 25-point band on noise alone.
 */
export const SEED_COUNT = Number(ENV.PLAYTEST_SEEDS ?? ALL_SEEDS.length)
export const SEEDS = ENV.PLAYTEST_SEED ? [Number(ENV.PLAYTEST_SEED)] : ALL_SEEDS.slice(0, SEED_COUNT)
/** The economy-only bot is a control group; half the seeds are enough. */
export const ECON_SEEDS = SEEDS.slice(0, Math.max(1, Math.ceil(SEEDS.length / 2)))

/** Seeds per forced map modifier (trios rotate across them). */
export const MODIFIER_SEED_COUNT = Number(ENV.PLAYTEST_MODIFIER_SEEDS ?? 6)

/** Seeds per trio for the careless-warmth frost check. */
export const FROST_SEED_COUNT = Number(ENV.PLAYTEST_FROST_SEEDS ?? 6)

/**
 * Seeds per Citadel commission (trios rotate across them). Twelve, so each
 * commission has enough wins for "met in at least one" to be a real check.
 */
export const COMMISSION_SEED_COUNT = Number(ENV.PLAYTEST_COMMISSION_SEEDS ?? 12)

/** The Queen's deadline must end every run by about this point. */
export const VERDICT_BY_MINUTES = 40

export const isEarlyCollapse = (r: BotReport) => r.phase === 'lost' && r.population === 0 && r.exactMinutes < 12
export const winShare = (rs: BotReport[]) => rs.filter((r) => r.phase === 'won').length / rs.length
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
export const median = (xs: number[]) => {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function summarise(label: string, reports: BotReport[]): string {
  const wins = reports.filter((r) => r.phase === 'won')
  const losses = reports.filter((r) => r.phase === 'lost')
  const stalls = reports.filter((r) => r.phase === 'playing')
  const src = (k: keyof ReputationSources) => mean(wins.map((r) => r.sources[k])).toFixed(1)
  return (
    `${label.padEnd(20)} won ${wins.length}/${reports.length} lost ${losses.length} stall ${stalls.length} early-collapse ${reports.filter(isEarlyCollapse).length}` +
    ` · avg win ${mean(wins.map((r) => r.exactMinutes)).toFixed(1)}min · longest ${Math.max(...reports.map((r) => r.exactMinutes)).toFixed(1)}min` +
    ` · rep in wins: orders ${src('orders')} decrees ${src('decrees')} glades ${src('glades')} events ${src('events')} resolve ${src('resolve')} trade ${src('trade')} (glory ${mean(wins.map((r) => r.glory)).toFixed(1)})` +
    ` · upgrades/run ${mean(reports.map((r) => r.upgrades)).toFixed(1)}` +
    ` · roads/run ${mean(reports.map((r) => r.roads)).toFixed(1)} linked ${mean(reports.map((r) => r.roadLinked)).toFixed(1)}` +
    ` · first rep ${median(reports.map((r) => r.firstRepMinute)).toFixed(1)}min (median)` +
    ` · last-3min share in wins ${(mean(wins.map((r) => r.lateShare)) * 100).toFixed(0)}%` +
    `\n${''.padEnd(20)} tension: median imp at win ${median(wins.map((r) => r.impatience)).toFixed(1)}` +
    ` · median resolve over threshold at win ${median(wins.flatMap((r) => r.overThreshold)).toFixed(1)}` +
    ` · all glades cleared ${((reports.filter((r) => r.gladesCleared >= 14).length / Math.max(1, reports.length)) * 100).toFixed(0)}%` +
    ` · glades ${histogram(reports.map((r) => r.gladesCleared))}` +
    ` · median braziers in wins ${median(wins.map((r) => r.braziers)).toFixed(1)}` +
    ` · villagers lost ${reports.reduce((n, r) => n + r.lost, 0)} (${mean(reports.map((r) => r.lost)).toFixed(2)}/run, ${reports.reduce((n, r) => n + r.frozen, 0)} to frost)` +
    ` · spared/run ${mean(reports.map((r) => r.spared)).toFixed(1)}` +
    ` · causes ${histogram(losses.map((r) => r.cause))}` +
    `\n${''.padEnd(20)} levers: loss minute ${median(losses.map((r) => r.exactMinutes)).toFixed(1)} (median)` +
    ` · unmet needs at end ${median(wins.map((r) => r.unmetCount)).toFixed(1)} in wins, ${median(losses.map((r) => r.unmetCount)).toFixed(1)} in losses (median)` +
    ` · plans/run ${mean(reports.map((r) => r.plans)).toFixed(2)}` +
    ` · petitions ${reports.filter((r) => r.petition !== 'none').length} (${petitionOutcomes(reports)})` +
    ` · retreats ${reports.filter((r) => r.retreated).length} (median minute ${median(reports.filter((r) => r.retreated).map((r) => r.exactMinutes)).toFixed(1)})` +
    `\n${''.padEnd(20)} ${summariseApproach(reports)}`
  )
}

/**
 * The Envoy's approach over a set of runs: how often it was entered and held,
 * what ended the ones that were not, when the envoy set out, and the years
 * the wins landed in.
 */
export function summariseApproach(reports: BotReport[]): string {
  const entered = reports.filter((r) => r.approach !== 'none')
  const held = entered.filter((r) => r.approach === 'held')
  const failed = entered.filter((r) => r.approach !== 'held')
  const wins = reports.filter((r) => r.phase === 'won')
  return (
    `envoy: entered ${entered.length}/${reports.length} held ${held.length}` +
    ` · approach losses ${histogram(failed.map((r) => r.approach))}` +
    ` · set out minute ${median(entered.map((r) => r.envoyMinute)).toFixed(1)} (median)` +
    ` · wait ${median(held.map((r) => r.exactMinutes - r.envoyMinute)).toFixed(1)}min (median)` +
    ` · wins by year ${histogram(wins.map((r) => `Y${r.years}`).sort())}`
  )
}

/** "kept 3 (won 2) broken 1 (won 0)": how petitions ended, and how their runs did. */
export function petitionOutcomes(reports: BotReport[]): string {
  return (['kept', 'broken', 'live'] as const)
    .map((o) => {
      const rs = reports.filter((r) => r.petition === o)
      return rs.length ? `${o} ${rs.length} (won ${rs.filter((r) => r.phase === 'won').length})` : ''
    })
    .filter(Boolean)
    .join(' ') || '-'
}

/** `value×count` pairs, most common first. */
export function histogram(values: (string | number)[]): string {
  const counts = new Map<string | number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => (typeof a[0] === 'number' && typeof b[0] === 'number' ? b[0] - a[0] : b[1] - a[1]))
    .map(([v, n]) => `${v}×${n}`)
    .join(' ') || '-'
}

/** Amber over a set of runs: median earned, spent by sink, and how many saw caravans. */
export function summariseAmber(label: string, reports: BotReport[]): string {
  const spentTotal = (r: BotReport) => Object.values(r.amber.spent).reduce((a, b) => a + b, 0)
  const perRun = (pick: (r: BotReport) => Record<string, number>) => {
    const sums = new Map<string, number>()
    for (const r of reports) {
      for (const [k, v] of Object.entries(pick(r))) sums.set(k, (sums.get(k) ?? 0) + v)
    }
    return [...sums.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${(v / reports.length).toFixed(0)}`)
      .join(' ')
  }
  const bySink = perRun((r) => r.amber.spent)
  const bySource = perRun((r) => r.amber.earnedBy)
  const traders = reports.filter((r) => r.amber.caravans)
  const split = (rs: BotReport[]) =>
    `earned ${median(rs.map((r) => r.amber.earned)).toFixed(0)} spent ${median(rs.map(spentTotal)).toFixed(0)} left ${median(rs.map((r) => r.amber.end)).toFixed(0)}`
  const homebound = reports.filter((r) => !r.amber.caravans)
  return (
    `${label.padEnd(20)} amber earned ${median(reports.map((r) => r.amber.earned)).toFixed(0)} (median; per run from ${bySource}) spent ${median(reports.map(spentTotal)).toFixed(0)} left ${median(reports.map((r) => r.amber.end)).toFixed(0)}` +
    ` · spent/run by sink: ${bySink || 'none'} · caravans in ${traders.length}/${reports.length} runs (${mean(traders.map((r) => r.amber.visits)).toFixed(1)} visits)` +
    ` · with caravans ${split(traders)} · without ${split(homebound)} (medians)`
  )
}

export function logRun(seed: number, r: BotReport): void {
  console.log(
    `seed ${seed}: ${r.phase} · Y${r.years} ${r.minutes}min · rep ${r.reputation} imp ${r.impatience} · pop ${r.population} lost ${r.lost} · glades ${r.gladesCleared} spared ${r.spared} · frozen ${r.frozen} · orders ${r.ordersCompleted} · decrees ${r.decreesMet}/${r.decreesMet + r.decreesMissed} · bld ${r.buildings} · host ${r.hostility} · braziers ${r.braziers} · upgrades ${r.upgrades} · roads ${r.roads}/${r.roadLinked} linked · first rep ${r.firstRepMinute.toFixed(1)}min · late ${(r.lateShare * 100).toFixed(0)}% · ${r.resolve} · unmet ${r.unmetNeeds}${r.starving ? ' STARVING' : ''}${r.coldHearth ? ' COLD' : ''}` +
      ` · cause ${r.cause} · impBy cal ${r.impatienceBy.calendar.toFixed(1)} stall ${r.impatienceBy.stalling.toFixed(1)} stag ${r.impatienceBy.stagnation.toFixed(1)} dl ${r.impatienceBy.deadline.toFixed(1)} lost ${r.impatienceBy.losses.toFixed(1)} ev ${r.impatienceBy.events.toFixed(1)} · over ${r.overThreshold.map((x) => x.toFixed(0)).join('/')} · blights ${r.blights.struck}/${r.blights.blunted} of ${r.blights.forecast} · wards ${r.wardMinutes.toFixed(1)} · stallImp ${r.stallImpatience.toFixed(1)}` +
      ` · plans ${r.plans} petition ${r.petition}${r.retreated ? ' RETREAT' : ''}` +
      ` · amber +${r.amber.earned.toFixed(0)} -${Object.entries(r.amber.spent).map(([k, v]) => `${k}:${v.toFixed(0)}`).join(',') || '0'} =${r.amber.end.toFixed(0)}${r.amber.caravans ? ` caravans ${r.amber.visits}` : ''}` +
      `\n    services: ${r.services}\n    drafted: ${r.drafted}\n    land: ${r.modifiers || 'none'} · open orders: ${r.openOrders}\n    reputation by minute: ${r.curve.join(' ')}`,
  )
}
