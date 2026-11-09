import { describe, expect, it } from 'vitest'
import { BUILDING_LIST } from '../content/buildings'
import { ORDERS, ORDER_LIST } from '../content/orders'
import { RESOURCE_LIST } from '../content/resources'
import type { BuildingInstance, Order, OrderGoal, RunState } from '../types'
import { createRun } from './createRun'
import { gladesBeyond } from './crossings'
import { takeChoice } from './drafts'
import { describeGoal, goalNote } from './goals'
import {
  GROUND_ORDER_KINDS,
  goalHolding,
  migrateOrders,
  offerOrders,
  orderEligible,
  orderNote,
  orderProgress,
  orderStatus,
  stepOrders,
} from './orders'
import { migrateRun } from '../persistence'
import { runProblem } from '../runCheck'
import { stepProduction } from './production'
import { computeModifiers } from './modifiers'
import { sellResource } from './trade'
import { tallyDepositYield } from './tallies'
import { refinedStatus } from './refinedNeeds'
import { REFINED_ORDER_HOLD_RATIO, REFINED_ORDER_MIN_RATIO } from './balance'

/**
 * The Queen's orders on the run's own ground and systems: glades across a
 * river or beyond the ridge, a deposit's goods, dangerous glades, caravan
 * trades, whole categories at full crew, a warm Storm and the refined
 * needs. Each kind: drawn only where the run can meet it, its progress, and
 * its completion; plus older saves.
 */

function opened(options: Parameters<typeof createRun>[0]): RunState {
  const s = createRun(options)
  let guard = 0
  while (s.pendingChoices.length > 0 && guard++ < 20) takeChoice(s, s.pendingChoices[0].options[0])
  s.orders = []
  s.orderOffers = []
  return s
}

function run(seed = 7, extra: Partial<Parameters<typeof createRun>[0]> = {}): RunState {
  return opened({ seed, species: ['human', 'beaver', 'lizard'], modifiers: [], ...extra })
}

/** An order of `defId` live in a slot, drawn as the Queen draws it. */
function live(s: RunState, defId: string): Order {
  const def = ORDERS[defId]
  const goal = def.goal
  const order: Order = { id: `t_${defId}`, defId, progress: 0, complete: false }
  if (['gladesBeyond', 'depositYield', 'trades', 'dangerousCleared'].includes(goal.kind)) {
    order.baseline = countNow(s, goal)
  }
  s.orders.push(order)
  return order
}

function countNow(s: RunState, goal: OrderGoal): number {
  switch (goal.kind) {
    case 'gladesBeyond':
      return [...gladesBeyond(s, goal.barrier)].filter((id) => s.glades[id].cleared).length
    case 'depositYield':
      return s.orderTallies?.depositYield?.[goal.deposit] ?? 0
    case 'trades':
      return s.orderTallies?.trades ?? 0
    case 'dangerousCleared':
      return Object.values(s.glades).filter((g) => g.cleared && (g.kind === 'dangerous' || g.kind === 'forbidden')).length
    default:
      return 0
  }
}

/** A built instance of `defId` with `workers` of the run's villagers on it. */
function place(s: RunState, defId: string, workers: number, at = { x: 1, y: 1 }): BuildingInstance {
  const def = BUILDING_LIST.find((b) => b.id === defId)!
  const free = Object.values(s.villagers).filter((v) => !v.assignment).slice(0, workers)
  const b: BuildingInstance = {
    id: `t_${defId}_${Object.keys(s.buildings).length}`,
    defId,
    pos: at,
    gladeId: 'glade0',
    built: true,
    buildProgress: def.buildSeconds,
    workers: free.map((v) => v.id),
    activeRecipeId: def.recipes[0]?.id ?? '',
    recipeProgress: 0,
    tier: 0,
    paused: false,
    depositsInRange: {},
  }
  for (const v of free) v.assignment = b.id
  s.buildings[b.id] = b
  if (!s.unlockedBuildings.includes(defId)) s.unlockedBuildings.push(defId)
  return b
}

