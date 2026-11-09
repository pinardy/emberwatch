import { ORDER_LIST } from '../../content/orders'
import { GROUND_ORDER_KINDS } from '../orders'
import type { BotReport } from './play'

/*
 * The harness's view of the Queen's orders: for each order on the run's own
 * ground and systems (the goal kinds `bot/orders.ts` plays), how many runs
 * were offered it, took it and met it; and the same in total for the older
 * kinds. Kept apart from `harness.ts`, like the terrain report.
 */

function tally(reports: BotReport[], ids: ReadonlySet<string>) {
  let offered = 0
  let taken = 0
  let met = 0
  for (const r of reports) {
    offered += r.ordersOffered.filter((id) => ids.has(id)).length
    taken += r.ordersDrawn.filter((id) => ids.has(id)).length
    met += r.ordersMet.filter((id) => ids.has(id)).length
  }
  return { offered, taken, met }
}

/** Two lines: each newer order's offered/taken/met counts, then the older orders' totals. */
export function summariseOrders(label: string, reports: BotReport[]): string {
  const ground = ORDER_LIST.filter((d) => GROUND_ORDER_KINDS.has(d.goal.kind))
  const older = new Set(ORDER_LIST.filter((d) => !GROUND_ORDER_KINDS.has(d.goal.kind)).map((d) => d.id))
  const each = ground.map((d) => {
    const t = tally(reports, new Set([d.id]))
    return `${d.id} ${t.offered}/${t.taken}/${t.met}`
  })
  const all = tally(reports, new Set(ground.map((d) => d.id)))
  const old = tally(reports, older)
  const perRun = (n: number) => (n / Math.max(1, reports.length)).toFixed(2)
  return (
    `${label.padEnd(20)} ground orders offered/taken/met: ${each.join(' · ')}` +
    `\n${''.padEnd(20)} all ground orders ${all.offered}/${all.taken}/${all.met} (met ${perRun(all.met)}/run)` +
    ` · older orders ${old.offered}/${old.taken}/${old.met} (met ${perRun(old.met)}/run)`
  )
}
