import { BUILDINGS, BUILDING_LIST } from '../content/buildings'
import { COUNTING_ORDER, ORDERS, ORDER_LIST, WRIT_LIST } from '../content/orders'
import { describeGoal, evaluateGoal, describeTimedGoal, goalCount, goalNote, goalProgress, heldSeconds } from './goals'
import { RESOURCE_LIST } from '../content/resources'
import type { BuildingInstance, DepositId, Order, OrderDef, OrderGoal, PendingChoice, ResourceId, RunState, SpeciesId } from '../types'
import { gladesBeyond } from './crossings'
import { refinedStatus, refinedUnlocked } from './refinedNeeds'
import { caravanAvailable } from './trade'
import { migrateTallies } from './tallies'
import { housingOf, recipesAt, recipesOf, workerSlotsOf } from './upgrades'
import {
  ORDER_COUNT_MIN,
  ORDER_COUNT_SECONDS,
  ORDER_DECLINE_IMPATIENCE,
  ORDER_MAX_START_PROGRESS,
  ORDER_MAX_START_RESOLVE,
  ORDER_REACH,
  ORDER_SLOTS,
  REFINED_ORDER_HOLD_RATIO,
  REFINED_ORDER_MIN_RATIO,
  REFINED_ORDER_MIN_STOCK,
} from './balance'
import { pushLog } from './runLog'
import { productionRate } from './forecast'
import { computeModifiers } from './modifiers'
import {
  averageResolve,
  grantProduced,
  isWarmHome,
  population,
  speciesCounts,
  spend,
  stormEndReach,
  totalHousing,
  warmthSources,
} from './queries'
import { makeRng, type Rng } from './rng'
import { addImpatience, coldVillagers } from './society'
import { formatReputation, gainReputation, reputationFor } from './reputation'

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

/** The goal kinds of the orders on the run's own ground and systems. */
export const GROUND_ORDER_KINDS: ReadonlySet<OrderGoal['kind']> = new Set<OrderGoal['kind']>([
  'refinedServed',
  'gladesBeyond',
  'depositYield',
  'warmStorm',
  'trades',
  'dangerousCleared',
  'fullyStaffed',
])

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

/** 0..1 progress, counting from the order's baseline where it has one (or its seconds held). */
export function orderProgress(s: RunState, order: Order): number {
  const goal = orderGoal(order)
  if (!goal) return 0
  const seconds = heldSeconds(goal, s)
  if (seconds !== null) return Math.max(0, Math.min(1, (order.held ?? 0) / seconds))
  return order.baseline === undefined ? evaluateGoal(goal, s) : goalProgress(goal, s, order.baseline)
}

/** True for an order kept rather than reached: it counts the seconds its goal holds. */
export function isHeldOrder(s: RunState, order: Order): boolean {
  const goal = orderGoal(order)
  return !!goal && heldSeconds(goal, s) !== null
}

/** How an order's goal is met, for the kinds whose words alone do not say. */
export function orderNote(order: Order): string | null {
  const goal = orderGoal(order)
  return goal ? goalNote(goal) : null
}

/**
 * Where an order stands in its own units — "12/30", "40/60 s", "Waits for
 * the next Storm" — for the kinds that count something other than a level;
 * null for the rest (their card shows a percentage).
 */
export function orderStatus(s: RunState, order: Order): string | null {
  const goal = orderGoal(order)
  if (!goal) return null
  switch (goal.kind) {
    case 'refinedServed':
    case 'fullyStaffed':
      return `${Math.floor(order.held ?? 0)}/${goal.seconds} s`
    case 'warmStorm':
      if (s.season.season !== 'storm') return 'Waits for the next Storm'
      return `${Math.floor(order.held ?? 0)}/${Math.floor(heldSeconds(goal, s) ?? 0)} s of this Storm warm`
    case 'gladesBeyond':
    case 'depositYield':
    case 'trades':
    case 'dangerousCleared': {
      const done = Math.max(0, (goalCount(goal, s) ?? 0) - (order.baseline ?? 0))
      return `${Math.min(goal.amount, Math.floor(done))}/${goal.amount}`
    }
    default:
      return null
  }
}