/** Clears glades outward from the hearth until one of `ids` borders held land. */
function clearToward(s: RunState, ids: ReadonlySet<string>): void {
  for (let guard = 0; guard < 40; guard++) {
    const border = Object.values(s.glades).filter((g) => !g.cleared && g.neighbors.some((n) => s.glades[n].cleared))
    if (border.some((g) => ids.has(g.id))) return
    // Step toward the nearest wanted glade.
    const next = border
      .filter((g) => !ids.has(g.id))
      .sort((a, b) => nearest(a, ids, s) - nearest(b, ids, s))[0]
    if (!next) return
    next.cleared = true
  }
}

function nearest(g: { center: { x: number; y: number } }, ids: ReadonlySet<string>, s: RunState): number {
  return Math.min(...[...ids].map((id) => Math.hypot(s.glades[id].center.x - g.center.x, s.glades[id].center.y - g.center.y)))
}

describe('ground orders: content', () => {
  const ground = ORDER_LIST.filter((d) => GROUND_ORDER_KINDS.has(d.goal.kind))

  it('adds seven goal kinds and twelve to sixteen orders, each kind used', () => {
    expect(GROUND_ORDER_KINDS.size).toBe(7)
    expect(ground.length).toBeGreaterThanOrEqual(12)
    expect(ground.length).toBeLessThanOrEqual(16)
    for (const kind of GROUND_ORDER_KINDS) expect(ground.some((d) => d.goal.kind === kind), kind).toBe(true)
  })

  it('every new order reads as a goal and says how it is met', () => {
    for (const def of ground) {
      expect(describeGoal(def.goal), def.id).toMatch(/\w{4,}/)
      expect(goalNote(def.goal), def.id).toMatch(/\w{4,}/)
      expect(def.reputationReward).toBeGreaterThanOrEqual(1)
    }
    expect(describeGoal(ORDERS.cross_ford.goal)).toBe('Clear 2 glades across the river')
    expect(describeGoal(ORDERS.dangerous_glade_1.goal)).toBe('Clear a dangerous glade')
    expect(describeGoal(ORDERS.trades_10.goal)).toBe('Buy or sell 10 lots at the caravan')
    expect(describeGoal(ORDERS.salvage_ruins_45.goal)).toBe('Take 45 goods from Tumbled Stonework')
    expect(describeGoal(ORDERS.refined_human.goal)).toBe("Meet the Humans' refined need (spiced ale) for 90 s")
    expect(describeGoal(ORDERS.camps_full.goal)).toBe('Keep 5 camps at full crew for 90 s')
  })
})

describe('ground orders: across a river or beyond the ridge', () => {
  it('finds the far bank and the lowland, and nothing on the rings', () => {
    const river = run(11, { layout: 'river', biome: 'woodland' })
    const far = gladesBeyond(river, 'river')
    expect(far.size).toBeGreaterThan(0)
    expect(far.has('glade0')).toBe(false)
    expect(gladesBeyond(river, 'cliff').size).toBe(0)
    const ridge = run(11, { layout: 'ridge', biome: 'woodland' })
    expect(gladesBeyond(ridge, 'cliff').size).toBeGreaterThan(0)
    const rings = run(11, { layout: 'rings', biome: 'woodland' })
    expect(gladesBeyond(rings, 'river').size).toBe(0)
    expect(orderEligible(ORDERS.cross_ford.goal, rings)).toBe(false)
    expect(orderEligible(ORDERS.cross_pass.goal, river)).toBe(false)
  })

  it('is drawn once far glades are within reach, and met by clearing them', () => {
    const s = run(11, { layout: 'river', biome: 'woodland' })
    const far = gladesBeyond(s, 'river')
    clearToward(s, far)
    expect(orderEligible(ORDERS.cross_ford.goal, s)).toBe(true)
    const order = live(s, 'cross_ford')
    // A glade on the hearth's own bank does not count.
    const near = Object.values(s.glades).find((g) => !g.cleared && !far.has(g.id))
    if (near) near.cleared = true
    stepOrders(s, 0.25)
    expect(order.complete).toBe(false)
    expect(orderStatus(s, order)).toBe('0/2')
    const reputation = s.reputation
    const across = () => Object.values(s.glades).find((g) => far.has(g.id) && !g.cleared)!
    across().cleared = true
    stepOrders(s, 0.25)
    expect(orderStatus(s, order)).toBe('1/2')
    expect(order.complete).toBe(false)
    across().cleared = true
    stepOrders(s, 0.25)
    expect(order.complete).toBe(true)
    expect(s.reputation).toBeGreaterThan(reputation)
  })

  it('is not drawn when every far glade is left to the forest', () => {
    const s = run(11, { layout: 'river', biome: 'woodland' })
    const far = gladesBeyond(s, 'river')
    clearToward(s, far)
    for (const id of far) s.glades[id].spared = true
    expect(orderEligible(ORDERS.cross_ford.goal, s)).toBe(false)
  })
})

