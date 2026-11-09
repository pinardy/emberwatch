import type { ResourceBag, ResourceId, RunState } from './types'

/**
 * What the player's own commands have done to the stock of a run, as running
 * totals per good: a building paid for, a sale, a lot bought, goods handed to
 * an order or an event, a refund. Kept beside the run (never saved) so the
 * HUD's stock trends can tell the economy's drift from a one-off spend: a
 * build that takes 20 wood is not wood running dry.
 */
const totals = new WeakMap<RunState, ResourceBag>()

/** Runs `command` on `run` and adds whatever it moved in the stock to the run's totals. */
export function withCommandStock<T>(run: RunState, command: () => T): T {
  const before = { ...run.stock }
  const result = command()
  let bag = totals.get(run)
  const ids = new Set([...Object.keys(before), ...Object.keys(run.stock)]) as Set<ResourceId>
  for (const id of ids) {
    const delta = (run.stock[id] ?? 0) - (before[id] ?? 0)
    if (delta === 0) continue
    if (!bag) totals.set(run, (bag = {}))
    bag[id] = (bag[id] ?? 0) + delta
  }
  return result
}

/** The run's command totals so far (a copy; empty when the player has moved nothing). */
export function commandStockTotals(run: RunState): ResourceBag {
  return { ...(totals.get(run) ?? {}) }
}