/**
 * True while a held goal holds this second: the species' refined need met
 * for at least half the settlement, enough workplaces of the category at full crew, nobody in the Storm's
 * cold. Null for goals that are not held.
 */
export function goalHolding(goal: OrderGoal, s: RunState): boolean | null {
  switch (goal.kind) {
    case 'refinedServed': {
      if ((speciesCounts(s)[goal.species] ?? 0) <= 0) return false
      const status = refinedStatus(s, goal.species)
      return !!status?.unlocked && status.ratio >= REFINED_ORDER_HOLD_RATIO
    }
    case 'fullyStaffed':
      return workplacesOf(s, goal.category).filter((b) => b.workers.length >= workerSlotsOf(b)).length >= goal.buildings
    case 'warmStorm':
      return s.season.season === 'storm' && population(s) > 0 && coldVillagers(s) === 0
    default:
      return null
  }
}

/** Built workplaces (with crew slots) of a category. */
export function workplacesOf(s: RunState, category: string): BuildingInstance[] {
  return Object.values(s.buildings).filter(
    (b) => b.built && BUILDINGS[b.defId]?.category === category && workerSlotsOf(b) > 0,
  )
}

/**
 * Adds `dt` to a held order's seconds while its goal holds. Seconds add up
 * across breaks, except a whole-Storm goal: anyone cold starts it over, and
 * it starts afresh with each Storm.
 */