describe('ground orders: deposits', () => {
  it('salvage is drawn only on the ruins with stonework in reach, deadfall only in the Cinderwood', () => {
    const rings = run(5, { layout: 'rings', biome: 'woodland' })
    expect(orderEligible(ORDERS.salvage_ruins_45.goal, rings)).toBe(false)
    expect(orderEligible(ORDERS.deadfall_60.goal, rings)).toBe(false)
    expect(orderEligible(ORDERS.fireweed_64.goal, rings)).toBe(false)
    const ruins = run(5, { layout: 'ruins', biome: 'woodland' })
    const stonework = new Set(Object.values(ruins.deposits).filter((d) => d.kind === 'ruins').map((d) => d.gladeId))
    expect(stonework.size).toBeGreaterThan(0)
    clearToward(ruins, stonework)
    expect(orderEligible(ORDERS.salvage_ruins_45.goal, ruins)).toBe(true)
    // Without a blueprint that salvages, never.
    ruins.unlockedBuildings = ruins.unlockedBuildings.filter((id) => id !== 'stonecuttersCamp')
    expect(orderEligible(ORDERS.salvage_ruins_45.goal, ruins)).toBe(false)
  })

  it('counts goods a camp takes from the deposit from its draw', () => {
    const s = run(5, { layout: 'ruins', biome: 'woodland' })
    const site = Object.values(s.deposits).find((d) => d.kind === 'ruins')!
    s.glades[site.gladeId].cleared = true
    tallyDepositYield(s, 'ruins', 9)
    const order = live(s, 'salvage_ruins_45')
    expect(orderProgress(s, order)).toBe(0)
    // A real Stonecutters' Camp on the stonework, salvaging.
    const camp = place(s, 'stonecuttersCamp', 2, site.pos)
    camp.activeRecipeId = 'salvage'
    camp.depositsInRange = { ruins: [site.id] }
    s.storageCap = 9999
    const mods = computeModifiers(s)
    for (let i = 0; i < 400; i++) stepProduction(s, 0.25, mods)
    expect(s.orderTallies!.depositYield!.ruins!).toBeGreaterThan(9)
    stepOrders(s, 0.25)
    expect(order.progress).toBeGreaterThan(0)
    const amount = (ORDERS.salvage_ruins_45.goal as { amount: number }).amount
    expect(orderStatus(s, order)).toMatch(new RegExp(`^\\d+/${amount}$`))
    tallyDepositYield(s, 'ruins', amount)
    stepOrders(s, 0.25)
    expect(order.complete).toBe(true)
  })
})

