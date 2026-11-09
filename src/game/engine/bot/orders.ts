import { BUILDINGS } from '../../content/buildings'
import { EDIBLE, RESOURCE_LIST } from '../../content/resources'
import type { BuildingInstance, Glade, Order, OrderGoal, RunState } from '../../types'
import { assignWorker, findPlacement, placeBuilding, setRecipe } from '../actions'
import { TRADE_LOT } from '../balance'
import { gladesBeyond } from '../crossings'
import { dangerousGlades, orderGoal, orderProgress, workplacesOf } from '../orders'
import { idleVillagers, population } from '../queries'
import { refinedStatus } from '../refinedNeeds'
import { buyOffer, caravanAvailable, offerPrice, sellResource } from '../trade'
import { workerSlotsOf } from '../upgrades'
import { canRunRecipe } from './terrain'

/*
 * The bot's play on the Queen's orders about the run's own ground and
 * systems (`content/orders.ts`, the goal kinds after `producedCategory`),
 * kept apart from its general play in `play.ts`. Nothing here acts unless
 * such an order is open, so a run without one plays exactly as it did:
 *
 *  - glades across a ford or pass, and dangerous glades: the clearing crew
 *    heads for one (or the glade on the way to one), and the order keeps
 *    the bot from leaving its border to the forest meanwhile;
 *  - a deposit's goods: a camp goes up beside the deposit if none works it,
 *    and the camps working it are staffed ahead of the raw economy;
 *  - workplaces of a category at full crew: when the idle can fill the
 *    ones nearest full without touching the builders' reserve, they do;
 *  - caravan trades: a lot of whatever is most in surplus is sold while a
 *    caravan is in, or a cheap lot bought from a deep purse;
 *  - a warm Storm: the bot's brazier planning runs first;
 *  - a refined need: the venue serving it is staffed first.
 */

/** What `play.ts` lends this module. */
export interface OrderKit {
  /** Idle villagers kept back for building. */
  builderReserve: (s: RunState) => number
  /** Plants a brazier among homes the Storm's end would leave cold; true when one went up. */
  warmSprawl: (s: RunState) => boolean
  /** How much of a good is enough. */
  stockTarget: (s: RunState, id: (typeof RESOURCE_LIST)[number]['id']) => number
}

/** The goals of the bot's open orders. */
function openGoals(s: RunState): OrderGoal[] {
  return s.orders.filter((o) => !o.complete).flatMap((o) => orderGoal(o) ?? [])
}

/** How promising one of these orders looks, added to the base score in `play.ts` (0 for other kinds). */
export function orderKindPromise(s: RunState, order: Order): number {
  const goal = orderGoal(order)
  if (!goal) return 0
  switch (goal.kind) {
    case 'gladesBeyond':
      return 0.5
    case 'dangerousCleared':
      return 0.3
    case 'depositYield':
      return workingDeposit(s, goal.deposit).length > 0 ? 0.5 : 0.3
    case 'trades':
      return s.caravan.here ? 0.6 : 0.4
    case 'warmStorm':
      return 0.4
    case 'fullyStaffed':
      return missingCrew(s, goal.category, goal.buildings) <= Math.max(0, idleVillagers(s).length - 3) ? 0.5 : 0.1
    case 'refinedServed':
      return 0.6 * (refinedStatus(s, goal.species)?.ratio ?? 0)
    default:
      return 0
  }
}

/** Glade ids an open order wants cleared (across a barrier, or dangerous). */
function wantedGlades(s: RunState): ReadonlySet<string> | null {
  const ids = new Set<string>()
  for (const goal of openGoals(s)) {
    if (goal.kind === 'gladesBeyond') for (const id of gladesBeyond(s, goal.barrier)) ids.add(id)
    if (goal.kind === 'dangerousCleared') for (const id of dangerousGlades(s)) ids.add(id)
  }
  for (const id of [...ids]) if (s.glades[id]?.cleared) ids.delete(id)
  return ids.size > 0 ? ids : null
}

/** True while an open order wants glades cleared (the bot then spares none). */
export function wantsOrderGlades(s: RunState): boolean {
  return wantedGlades(s) !== null
}

/**
 * The border glade to clear for an open order: a wanted one if any is on
 * the border (a spared one is reclaimed: the order is worth more than the
 * truce), else the border glade fewest steps from one. Undefined when no
 * order wants a glade.
 */
export function orderGladeTarget(s: RunState, border: Glade[]): Glade | undefined {
  const wanted = wantedGlades(s)
  if (!wanted || border.length === 0) return undefined
  const byWork = (a: Glade, b: Glade) => a.clearWork - b.clearWork
  const direct = border.filter((g) => wanted.has(g.id)).sort(byWork)
  if (direct.length > 0) {
    const target = direct.find((g) => !g.spared)
    if (target) return target
  }
  // Steps from the nearest wanted glade, over uncleared ground.
  const steps = new Map<string, number>()
  const queue = [...wanted]
  for (const id of queue) steps.set(id, 0)
  for (let i = 0; i < queue.length; i++) {
    const g = s.glades[queue[i]]
    for (const n of g?.neighbors ?? []) {
      if (steps.has(n) || s.glades[n]?.cleared) continue
      steps.set(n, steps.get(queue[i])! + 1)
      queue.push(n)
    }
  }
  const open = border.filter((g) => !g.spared && steps.has(g.id))
  open.sort((a, b) => steps.get(a.id)! - steps.get(b.id)! || byWork(a, b))
  return open[0]
}

