import { BUILDINGS, BUILDING_LIST } from '../content/buildings'
import { COUNTING_ORDER, ORDERS, ORDER_LIST, WRIT_LIST, describeGoal, evaluateGoal } from '../content/orders'
import { RESOURCE_LIST } from '../content/resources'
import type { DepositId, Order, OrderDef, OrderGoal, PendingChoice, ResourceId, RunState } from '../types'
import {
  ORDER_COUNT_MIN,
  ORDER_COUNT_SECONDS,
  ORDER_DECLINE_IMPATIENCE,
  ORDER_MAX_START_PROGRESS,
  ORDER_MAX_START_RESOLVE,
  ORDER_REACH,
  ORDER_SLOTS,
} from './balance'
import { pushLog } from './runLog'
import { productionRate } from './forecast'
import { computeModifiers } from './modifiers'
import { averageResolve, grantProduced, spend, totalHousing } from './queries'
import { makeRng, type Rng } from './rng'
import { addImpatience, addReputation } from './society'
import { describeTimedGoal, goalCount, goalProgress } from './structure'

/**
 * The Queen's orders: three standing goals, each paying reputation when met.
 *
 *  - **Drawn to fit.** A candidate must be reachable from what the settlement
 *    has unlocked (a three-blueprint smelting chain it cannot build is never
 *    asked for), within reach of where it stands, and not already mostly met
 *    — so no order completes the instant it is chosen and none clogs a slot
 *    all run. When nothing qualifies, the Queen asks for a counting goal
 *    ("produce 40 more planks") sized from what the settlement makes.
 *  - **Chosen.** An empty slot is refilled by a choice of two candidates, and
 *    once a year the player may ask for a different pair at a small price in
 *    patience. The choice waits in the Orders panel (`orderOffers`) without
 *    stopping the clock; the slot stays empty until one is taken.
 *  - **The founding writ.** The run opens with a choice of three small goals
 *    worth a first point of reputation in the opening minutes.
 *
 * All randomness goes through the run RNG, so seeds and saves replay exactly.
 */

/** The option id that declines an order or decree offer. */
export const DECLINE_CHOICE = 'decline'

/** An order's definition (shared by every instance drawn from it). */
export function orderDef(order: Order): OrderDef | undefined {
  return ORDERS[order.defId]
}

/** The goal an order instance is measured against. */
export function orderGoal(order: Order): OrderGoal | undefined {
  return order.goal ?? ORDERS[order.defId]?.goal
}

/** 0..1 progress, counting from the order's baseline where it has one. */
export function orderProgress(s: RunState, order: Order): number {
  const goal = orderGoal(order)
  if (!goal) return 0
  return order.baseline === undefined ? evaluateGoal(goal, s) : goalProgress(goal, s, order.baseline)
}

/** The goal in words: "Have 30 Planks in the stockpile", "Produce 40 more Stone". */
export function describeOrder(order: Order): string {
  const goal = orderGoal(order)
  if (!goal) return ''
  return order.baseline === undefined ? describeGoal(goal) : describeTimedGoal(goal)
}

/**
 * Reputation an order pays: the founding writ's fixed first point, whatever
 * bends the other orders; any other order's reward after run-long bonuses.
 */
export function orderReputation(s: RunState, order: Pick<Order, 'defId' | 'writ'>): number {
  const base = ORDERS[order.defId]?.reputationReward ?? 0
  return order.writ ? base : Math.max(0, base + computeModifiers(s).orderReputation)
}

// ---------------------------------------------------------------------------
// Which orders fit this settlement
// ---------------------------------------------------------------------------

function depositExists(s: RunState, kind: DepositId): boolean {
  for (const d of Object.values(s.deposits)) {
    if (d.kind === kind && (d.amount === null || d.amount > 0)) return true
  }
  return false
}

/**
 * True when the settlement's unlocked blueprints form a whole chain to
 * `resource`: a building with a recipe that makes it, on a deposit the map
 * has, from inputs that can themselves be made. Tools need a toolshop *and*
 * a smelter *and* a copper mine on an ore seam.
 */
