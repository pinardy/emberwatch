import { describe, expect, it } from 'vitest'
import { BUILDING_LIST, STARTING_BLUEPRINTS } from '../content/buildings'
import { DECREES } from '../content/decrees'
import { ORDERS, ORDER_LIST, WRIT_LIST } from '../content/orders'
import { RESOURCE_LIST } from '../content/resources'
import type { BuildingInstance, RunState } from '../types'
import {
  DECREE_DECLINE_IMPATIENCE,
  DECREE_INTERVAL,
  DECREE_MAX_SHARE,
  DECREE_MIN_SHARE,
  DECREE_RATE_SHARE,
  ORDER_COUNT_MIN,
  ORDER_DECLINE_IMPATIENCE,
  ORDER_MAX_START_PROGRESS,
  ORDER_MAX_START_RESOLVE,
  ORDER_SLOTS,
  REWARD_MILESTONES,
} from './balance'
import { createRun } from './createRun'
import { checkMilestones, takeChoice } from './events'
import { productionRate } from './forecast'
import { computeModifiers } from './modifiers'
import {
  DECLINE_CHOICE,
  canMake,
  drawOrder,
  isWritChoice,
  offerOrders,
  orderDeclineBlocked,
  orderEligible,
  orderGoal,
  orderProgress,
  stepOrders,
} from './orders'
import { migrateRun } from '../persistence'
import {
  decreeCandidate,
  decreeGoal,
  decreeStreakBonus,
  stepDecree,
} from './structure'
import { tick } from './tick'

/** A run past its opening: drafts and the writ taken, nothing queued. */
function openedRun(seed = 7): RunState {
  const s = createRun({ seed, species: ['human', 'beaver', 'lizard'] })
  let guard = 0
  while (s.pendingChoices.length > 0 && guard++ < 20) takeChoice(s, s.pendingChoices[0].options[0])
  return s
}

const impatienceOf = (s: RunState) => s.impatience + s.impatienceProgress

/** A built, staffed instance of `defId` working its first recipe. */
function staffed(s: RunState, defId: string, workers: number): BuildingInstance {
  const def = BUILDING_LIST.find((b) => b.id === defId)!
  const ids = Object.keys(s.villagers).slice(0, workers)
  const b: BuildingInstance = {
    id: `test_${defId}_${Object.keys(s.buildings).length}`,
    defId,
    pos: { x: 1, y: 1 },
    gladeId: 'glade0',
    built: true,
    buildProgress: def.buildSeconds,
    workers: ids,
    activeRecipeId: def.recipes[0]?.id ?? '',
    recipeProgress: 0,
    tier: 0,
    paused: false,
    depositsInRange: {},
  }
  for (const id of ids) s.villagers[id].assignment = b.id
  s.buildings[b.id] = b
  if (!s.unlockedBuildings.includes(defId)) s.unlockedBuildings.push(defId)
  return b
}

/** A settlement that has plenty of everything: the case where draws used to complete at once. */
function matureRun(seed: number): RunState {
  const s = openedRun(seed)
  s.unlockedBuildings = BUILDING_LIST.map((b) => b.id)
  s.storageCap = 99999
  for (const r of RESOURCE_LIST) {
    s.stock[r.id] = 200
    s.producedTotals[r.id] = 400
  }
  s.stats.gladesCleared = 8
  for (const sp of s.speciesPool) s.resolve[sp] = 30
  return s
}