describe('ground orders: dangerous glades and trades', () => {
  it('a dangerous glade order is drawn with one on the border and met by clearing it', () => {
    const s = run(3)
    const danger = new Set(
      Object.values(s.glades).filter((g) => g.kind === 'dangerous' || g.kind === 'forbidden').map((g) => g.id),
    )
    expect(danger.size).toBeGreaterThan(0)
    clearToward(s, danger)
    expect(orderEligible(ORDERS.dangerous_glade_1.goal, s)).toBe(true)
    const order = live(s, 'dangerous_glade_1')
    const small = Object.values(s.glades).find((g) => !g.cleared && g.kind === 'small' && !danger.has(g.id))
    if (small) small.cleared = true
    stepOrders(s, 0.25)
    expect(order.complete).toBe(false)
    s.glades[[...danger].find((id) => !s.glades[id].cleared)!].cleared = true
    stepOrders(s, 0.25)
    expect(order.complete).toBe(true)
    // With every dangerous glade cleared or spared, it is never drawn.
    s.orders = []
    for (const id of danger) s.glades[id].spared = !s.glades[id].cleared
    expect(orderEligible(ORDERS.dangerous_glade_1.goal, s)).toBe(false)
  })

  it('an order with a later year is not drawn before it, nor before a service hall stands', () => {
    const s = run(3)
    const id = 'workshops_full'
    for (const b of Object.values(s.buildings)) if (BUILDING_LIST.find((d) => d.id === b.defId)?.category !== 'hearth') delete s.buildings[b.id]
    for (const v of Object.values(s.villagers)) v.assignment = null
    for (const [i, defId] of ['lumberMill', 'brickyard', 'cookhouse'].entries()) place(s, defId, 0, { x: i * 2 - 2, y: 3 })
    expect(ORDERS[id].fromYear).toBe(2)
    expect(ORDERS[id].afterService).toBe(true)
    expect(orderEligible(ORDERS[id].goal, s)).toBe(true)
    // Every other order already seen: the pool is this one or nothing.
    s.ordersSeen = ORDER_LIST.map((d) => d.id).filter((x) => x !== id)
    const offered = () => {
      s.orderOffers = []
      offerOrders(s)
      return s.orderOffers[0].orders!.map((o) => o.defId)
    }
    s.season = { ...s.season, year: 2 }
    expect(offered(), 'no service hall').not.toContain(id)
    place(s, 'tavern', 0, { x: 2, y: -2 })
    s.season = { ...s.season, year: 1 }
    expect(offered(), 'Year 1').not.toContain(id)
    s.season = { ...s.season, year: 2 }
    expect(offered()).toContain(id)
  })

  it('a trade order waits for caravans and counts every lot sold or bought', () => {
    const s = run(3)
    expect(orderEligible(ORDERS.trades_10.goal, s)).toBe(false)
    place(s, 'tradingPost', 0)
    expect(orderEligible(ORDERS.trades_10.goal, s)).toBe(true)
    const order = live(s, 'trades_10')
    s.caravan.here = true
    s.stock.wood = 200
    s.storageCap = 9999
    const lots = (ORDERS.trades_10.goal as { amount: number }).amount
    s.stock.wood = lots * 10
    for (let i = 0; i < lots - 1; i++) expect(sellResource(s, 'wood')).toBeNull()
    stepOrders(s, 0.25)
    expect(order.complete).toBe(false)
    expect(orderStatus(s, order)).toBe(`${lots - 1}/${lots}`)
    expect(sellResource(s, 'wood')).toBeNull()
    stepOrders(s, 0.25)
    expect(order.complete).toBe(true)
  })
})