export function canMake(s: RunState, resource: ResourceId, seen: ReadonlySet<string> = new Set()): boolean {
  if (seen.has(resource)) return false
  const path = new Set(seen).add(resource)
  for (const id of s.unlockedBuildings) {
    const def = BUILDINGS[id]
    if (!def) continue
    for (const recipe of def.recipes) {
      if (((recipe.outputs as Record<string, number>)[resource] ?? 0) <= 0) continue
      if (recipe.requiresDeposit && !depositExists(s, recipe.requiresDeposit)) continue
      const inputs = Object.keys(recipe.inputs) as ResourceId[]
      if (inputs.every((input) => canMake(s, input, path))) return true
    }
  }
  return false
}

/** Whether the settlement has a whole route to meeting an order's goal. */
export function orderFeasible(goal: OrderGoal, s: RunState): boolean {
  switch (goal.kind) {
    case 'stock':
    case 'produced':
      return canMake(s, goal.resource)
    case 'stockCategory':
    case 'producedCategory':
      return RESOURCE_LIST.some((r) => r.category === goal.category && canMake(s, r.id))
    case 'buildingId':
      return s.unlockedBuildings.includes(goal.buildingId)
    case 'buildingsOfCategory':
    case 'staffed':
      return BUILDING_LIST.some(
        (b) => b.category === goal.category && s.unlockedBuildings.includes(b.id),
      )
    case 'gladesCleared':
      return Object.values(s.glades).filter((g) => g.kind !== 'settlement').length >= goal.amount
    default:
      return true
  }
}

/** Built buildings matching the goal's id or category. */
function builtCount(s: RunState, goal: OrderGoal): number {
  let n = 0
  for (const b of Object.values(s.buildings)) {
    if (!b.built) continue
    if (goal.kind === 'buildingId' && b.defId === goal.buildingId) n++
    if (goal.kind === 'buildingsOfCategory' && BUILDINGS[b.defId]?.category === goal.category) n++
  }
  return n
}

/** Not so far beyond where the settlement stands that it would sit all run. */
function withinReach(goal: OrderGoal, s: RunState): boolean {
  switch (goal.kind) {
    case 'population':
      return goal.amount <= Object.keys(s.villagers).length + ORDER_REACH.population
    case 'housing':
      return goal.amount <= totalHousing(s) + ORDER_REACH.housing
    case 'gladesCleared': {
      // Counted from the draw: that many glades must still stand to clear.
      // Glades left to the forest are not there to clear.
      const standing = Object.values(s.glades).filter(
        (g) => g.kind !== 'settlement' && !g.cleared && !g.spared,
      ).length
      return goal.amount <= ORDER_REACH.glades && goal.amount <= standing
    }
    case 'buildingId':
    case 'buildingsOfCategory':
      return goal.amount <= builtCount(s, goal) + ORDER_REACH.buildings
    case 'resolveAbove':
      return averageResolve(s) >= goal.value - ORDER_REACH.resolve
    default:
      return true
  }
}

/**
 * Whether an order with this goal may be offered now: reachable, within
 * reach, and not already mostly met.
 */
export function orderEligible(goal: OrderGoal, s: RunState): boolean {
  if (!orderFeasible(goal, s) || !withinReach(goal, s)) return false
  if (countsFromDraw(goal)) return true
  const cap = goal.kind === 'resolveAbove' ? ORDER_MAX_START_RESOLVE : ORDER_MAX_START_PROGRESS
  return evaluateGoal(goal, s) < cap
}

// ---------------------------------------------------------------------------
// Drawing candidates
// ---------------------------------------------------------------------------

/** The resource a counting order asks for, if it is one. */
function countingResource(order: Order): ResourceId | null {
  if (order.defId !== COUNTING_ORDER.id) return null
  const goal = orderGoal(order)
  return goal?.kind === 'produced' ? goal.resource : null
}