describe('order draws', () => {
  it('never offers an order that is already met or mostly met', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const s = matureRun(seed)
      s.orders = []
      for (let round = 0; round < 6; round++) {
        s.pendingChoices = []
        expect(offerOrders(s)).toBe(true)
        const choice = s.pendingChoices[0]
        expect(choice.kind).toBe('order')
        expect(choice.orders!.length).toBeGreaterThanOrEqual(1)
        for (const order of choice.orders!) {
          const goal = orderGoal(order)!
          const cap = goal.kind === 'resolveAbove' ? ORDER_MAX_START_RESOLVE : ORDER_MAX_START_PROGRESS
          expect(orderProgress(s, order), `${seed} ${order.defId}`).toBeLessThan(cap)
        }
        // Taking it and running a tick does not complete it on the spot.
        const reputation = s.reputation
        const completed = s.stats.ordersCompleted
        takeChoice(s, choice.options[0])
        stepOrders(s)
        expect(s.stats.ordersCompleted).toBe(completed)
        expect(s.reputation).toBe(reputation)
        s.orders = []
      }
    }
  })

  it('only offers goals the settlement has a whole chain for', () => {
    const s = openedRun()
    s.unlockedBuildings = [...STARTING_BLUEPRINTS]
    expect(canMake(s, 'wood')).toBe(true)
    expect(canMake(s, 'tool')).toBe(false)
    expect(canMake(s, 'plank')).toBe(true)
    expect(canMake(s, 'ale')).toBe(false)
    // A toolshop alone is not a route to tools: the bars need a smelter and
    // the ore a mine on a seam.
    s.unlockedBuildings.push('toolshop')
    expect(canMake(s, 'tool')).toBe(false)
    s.unlockedBuildings.push('smelter', 'copperMine')
    const hasOre = Object.values(s.deposits).some((d) => d.kind === 'orePatch')
    expect(canMake(s, 'tool')).toBe(hasOre)
    // Without an ore seam anywhere on the map, no copper chain exists.
    const deposits = s.deposits
    s.deposits = Object.fromEntries(Object.entries(deposits).filter(([, d]) => d.kind !== 'orePatch'))
    expect(canMake(s, 'tool')).toBe(false)
    expect(orderEligible(ORDERS.stock_tool_8.goal, s)).toBe(false)
    expect(orderEligible(ORDERS.ship_tool_8.goal, s)).toBe(false)
    s.deposits = deposits

    const fresh = openedRun(11)
    fresh.unlockedBuildings = [...STARTING_BLUEPRINTS]
    for (let i = 0; i < 30; i++) {
      fresh.orders = []
      fresh.pendingChoices = []
      offerOrders(fresh)
      for (const order of fresh.pendingChoices[0].orders!) {
        expect(['stock_tool_8', 'ship_tool_8', 'ship_copper_12', 'stock_ale_15', 'produced_scroll_20']).not.toContain(
          order.defId,
        )
      }
    }
  })

  it('leaves far-off goals for later', () => {
    const s = openedRun()
    expect(orderEligible(ORDERS.pop_32.goal, s)).toBe(false)
    expect(orderEligible(ORDERS.glades_12.goal, s)).toBe(false)
    expect(orderEligible(ORDERS.glades_3.goal, s)).toBe(true)
    // Glade orders count from their draw: clearing already pays reputation.
    s.stats.gladesCleared = 5
    s.orders = []
    for (let i = 0; i < 40; i++) {
      s.pendingChoices = []
      offerOrders(s)
      for (const order of s.pendingChoices[0].orders!) {
        if (orderGoal(order)!.kind !== 'gladesCleared') continue
        expect(order.baseline).toBe(5)
        expect(order.progress).toBe(0)
      }
    }
  })

  it('falls back to a counting goal sized from what the settlement makes', () => {
    const s = matureRun(3)
    s.ordersSeen = ORDER_LIST.map((d) => d.id)
    staffed(s, 'stonecuttersCamp', 2)
    // Every ordinary order is either seen or no longer fits.
    s.orders = []
    s.pendingChoices = []
    offerOrders(s)
    const counting = s.pendingChoices[0].orders!.filter((o) => o.defId === 'count_produce')
    expect(counting.length).toBeGreaterThan(0)
    for (const order of counting) {
      const goal = orderGoal(order)!
      expect(goal.kind).toBe('produced')
      if (goal.kind !== 'produced') continue
      expect(order.baseline).toBe(s.producedTotals[goal.resource] ?? 0)
      expect(order.progress).toBe(0)
      expect(goal.amount).toBeGreaterThanOrEqual(ORDER_COUNT_MIN)
      expect(goal.amount % 5).toBe(0)
    }
    // Two candidates never ask for the same resource.
    const resources = counting.map((o) => (orderGoal(o) as { resource: string }).resource)
    expect(new Set(resources).size).toBe(resources.length)
  })
})