/** Built camps whose current recipe works a deposit of `kind` in reach. */
function workingDeposit(s: RunState, kind: string): BuildingInstance[] {
  return Object.values(s.buildings).filter((b) => {
    if (!b.built) return false
    const recipe = BUILDINGS[b.defId]?.recipes.find((r) => r.id === b.activeRecipeId)
    return recipe?.requiresDeposit === kind && canRunRecipe(s, b, recipe.id)
  })
}

/**
 * True when an open order wants this building's crew kept on and filled:
 * a deposit's goods, or a venue serving a refined need.
 */
export function orderWantsCrew(s: RunState, b: BuildingInstance): boolean {
  const def = BUILDINGS[b.defId]
  if (!def || !b.built) return false
  for (const goal of openGoals(s)) {
    if (goal.kind === 'depositYield') {
      const recipe = def.recipes.find((r) => r.id === b.activeRecipeId)
      if (recipe?.requiresDeposit === goal.deposit) return true
    }
    if (goal.kind === 'refinedServed') {
      const need = refinedStatus(s, goal.species)?.def.need
      if (need && def.service?.need === need) return true
    }
  }
  return false
}

/** Sets a camp in reach of the deposit to the recipe working it, or raises one beside it. */
function campForDeposit(s: RunState, kind: string): boolean {
  if (workingDeposit(s, kind).length > 0) return false
  for (const b of Object.values(s.buildings)) {
    if (!b.built) continue
    const recipe = BUILDINGS[b.defId]?.recipes.find((r) => r.requiresDeposit === kind)
    if (recipe && canRunRecipe(s, b, recipe.id)) {
      setRecipe(s, b.id, recipe.id)
      return false
    }
  }
  if (Object.values(s.buildings).some((b) => !b.built)) return false
  const defId = s.unlockedBuildings.find((id) => BUILDINGS[id]?.recipes.some((r) => r.requiresDeposit === kind))
  const site = Object.values(s.deposits).find(
    (d) => d.kind === kind && s.glades[d.gladeId]?.cleared && (d.amount === null || d.amount > 2),
  )
  if (!defId || !site) return false
  const pos = findPlacement(s, defId, site.pos)
  return !!pos && placeBuilding(s, defId, pos) === null
}

/** One lot traded toward an open trades order while a caravan is in. */
function tradeForOrder(s: RunState, kit: OrderKit): void {
  if (!s.caravan.here || !caravanAvailable(s)) return
  // The surplus furthest past what the settlement needs goes first.
  const surplus = RESOURCE_LIST.filter((r) => r.category !== 'currency' && !EDIBLE.includes(r.id) && r.id !== 'herb')
    .map((r) => ({ id: r.id, spare: (s.stock[r.id] ?? 0) - TRADE_LOT - kit.stockTarget(s, r.id) * 0.5 }))
    .filter((r) => r.spare >= 0)
    .sort((a, b) => b.spare - a.spare)[0]
  if (surplus && sellResource(s, surplus.id) === null) return
  const amber = s.stock.amber ?? 0
  const cheapest = s.caravan.offers
    .map((offer, index) => ({ offer, index, price: offerPrice(s, index) }))
    .filter(({ offer }) => !offer.sold && !offer.prepaid)
    .sort((a, b) => a.price - b.price)[0]
  if (cheapest && amber >= cheapest.price + 90) buyOffer(s, cheapest.index)
}

/** The workplaces of a category nearest full crew, `count` of them. */
function nearestFull(s: RunState, category: string, count: number): BuildingInstance[] {
  return workplacesOf(s, category)
    .sort((a, b) => workerSlotsOf(a) - a.workers.length - (workerSlotsOf(b) - b.workers.length))
    .slice(0, count)
}

/** Workers short of `count` workplaces of the category at full crew. */
function missingCrew(s: RunState, category: string, count: number): number {
  return nearestFull(s, category, count).reduce((n, b) => n + Math.max(0, workerSlotsOf(b) - b.workers.length), 0)
}

/**
 * Fills the `count` workplaces of the category nearest full crew from the
 * idle, keeping the builders' reserve — only when that finishes the job.
 */
function fillCategory(s: RunState, category: string, count: number, keep: number): void {
  if (missingCrew(s, category, count) > idleVillagers(s).length - keep) return
  for (const b of nearestFull(s, category, count)) {
    while (b.workers.length < workerSlotsOf(b)) {
      if (idleVillagers(s).length <= keep || assignWorker(s, b.id) !== null) break
    }
  }
}

/**
 * Acts on each open order of these kinds (see the file comment). Returns
 * true when it placed a building (the caller's build step is then spent).
 */
export function pursueOrders(s: RunState, kit: OrderKit): boolean {
  let built = false
  for (const order of s.orders) {
    const goal = orderGoal(order)
    if (!goal || order.complete) continue
    switch (goal.kind) {
      case 'depositYield':
        if (!built && population(s) >= 6) built = campForDeposit(s, goal.deposit)
        break
      case 'fullyStaffed':
        fillCategory(s, goal.category, goal.buildings, kit.builderReserve(s))
        break
      case 'trades':
        // Only the lots the order still lacks.
        if (orderProgress(s, order) < 1) tradeForOrder(s, kit)
        break
      case 'warmStorm':
        if (!built && s.season.season !== 'storm') built = kit.warmSprawl(s)
        break
      default:
        break
    }
  }
  return built
}