/** What the open orders and the other candidates already ask for. */
interface Taken {
  defIds: Set<string>
  counting: Set<ResourceId>
}

function takenBy(s: RunState, extra: Order[] = []): Taken {
  const taken: Taken = { defIds: new Set(), counting: new Set() }
  for (const order of [...s.orders.filter((o) => !o.complete), ...extra]) {
    taken.defIds.add(order.defId)
    const resource = countingResource(order)
    if (resource) taken.counting.add(resource)
  }
  return taken
}

/**
 * Goals an ordinary order measures from the moment it is drawn: meals cooked,
 * and glades cleared (clearing already pays reputation every few glades, so a
 * lifetime glade count paid twice for the same expansion).
 */
function countsFromDraw(goal: OrderGoal): boolean {
  return goal.kind === 'producedCategory' || goal.kind === 'gladesCleared'
}

function newOrder(s: RunState, def: OrderDef, extra: Partial<Order> = {}): Order {
  const order: Order = {
    id: `o${s.orderCounter++}`,
    defId: def.id,
    progress: 0,
    complete: false,
    ...(countsFromDraw(def.goal) ? { baseline: goalCount(def.goal, s) ?? 0 } : {}),
    ...extra,
  }
  order.progress = orderProgress(s, order)
  return order
}

/**
 * A counting order: "produce N more" of something the settlement makes now,
 * sized from its current rate. Falls back to wood (every settlement can fell
 * trees) when nothing is being made yet.
 */
function countingOrder(s: RunState, rng: Rng, taken: Taken): Order | null {
  const mods = computeModifiers(s)
  const making = RESOURCE_LIST.map((r) => ({ id: r.id, rate: productionRate(s, mods, r.id) })).filter(
    (r) => r.rate > 0 && r.id !== 'amber' && !taken.counting.has(r.id),
  )
  let pick: { id: ResourceId; rate: number } | undefined = making.length > 0 ? rng.pick(making) : undefined
  if (!pick && !taken.counting.has('wood')) pick = { id: 'wood', rate: 0 }
  if (!pick) return null
  const amount = Math.max(ORDER_COUNT_MIN, Math.round((pick.rate * ORDER_COUNT_SECONDS) / 5) * 5)
  const goal: OrderGoal = { kind: 'produced', resource: pick.id, amount }
  return newOrder(s, COUNTING_ORDER, { goal, baseline: goalCount(goal, s) ?? 0 })
}

/**
 * Draws one candidate the settlement can pursue, is not already pursuing and
 * has not taken before; a counting order when none fits. (Repeating a stock
 * order that has been met once is a free point for any economy.)
 */
function drawCandidate(s: RunState, rng: Rng, taken: Taken): Order | null {
  const pool = ORDER_LIST.filter(
    (d) => !taken.defIds.has(d.id) && !s.ordersSeen.includes(d.id) && orderEligible(d.goal, s),
  )
  if (pool.length > 0) return newOrder(s, rng.pick(pool))
  return countingOrder(s, rng, taken)
}

/** Up to `count` distinct candidates. */
function drawCandidates(s: RunState, count: number, exclude: Order[] = []): Order[] {
  const rng = makeRng(s.seed, s.rngCursor)
  const out: Order[] = []
  for (let i = 0; i < count; i++) {
    const taken = takenBy(s, [...exclude, ...out])
    const order = drawCandidate(s, rng, taken)
    if (!order) break
    out.push(order)
  }
  s.rngCursor = rng.cursor()
  return out
}

/** Marks an order as live: it joins the slots and counts as seen. */
function accept(s: RunState, order: Order): void {
  order.progress = orderProgress(s, order)
  s.orders.push(order)
  if (order.defId !== COUNTING_ORDER.id && !order.writ) s.ordersSeen.push(order.defId)
}

/**
 * Draws one order straight into the slots, without asking — the run's
 * opening orders, and a fallback for code that just needs one filled.
 */