describe('orders as a choice', () => {
  it('refills an empty slot with a choice of two', () => {
    const s = openedRun()
    expect(s.orders.length).toBe(ORDER_SLOTS)
    const first = s.orders[0]
    const goal = orderGoal(first)!
    // Meet the first order by hand.
    s.orders = [{ ...first, goal: { kind: 'stock', resource: 'wood', amount: 1 }, defId: 'stock_plank_30' }, ...s.orders.slice(1)]
    s.stock.wood = 50
    expect(goal).toBeDefined()
    const before = s.reputation
    stepOrders(s)
    expect(s.reputation).toBeGreaterThan(before)
    expect(s.orders.length).toBe(ORDER_SLOTS - 1)
    const choice = s.pendingChoices.at(-1)!
    expect(choice.kind).toBe('order')
    expect(choice.options).toHaveLength(2)
    expect(new Set(choice.orders!.map((o) => o.defId)).size).toBe(2)
    // The sim waits for the pick.
    const clock = s.clock
    tick(s, 1)
    expect(s.clock).toBe(clock)
    takeChoice(s, choice.options[1])
    expect(s.pendingChoices).toHaveLength(0)
    expect(s.orders.length).toBe(ORDER_SLOTS)
    expect(s.orders.at(-1)!.id).toBe(choice.options[1])
    expect(s.ordersSeen).toContain(choice.orders![1].defId)
  })

  it('allows one decline a year, for a little patience', () => {
    const s = openedRun()
    s.orders.pop()
    offerOrders(s)
    const choice = s.pendingChoices[0]
    const declined = choice.orders!.map((o) => o.defId)
    expect(orderDeclineBlocked(s, choice)).toBeNull()
    const before = impatienceOf(s)
    takeChoice(s, DECLINE_CHOICE)
    expect(impatienceOf(s)).toBeCloseTo(before + ORDER_DECLINE_IMPATIENCE)
    expect(s.pendingChoices[0]).toBe(choice)
    for (const order of choice.orders!) expect(declined).not.toContain(order.defId)
    // Not twice in one year.
    expect(orderDeclineBlocked(s, choice)).not.toBeNull()
    const options = [...choice.options]
    takeChoice(s, DECLINE_CHOICE)
    expect(choice.options).toEqual(options)
    expect(impatienceOf(s)).toBeCloseTo(before + ORDER_DECLINE_IMPATIENCE)
    // A new year, a new chance.
    s.season.year++
    expect(orderDeclineBlocked(s, choice)).toBeNull()
  })
})

describe('the founding writ', () => {
  it('opens the run as a choice of three small goals, after the draft', () => {
    const s = createRun({ seed: 5, species: ['human', 'beaver', 'lizard'] })
    expect(s.orders).toHaveLength(ORDER_SLOTS - 1)
    const writ = s.pendingChoices.at(-1)!
    expect(isWritChoice(writ)).toBe(true)
    expect(writ.options).toHaveLength(WRIT_LIST.length)
    for (const order of writ.orders!) {
      expect(order.writ).toBe(true)
      expect(order.progress).toBeLessThan(1)
      expect(ORDERS[order.defId].reputationReward).toBe(1)
    }
    expect(orderDeclineBlocked(s, writ)).not.toBeNull()
  })

  it('pays a point of reputation when met, and opens a slot', () => {
    const s = createRun({ seed: 5, species: ['human', 'beaver', 'lizard'] })
    while (s.pendingChoices.length > 1) takeChoice(s, s.pendingChoices[0].options[0])
    const writ = s.pendingChoices[0]
    const glades = writ.orders!.find((o) => o.defId === 'writ_glades')!
    takeChoice(s, glades.id)
    expect(s.orders.find((o) => o.writ)?.defId).toBe('writ_glades')
    s.stats.gladesCleared = 2
    stepOrders(s)
    expect(s.reputation).toBe(1)
    expect(s.orders.some((o) => o.writ)).toBe(false)
    expect(s.pendingChoices.at(-1)?.kind).toBe('order')
    expect(s.log.some((e) => e.text.includes('Founding writ fulfilled'))).toBe(true)
  })
})

