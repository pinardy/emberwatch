import { ORDER_LIST } from '../content/orders'
import type { Order, RunState } from '../types'
import { makeRng } from './rng'

/*
 * Kept apart from `createRun` so the running game does not pull in the run
 * factory and the map generator, which load only when a new run is created.
 */

/** Draws a fresh order the run has not seen yet and appends it. */
export function drawOrder(s: RunState): Order | null {
  const rng = makeRng(s.seed, s.rngCursor)
  const activeDefIds = s.orders.filter((o) => !o.complete).map((o) => o.defId)
  let pool = ORDER_LIST.filter(
    (d) => !s.ordersSeen.includes(d.id) && !activeDefIds.includes(d.id),
  )
  // Once every order has been seen, allow repeats rather than running dry.
  if (pool.length === 0) {
    pool = ORDER_LIST.filter((d) => !activeDefIds.includes(d.id))
  }
  if (pool.length === 0) {
    s.rngCursor = rng.cursor()
    return null
  }
  const def = rng.pick(pool)
  s.rngCursor = rng.cursor()
  s.ordersSeen.push(def.id)

  const order: Order = {
    id: `o${s.orderCounter++}`,
    defId: def.id,
    progress: 0,
    complete: false,
  }
  s.orders.push(order)
  return order
}