export function drawOrder(s: RunState): Order | null {
  const [order] = drawCandidates(s, 1)
  if (!order) return null
  accept(s, order)
  return order
}

/** Order offers still waiting: the Orders panel's, and any order choice queued as a pop-up (the writ). */
function orderChoices(s: RunState): PendingChoice[] {
  return [...(s.orderOffers ?? []), ...s.pendingChoices.filter((c) => c.kind === 'order')]
}

/** Empty order slots not already waiting on a choice. */
export function openOrderSlots(s: RunState): number {
  return ORDER_SLOTS - s.orders.filter((o) => !o.complete).length - orderChoices(s).length
}

/**
 * Offers a choice of two orders for an empty slot, in the Orders panel: it
 * does not stop the clock. False when none can be drawn.
 */
export function offerOrders(s: RunState): boolean {
  const orders = drawCandidates(s, 2, queuedCandidates(s))
  if (orders.length === 0) return false
  s.orderOffers ??= []
  s.orderOffers.push({ kind: 'order', options: orders.map((o) => o.id), orders })
  return true
}

/** Candidates already offered in waiting choices, so two offers differ. */
function queuedCandidates(s: RunState, except?: PendingChoice): Order[] {
  return orderChoices(s)
    .filter((c) => c !== except)
    .flatMap((c) => c.orders ?? [])
}

/** Queues the founding writ: a choice of three small Year-1 goals. */
export function offerWrit(s: RunState): void {
  const orders = WRIT_LIST.filter((def) => evaluateGoal(def.goal, s) < 1).map((def) =>
    newOrder(s, def, { writ: true }),
  )
  if (orders.length === 0) return
  s.pendingChoices.push({ kind: 'order', options: orders.map((o) => o.id), orders })
}

/** True when this offer is the founding writ. */
export function isWritChoice(choice: PendingChoice): boolean {
  return choice.kind === 'order' && (choice.orders ?? []).some((o) => o.writ)
}

/**
 * Whether the player may turn this order offer down right now: once a year,
 * never the writ. Returns the reason when not.
 */
export function orderDeclineBlocked(s: RunState, choice: PendingChoice): string | null {
  if (isWritChoice(choice)) return 'The founding writ is not up for negotiation.'
  if (s.orderDeclineYear === s.season.year) return 'You have already asked once this year.'
  return null
}

/**
 * Applies a pick from an order offer. Returns true when the offer is settled
 * (the caller retires it); a decline redraws it in place and returns false.
 */
export function takeOrderChoice(s: RunState, choice: PendingChoice, optionId: string): boolean {
  if (optionId === DECLINE_CHOICE) {
    declineOrders(s, choice)
    return false
  }
  const order = (choice.orders ?? []).find((o) => o.id === optionId)
  if (!order || !choice.options.includes(optionId)) return false
  accept(s, order)
  pushLog(
    s,
    `${order.writ ? '📜 Founding writ' : 'New order'}: ${orderDef(order)?.name ?? order.defId} — ${describeOrder(order)}.`,
    'info',
  )
  refreshQueuedOrders(s, choice)
  return true
}

/** Swaps a fresh pair into the offer for a little of the Queen's patience. */
function declineOrders(s: RunState, choice: PendingChoice): void {
  if (orderDeclineBlocked(s, choice)) return
  const declined = choice.orders ?? []
  const fresh = drawCandidates(s, 2, [...declined, ...queuedCandidates(s, choice)])
  if (fresh.length === 0) return
  addImpatience(s, ORDER_DECLINE_IMPATIENCE)
  s.orderDeclineYear = s.season.year
  choice.orders = fresh
  choice.options = fresh.map((o) => o.id)
  pushLog(s, 'You ask the Queen for different orders. She obliges, but notes it.', 'info')
}

/**
 * Settles a pick from the order offer waiting at `index` in the Orders panel.
 * True when an order was taken (the offer is retired); a decline swaps a
 * fresh pair in place and returns false, as does an unknown offer or option.
 */
