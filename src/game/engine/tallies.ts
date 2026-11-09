import type { DepositId, OrderTallies, RunState } from '../types'

/**
 * Run-long counts the Queen's orders measure from their draw
 * (`RunState.orderTallies`): caravan lots bought and sold, and goods taken
 * from each kind of deposit. Written where the moment happens, read by
 * `goalCount`. No imports beyond types, so trade and production can call it.
 */

function tallies(s: RunState): OrderTallies {
  return (s.orderTallies ??= {})
}

/** A lot bought from or sold to the caravan. */
export function tallyTrade(s: RunState): void {
  const t = tallies(s)
  t.trades = (t.trades ?? 0) + 1
}

/** Goods a recipe took from a deposit of `kind`. */
export function tallyDepositYield(s: RunState, kind: DepositId, goods: number): void {
  if (goods <= 0) return
  const t = tallies(s)
  t.depositYield ??= {}
  t.depositYield[kind] = (t.depositYield[kind] ?? 0) + goods
}

/** Keeps a saved tally only when it reads as counts; anything else starts afresh. */
export function migrateTallies(run: RunState): void {
  const t = run.orderTallies as unknown
  if (t === undefined) {
    run.orderTallies = {}
    return
  }
  if (typeof t !== 'object' || t === null || Array.isArray(t)) {
    run.orderTallies = {}
    return
  }
  const rec = t as Record<string, unknown>
  const clean: OrderTallies = {}
  if (typeof rec.trades === 'number' && Number.isFinite(rec.trades) && rec.trades >= 0) clean.trades = rec.trades
  const dy = rec.depositYield
  if (typeof dy === 'object' && dy !== null && !Array.isArray(dy)) {
    clean.depositYield = {}
    for (const [k, v] of Object.entries(dy)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) clean.depositYield[k as DepositId] = v
    }
  }
  run.orderTallies = clean
}