function stepHeld(s: RunState, order: Order, goal: OrderGoal, dt: number): void {
  const holding = goalHolding(goal, s)
  if (holding === null || dt <= 0) return
  if (goal.kind === 'warmStorm') {
    order.held = holding ? (order.held ?? 0) + dt : 0
    return
  }
  if (holding) order.held = (order.held ?? 0) + dt
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
  // The land's profile scales the order's worth (the writ is the Crown's own).
  return order.writ
    ? base
    : reputationFor(s, 'orders', Math.max(0, base + computeModifiers(s).orderReputation))
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
export function hasProductionChain(
  s: RunState,
  resource: ResourceId,
  seen: ReadonlySet<string> = new Set(),
  withUpgrades = false,
): boolean {
  if (seen.has(resource)) return false
  const path = new Set(seen).add(resource)
  for (const id of s.unlockedBuildings) {
    const def = BUILDINGS[id]
    if (!def) continue
    // With upgrades, a recipe a tier adds counts too (the Copper Still's spiced ale).
    const recipes = withUpgrades ? recipesAt(id, def.upgrades?.length ?? 0) : def.recipes
    for (const recipe of recipes) {
      if (((recipe.outputs as Record<string, number>)[resource] ?? 0) <= 0) continue
      if (recipe.requiresDeposit && !depositExists(s, recipe.requiresDeposit)) continue
      const inputs = Object.keys(recipe.inputs) as ResourceId[]
      if (inputs.every((input) => hasProductionChain(s, input, path, withUpgrades))) return true
    }
  }
  return false
}

/** Whether the settlement has a whole route to meeting an order's goal. */
export function orderFeasible(goal: OrderGoal, s: RunState): boolean {
  switch (goal.kind) {
    case 'stock':
    case 'produced':
      return hasProductionChain(s, goal.resource)
    case 'stockCategory':
    case 'producedCategory':
      return RESOURCE_LIST.some((r) => r.category === goal.category && hasProductionChain(s, r.id))
    case 'buildingId':
      return s.unlockedBuildings.includes(goal.buildingId)
    case 'buildingsOfCategory':
    case 'staffed':
      return BUILDING_LIST.some(
        (b) => b.category === goal.category && s.unlockedBuildings.includes(b.id),
      )
    case 'gladesCleared':
      return Object.values(s.glades).filter((g) => g.kind !== 'settlement').length >= goal.amount
    case 'refinedServed':
      return refinedChain(s, goal.species)
    case 'gladesBeyond':
      return standingNear(s, gladesBeyond(s, goal.barrier)) >= goal.amount
    case 'depositYield':
      return depositRoom(s, goal.deposit) >= goal.amount
    case 'warmStorm':
      // From Year 2, ahead of a Storm, once the hearth alone no longer keeps
      // every bed warm to its end: some homes rely on a brazier, or need one.
      return (
        s.season.year >= 2 &&
        s.season.season !== 'storm' &&
        population(s) >= 8 &&
        beyondTheHearth(s) > 0
      )
    case 'trades':
      return caravanAvailable(s)
    case 'dangerousCleared':
      return standingNear(s, dangerousGlades(s)) >= goal.amount
    case 'fullyStaffed':
      return workplacesOf(s, goal.category).length >= goal.buildings
    default:
      return true
  }
}

/**
 * Villagers who would sleep cold at the end of the coming Storm with the
 * hearth as the only fire (insulated homes and warm ground still count).
 */
function beyondTheHearth(s: RunState): number {
  const sources = warmthSources(s, stormEndReach(s)).filter((w) => w.kind === 'hearth')
  let warm = 0
  let housing = 0
  for (const b of Object.values(s.buildings)) {
    const beds = b.built ? housingOf(b) : 0
    if (beds <= 0) continue
    housing += beds
    if (isWarmHome(s, b, sources)) warm += beds
  }
  const housed = Math.min(population(s), housing)
  return housed - Math.min(housed, warm)
}

/** Dangerous and forbidden glades. */
export function dangerousGlades(s: RunState): ReadonlySet<string> {
  return new Set(
    Object.values(s.glades)
      .filter((g) => g.kind === 'dangerous' || g.kind === 'forbidden')
      .map((g) => g.id),
  )
}

/**
 * Glades among `ids` still standing (not cleared, not left to the forest)
 * within two steps of held land — counted only when at least one of them can
 * be worked now, so the goal is never a long walk off. 0 when none can.
 */
function standingNear(s: RunState, ids: ReadonlySet<string>): number {
  const border = new Set(
    Object.values(s.glades)
      .filter((g) => !g.cleared && g.neighbors.some((n) => s.glades[n]?.cleared))
      .map((g) => g.id),
  )
  const nextRing = new Set(
    Object.values(s.glades)
      .filter((g) => !g.cleared && g.neighbors.some((n) => border.has(n)))
      .map((g) => g.id),
  )
  let open = 0
  let near = 0
  for (const id of ids) {
    const g = s.glades[id]
    if (!g || g.cleared || g.spared) continue
    if (border.has(id)) open++
    if (border.has(id) || nextRing.has(id)) near++
  }
  return open > 0 ? near : 0
}

/**
 * Goods still to be had from deposits of `kind` in held land or a glade that
 * can be worked now, by a blueprint the settlement has whose recipe works
 * them (an endless deposit counts as plenty). 0 without such a recipe.
 */
function depositRoom(s: RunState, kind: DepositId): number {
  const perHarvest = Math.max(
    0,
    ...s.unlockedBuildings.flatMap((id) =>
      (BUILDINGS[id]?.recipes ?? [])
        .filter((r) => r.requiresDeposit === kind)
        .map((r) => Object.values(r.outputs).reduce((a: number, n) => a + (n ?? 0), 0)),
    ),
  )
  if (perHarvest <= 0) return 0
  let room = 0
  for (const d of Object.values(s.deposits)) {
    if (d.kind !== kind) continue
    const g = s.glades[d.gladeId]
    if (!g || !(g.cleared || g.neighbors.some((n) => s.glades[n]?.cleared))) continue
    if (d.amount === null) return Infinity
    room += Math.max(0, d.amount) * perHarvest
  }
  return room
}

/**
 * A species of this settlement wants its refined need, the finer good is
 * within reach (it already reaches some of them, or is made and stocked),
 * and the settlement has
 * a whole chain to meet it: a venue for the need and the venue's own goods,
 * and the finer good itself.
 */
function refinedChain(s: RunState, species: SpeciesId): boolean {
  if ((speciesCounts(s)[species] ?? 0) <= 0 || !refinedUnlocked(s)) return false
  const status = refinedStatus(s, species)
  if (!status || status.def.venueTier) return false
  const { def } = status
  // Within reach: the finer good already reaches some of them, or a
  // workshop standing now makes it and some is in stock (a good made but
  // eaten as fast is not within reach).
  const stocked =
    !!def.good &&
    (s.stock[def.good] ?? 0) >= REFINED_ORDER_MIN_STOCK &&
    Object.values(s.buildings).some((b) => b.built && recipesOf(b).some((r) => (r.outputs[def.good!] ?? 0) > 0))
  if (status.ratio < REFINED_ORDER_MIN_RATIO && !stocked) return false
  if (def.good && !hasProductionChain(s, def.good, new Set(), true)) return false
  return s.unlockedBuildings.some((id) => {
    const venue = BUILDINGS[id]
    if (venue?.service?.need !== def.need) return false
    const inputs = Object.keys(venue.recipes[0]?.inputs ?? {}) as ResourceId[]
    return inputs.every((r) => hasProductionChain(s, r))
  })
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
  // A held goal starts from nothing, but one holding already would be met
  // within the minute: not offered until it slips.
  const holding = goalHolding(goal, s)
  if (holding !== null) return !holding
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
  switch (goal.kind) {
    case 'producedCategory':
    case 'gladesCleared':
    case 'gladesBeyond':
    case 'depositYield':
    case 'trades':
    case 'dangerousCleared':
      return true
    default:
      return false
  }
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
    (d) =>
      !taken.defIds.has(d.id) &&
      !s.ordersSeen.includes(d.id) &&
      (d.fromYear ?? 1) <= s.season.year &&
      (!d.afterService || serviceStanding(s)) &&
      orderEligible(d.goal, s),
  )
  if (pool.length > 0) return newOrder(s, rng.pick(pool))
  return countingOrder(s, rng, taken)
}