export function takeOrderOffer(s: RunState, index: number, optionId: string): boolean {
  const offer = s.orderOffers?.[index]
  if (!offer) return false
  if (!takeOrderChoice(s, offer, optionId)) return false
  s.orderOffers.splice(s.orderOffers.indexOf(offer), 1)
  return true
}

/**
 * Keeps other waiting order offers from repeating what was just taken.
 */
function refreshQueuedOrders(s: RunState, taken: PendingChoice): void {
  for (const choice of orderChoices(s)) {
    if (choice === taken || isWritChoice(choice)) continue
    const live = takenBy(s)
    const clash = (choice.orders ?? []).some((o) => {
      const resource = countingResource(o)
      return resource ? live.counting.has(resource) : live.defIds.has(o.defId)
    })
    if (!clash) continue
    const fresh = drawCandidates(s, 2, queuedCandidates(s, choice))
    if (fresh.length === 0) continue
    choice.orders = fresh
    choice.options = fresh.map((o) => o.id)
  }
}

// ---------------------------------------------------------------------------
// Older saves
// ---------------------------------------------------------------------------

/**
 * Keeps orders and a decree saved before goals could change meaning on the
 * terms they were drawn under: "Cook for the settlement" now counts meals
 * cooked from its draw (it was a larder level, which cooked food never
 * reached), so a saved one counts from the load; a saved larder decree keeps
 * its old larder goal.
 */
export function migrateOrders(run: RunState): void {
  // Saves from before order offers waited in the Orders panel queued them as
  // pop-ups: move any still waiting there (the writ stays a founding pick).
  if (!Array.isArray(run.orderOffers)) run.orderOffers = []
  if (Array.isArray(run.pendingChoices)) {
    const waiting = run.pendingChoices.filter((c) => c?.kind === 'order' && !isWritChoice(c))
    if (waiting.length > 0) {
      run.orderOffers.push(...waiting)
      run.pendingChoices = run.pendingChoices.filter((c) => !waiting.includes(c))
    }
  }
  for (const order of run.orders ?? []) {
    const goal = orderGoal(order)
    if (goal && countsFromDraw(goal) && order.baseline === undefined) {
      order.baseline = goalCount(goal, run) ?? 0
    }
  }
  const decree = run.decree
  if (decree && decree.defId === 'decree_larder' && !decree.goal) {
    decree.goal = { kind: 'stockCategory', category: 'food', amount: 25 }
  }
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

export function stepOrders(s: RunState): void {
  let completedAny = false
  for (const order of s.orders) {
    if (order.complete) continue
    const def = ORDERS[order.defId]
    const goal = orderGoal(order)
    if (!def || !goal) continue
    order.progress = orderProgress(s, order)
    if (order.progress < 1) continue
    order.complete = true
    completedAny = true
    s.stats.ordersCompleted++
    if (def.consume && goal.kind === 'stock') spend(s.stock, { [goal.resource]: goal.amount })
    const reputation = orderReputation(s, order)
    addReputation(s, reputation)
    if (def.reward) {
      grantProduced(s, def.reward)
    }
    pushLog(
      s,
      `${order.writ ? '📜 Founding writ fulfilled' : 'Order complete'} — ${describeOrder(order)}. +${reputation} reputation.`,
      'good',
    )
  }
  if (!completedAny) return
  s.orders = s.orders.filter((o) => !o.complete)
  // Each slot just emptied is refilled by a choice of two, waiting in the
  // Orders panel (none once the run is won: an offer then is noise).
  if (s.phase !== 'playing' || s.reputation >= s.maxReputation) return
  let offered = 0
  for (let open = openOrderSlots(s); open > 0; open--) {
    if (!offerOrders(s)) break
    offered++
  }
  if (offered > 0) {
    pushLog(
      s,
      offered === 1
        ? '📜 A new order awaits your choice in the Orders panel.'
        : `📜 ${offered} new orders await your choice in the Orders panel.`,
      'info',
    )
  }
}