describe('ground orders: held goals', () => {
  it('enough workplaces of a category at full crew at once, held for its seconds in all', () => {
    const s = run(3)
    for (const b of Object.values(s.buildings)) if (b.defId !== 'hearth') delete s.buildings[b.id]
    for (const v of Object.values(s.villagers)) v.assignment = null
    for (let i = 0; i < 20; i++) s.villagers[`extra${i}`] = { ...Object.values(s.villagers)[0], id: `extra${i}`, assignment: null }
    const goal = ORDERS.camps_full.goal
    if (goal.kind !== 'fullyStaffed') throw new Error('camps_full is a fullyStaffed order')
    const camps = ['woodcuttersCamp', 'foragersCamp', 'stonecuttersCamp', 'herbalistsCamp', 'trappersCamp', 'clayPit']
    for (let i = 0; i < goal.buildings - 1; i++) place(s, camps[i], 0, { x: i - 2, y: 2 })
    expect(orderEligible(goal, s), 'too few camps').toBe(false)
    const third = place(s, camps[goal.buildings - 1], 0, { x: 3, y: -2 })
    expect(orderEligible(goal, s)).toBe(true)
    const order = live(s, 'camps_full')
    stepOrders(s, 10)
    expect(order.held ?? 0).toBe(0)
    // Fill every slot.
    for (const b of Object.values(s.buildings).filter((x) => x.defId !== 'hearth')) {
      const slots = BUILDING_LIST.find((d) => d.id === b.defId)!.workerSlots
      while (b.workers.length < slots) {
        const v = Object.values(s.villagers).find((x) => !x.assignment)!
        v.assignment = b.id
        b.workers.push(v.id)
      }
    }
    expect(goalHolding(goal, s)).toBe(true)
    expect(orderEligible(goal, s), 'already holding').toBe(false)
    stepOrders(s, 30)
    expect(orderStatus(s, order)).toBe(`30/${goal.seconds} s`)
    // A break pauses it; the seconds held are kept.
    const off = third.workers.pop()!
    s.villagers[off].assignment = null
    stepOrders(s, 30)
    expect(order.held).toBe(30)
    third.workers.push(off)
    s.villagers[off].assignment = third.id
    stepOrders(s, goal.seconds - 31)
    expect(order.complete).toBe(false)
    stepOrders(s, 1)
    expect(order.complete).toBe(true)
  })

  it('a warm Storm: drawn from Year 2 ahead of a Storm that would leave someone cold; anyone cold starts it over', () => {
    const s = run(3)
    const goal = ORDERS.warm_storm.goal
    // Homes far out, beyond any warmth, for everyone.
    for (const b of Object.values(s.buildings)) if (BUILDING_LIST.find((d) => d.id === b.defId)?.category === 'housing') delete s.buildings[b.id]
    for (let i = 0; i < 6; i++) s.villagers[`extra${i}`] = { ...Object.values(s.villagers)[0], id: `extra${i}`, assignment: null }
    const far = [place(s, 'shelter', 0, { x: 9, y: 7 }), place(s, 'shelter', 0, { x: -9, y: 7 }), place(s, 'shelter', 0, { x: 9, y: -7 })]
    s.season = { ...s.season, year: 1, season: 'clearance', elapsed: 0 }
    expect(orderEligible(goal, s), 'Year 1').toBe(false)
    s.season = { ...s.season, year: 2 }
    expect(orderEligible(goal, s)).toBe(true)
    const order = live(s, 'warm_storm')
    stepOrders(s, 5)
    expect(orderStatus(s, order)).toBe('Waits for the next Storm')
    s.season = { ...s.season, season: 'storm', elapsed: 0 }
    // Cold homes: nothing held.
    stepOrders(s, 20)
    expect(order.held ?? 0).toBe(0)
    // Homes moved in by the hearth: warm, so it counts…
    for (const b of far) b.pos = { x: 0.5, y: 0.5 }
    stepOrders(s, 20)
    expect(order.held).toBe(20)
    // …until someone sleeps cold again, which starts it over.
    for (const b of far) b.pos = { x: 9, y: 7 }
    stepOrders(s, 1)
    expect(order.held).toBe(0)
    for (const b of far) b.pos = { x: 0.5, y: 0.5 }
    for (let t = 0; t < s.season.length && !order.complete; t += 1) {
      s.season.elapsed = t
      stepOrders(s, 1)
    }
    expect(order.complete).toBe(true)
  })

  it('a refined need: only for a species present, once it wants it and is within reach; counts while it reaches half', () => {
    const s = run(3)
    const goal = ORDERS.refined_human.goal
    expect(orderEligible(goal, s), 'Year 1').toBe(false)
    expect(orderEligible(ORDERS.refined_fox.goal, s)).toBe(false)
    s.season = { ...s.season, year: 3 }
    s.unlockedBuildings = s.unlockedBuildings.filter((id) => id !== 'brewery')
    expect(orderEligible(goal, s), 'no spiced ale chain').toBe(false)
    s.unlockedBuildings = BUILDING_LIST.map((b) => b.id)
    s.storageCap = 99999
    for (const r of RESOURCE_LIST) s.stock[r.id] = 200
    expect(orderEligible(goal, s), 'nobody served it yet: out of reach').toBe(false)
    // A Copper Still standing with spiced ale in stock puts it within reach…
    const still = place(s, 'brewery', 0, { x: 3, y: 3 })
    still.tier = 1
    expect(orderEligible(goal, s), 'made and stocked').toBe(true)
    // …but not while the stock is all but gone.
    s.stock.spicedAle = 2
    expect(orderEligible(goal, s), 'made, not stocked').toBe(false)
    s.stock.spicedAle = 200
    delete s.buildings[still.id]
    expect(orderEligible(ORDERS.refined_fox.goal, s), 'no foxes').toBe(false)
    // One staffed tavern with spiced ale in stock, for a settlement it reaches under half of.
    place(s, 'tavern', 1)
    const human = Object.values(s.villagers).find((v) => v.species === 'human')!
    for (let i = 0; refinedStatus(s, 'human')!.ratio >= REFINED_ORDER_HOLD_RATIO && i < 400; i++) {
      s.villagers[`h${i}`] = { ...human, id: `h${i}`, assignment: null }
    }
    expect(refinedStatus(s, 'human')!.ratio).toBeGreaterThanOrEqual(REFINED_ORDER_MIN_RATIO)
    expect(orderEligible(goal, s)).toBe(true)
    const order = live(s, 'refined_human')
    stepOrders(s, 10)
    expect(order.held ?? 0).toBe(0)
    // A second tavern reaches half of them or more.
    place(s, 'tavern', 1, { x: -1, y: 1 })
    expect(goalHolding(goal, s)).toBe(true)
    expect(orderEligible(goal, s), 'already holding').toBe(false)
    const seconds = goal.kind === 'refinedServed' ? goal.seconds : 0
    stepOrders(s, 40)
    expect(orderStatus(s, order)).toBe(`40/${seconds} s`)
    delete s.stock.spicedAle
    stepOrders(s, 40)
    expect(order.held).toBe(40)
    s.stock.spicedAle = 50
    stepOrders(s, seconds - 41)
    expect(order.complete).toBe(false)
    stepOrders(s, 1)
    expect(order.complete).toBe(true)
    expect(orderNote(order)).toMatch(/spiced ale/)
  })
})

describe('ground orders: saves', () => {
  it('an older save with older orders loads, with empty tallies and its orders measured as before', () => {
    const s = run(3)
    const order = live(s, 'stock_plank_30')
    delete s.orderTallies
    const loaded = migrateRun(JSON.parse(JSON.stringify(s)))!
    expect(loaded).not.toBeNull()
    expect(runProblem(loaded)).toBeNull()
    expect(loaded.orderTallies).toEqual({})
    expect(loaded.orders[0].defId).toBe(order.defId)
    expect(loaded.orders[0].held).toBeUndefined()
  })

  it('mangled tallies and held seconds are repaired, and a non-numeric held refused by the shape check', () => {
    const s = run(3)
    const order = live(s, 'camps_full')
    ;(s as unknown as Record<string, unknown>).orderTallies = { trades: 'lots', depositYield: { ruins: 4, deadfall: -2 } }
    ;(order as unknown as Record<string, unknown>).held = -5
    migrateOrders(s)
    expect(s.orderTallies).toEqual({ depositYield: { ruins: 4 } })
    expect(order.held).toBeUndefined()
    ;(order as unknown as Record<string, unknown>).held = 'soon'
    expect(runProblem(s)).not.toBeNull()
  })
})