describe('decrees sized to the settlement', () => {
  it('asks for about what the staffed producers make in the time allowed', () => {
    const s = openedRun()
    expect(decreeCandidate(s, DECREES.decree_stone)).toBeNull()
    const camp = staffed(s, 'stonecuttersCamp', 1)
    camp.depositsInRange = {
      stoneVein: Object.values(s.deposits)
        .filter((d) => d.kind === 'stoneVein')
        .map((d) => d.id),
    }
    const mods = computeModifiers(s)
    const one = decreeCandidate(s, DECREES.decree_stone, mods)
    expect(one).not.toBeNull()
    const listed = (DECREES.decree_stone.goal as { amount: number }).amount
    const amountOf = (d: typeof one) => (decreeGoal(d!) as { amount: number }).amount
    const expected = productionRate(s, mods, 'stone') * one!.timeLimit * DECREE_RATE_SHARE
    const clamped = Math.min(listed * DECREE_MAX_SHARE, Math.max(listed * DECREE_MIN_SHARE, expected))
    expect(Math.abs(amountOf(one) - clamped)).toBeLessThanOrEqual(2)
    expect(one!.baseline).toBe(s.producedTotals.stone ?? 0)
    // A second hand asks for more.
    camp.workers.push(Object.keys(s.villagers).find((id) => !camp.workers.includes(id))!)
    const two = decreeCandidate(s, DECREES.decree_stone)
    expect(amountOf(two)).toBeGreaterThan(amountOf(one))
  })

  it('arrives as a choice of two and can be begged off', () => {
    const s = openedRun()
    s.decreeTimer = 0.05
    stepDecree(s, 0.1)
    const choice = s.pendingChoices[0]
    expect(choice.kind).toBe('decree')
    expect(choice.decrees!.length).toBeGreaterThanOrEqual(1)
    expect(choice.decrees!.length).toBeLessThanOrEqual(2)
    expect(new Set(choice.decrees!.map((d) => d.defId)).size).toBe(choice.decrees!.length)
    s.decreeStreak = 2
    const before = impatienceOf(s)
    takeChoice(s, DECLINE_CHOICE)
    expect(s.pendingChoices).toHaveLength(0)
    expect(s.decree).toBeNull()
    expect(impatienceOf(s)).toBeCloseTo(before + DECREE_DECLINE_IMPATIENCE)
    expect(s.decreeStreak).toBe(0)
    expect(s.decreeTimer).toBe(DECREE_INTERVAL)

    s.decreeTimer = 0.05
    stepDecree(s, 0.1)
    const next = s.pendingChoices[0]
    takeChoice(s, next.options[0])
    expect(s.decree?.id).toBe(next.options[0])
  })

  it('rewards a streak of decrees met', () => {
    expect(decreeStreakBonus(1)).toEqual({ reputation: 0, amber: 0 })
    expect(decreeStreakBonus(2).amber).toBeGreaterThan(0)
    const s = openedRun()
    s.storageCap = 9999
    s.decreeStreak = 1
    const meet = () => {
      s.decree = {
        id: 'dtest',
        defId: 'decree_glade',
        progress: 0,
        complete: false,
        timeLeft: 100,
        timeLimit: 270,
        baseline: s.stats.gladesCleared,
      }
      s.stats.gladesCleared++
      stepDecree(s, 0.1)
    }
    const amber = s.stock.amber ?? 0
    meet()
    expect(s.decreeStreak).toBe(2)
    expect(s.stock.amber ?? 0).toBe(
      amber + (DECREES.decree_glade.reward?.amber ?? 0) + decreeStreakBonus(2).amber,
    )
    // A lapse ends it.
    s.decree = { id: 'dx', defId: 'decree_glade', progress: 0, complete: false, timeLeft: 0.05, timeLimit: 270, baseline: s.stats.gladesCleared }
    stepDecree(s, 0.1)
    expect(s.decreeStreak).toBe(0)
  })
})

describe('reputation milestones near the end', () => {
  it('offers no draft within a point of victory', () => {
    const s = openedRun()
    s.reputation = s.maxReputation - 1
    checkMilestones(s)
    expect(s.pendingChoices).toHaveLength(0)
    expect(s.cornerstonesTaken).toBe(REWARD_MILESTONES.filter((m) => m <= s.reputation).length)
  })

  it('still offers them earlier', () => {
    const s = openedRun()
    s.reputation = REWARD_MILESTONES[0]
    checkMilestones(s)
    expect(s.pendingChoices).toHaveLength(1)
  })
})

describe('old saves', () => {
  it('load and keep working without the new order and decree fields', () => {
    const s = openedRun()
    const legacy = JSON.parse(JSON.stringify(s))
    legacy.orders = [{ id: 'o0', defId: 'produced_wood_120', progress: 0, complete: false }]
    delete legacy.decreeStreak
    delete legacy.orderDeclineYear
    legacy.decree = { id: 'd1', defId: 'decree_planks', progress: 0, complete: false, timeLeft: 100, timeLimit: 240, baseline: 0 }
    const run = migrateRun(legacy)!
    expect(run).not.toBeNull()
    expect(run.decreeStreak).toBe(0)
    expect(decreeGoal(run.decree!)).toEqual(DECREES.decree_planks.goal)
    // A legacy order is measured as it always was, against the lifetime total.
    run.producedTotals.wood = 60
    stepOrders(run)
    expect(run.orders[0].progress).toBeCloseTo(0.5)
    expect(drawOrder(run)).not.toBeNull()
    // An order whose goal now counts from its draw counts from the load.
    const cooking = migrateRun({
      ...JSON.parse(JSON.stringify(s)),
      orders: [{ id: 'o9', defId: 'stock_cooked_35', progress: 0, complete: false }],
      decree: { id: 'd2', defId: 'decree_larder', progress: 0, complete: false, timeLeft: 100, timeLimit: 240, baseline: 0 },
    })!
    expect(cooking.orders[0].baseline).toBeDefined()
    expect(orderProgress(cooking, cooking.orders[0])).toBe(0)
    expect(decreeGoal(cooking.decree!)).toEqual({ kind: 'stockCategory', category: 'food', amount: 25 })
    // When it is met, the empty slots are offered as choices.
    run.producedTotals.wood = 120
    stepOrders(run)
    expect(run.orders).toHaveLength(1)
    expect(run.pendingChoices.filter((c) => c.kind === 'order')).toHaveLength(ORDER_SLOTS - 1)
  })
})