/** True once a service venue stands built in the settlement. */
function serviceStanding(s: RunState): boolean {
  return Object.values(s.buildings).some((b) => b.built && !!BUILDINGS[b.defId]?.service)
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
    const held = order?.held as unknown
    if (held !== undefined && !(typeof held === 'number' && Number.isFinite(held) && held >= 0)) delete order.held
  }
  migrateTallies(run)
  const decree = run.decree
  if (decree && decree.defId === 'decree_larder' && !decree.goal) {
    decree.goal = { kind: 'stockCategory', category: 'food', amount: 25 }
  }
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

export function stepOrders(s: RunState, dt = 0): void {
  let completedAny = false
  for (const order of s.orders) {
    if (order.complete) continue
    const def = ORDERS[order.defId]
    const goal = orderGoal(order)
    if (!def || !goal) continue
    stepHeld(s, order, goal, dt)
    order.progress = orderProgress(s, order)
    if (order.progress < 1) continue
    order.complete = true
    completedAny = true
    s.stats.ordersCompleted++
    if (def.consume && goal.kind === 'stock') spend(s.stock, { [goal.resource]: goal.amount })
    const reputation = orderReputation(s, order)
    gainReputation(s, reputation, 'orders')
    if (def.reward) {
      grantProduced(s, def.reward)
    }
    pushLog(
      s,
      `${order.writ ? '📜 Founding writ fulfilled' : 'Order complete'} — ${describeOrder(order)}. +${formatReputation(reputation)} ${s.envoy ? 'glory' : 'reputation'}.`,
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
