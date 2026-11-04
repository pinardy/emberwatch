import { describe, expect, it } from 'vitest'
import { BUILDINGS, BUILDING_LIST } from '../content/buildings'
import { evaluateGoal } from '../content/orders'
import { RESOURCES } from '../content/resources'
import { loadRun } from '../persistence'
import type { BuildingInstance, RunState, Vec2 } from '../types'
import { serviceCapacity } from './adjacency'
import {
  assignWorker,
  canUpgradeBuilding,
  demolishBuilding,
  demolishRefund,
  demolishRefundPercent,
  demolishSpent,
  rushConstruction,
  rushCost,
  setRecipe,
  upgradeBuilding,
} from './actions'
import { DEMOLISH_REFUND_BUILT, RUSH_COST_PER_SECOND } from './balance'
import { createRun } from './createRun'
import { takeChoice } from './events'
import { buildingStatus } from './forecast'
import { computeModifiers } from './modifiers'
import { stepProduction, workRate } from './production'
import {
  availableRecipes,
  comfortableHousing,
  computeStorageCap,
  idleVillagers,
  isWarmAt,
  serviceCoverage,
  totalHousing,
  warmHousing,
  warmthSources,
  workerCapacity,
} from './queries'
import { resolveBreakdowns } from './society'
import { goalCount, goalProgress, describeTimedGoal } from './structure'
import { tick } from './tick'
import {
  describeUpgrade,
  displayName,
  effectsAt,
  gatherRadiusOf,
  isUpgrading,
  maxTier,
  recipesOf,
  tierOf,
  workerSlotsOf,
} from './upgrades'

const SEED = 4242

function newRun(): RunState {
  const s = createRun({ seed: SEED, species: ['human', 'beaver', 'lizard'] })
  let guard = 0
  while (s.pendingChoices.length > 0 && guard++ < 10) takeChoice(s, s.pendingChoices[0].options[0])
  return s
}

/** Drops a finished building into the run at `pos` (no placement rules). */
function stand(s: RunState, defId: string, pos: Vec2 = { x: 40, y: 40 }, tier = 0): BuildingInstance {
  const id = `t_${defId}_${Object.keys(s.buildings).length}`
  const b: BuildingInstance = {
    id,
    defId,
    pos,
    gladeId: 'glade0',
    built: true,
    buildProgress: BUILDINGS[defId].buildSeconds,
    workers: [],
    activeRecipeId: BUILDINGS[defId].recipes[0]?.id ?? '',
    recipeProgress: 0,
    paused: false,
    tier,
    depositsInRange: {},
  }
  s.buildings[id] = b
  return b
}

/** Plenty of everything an upgrade could ask for, and room to keep it. */
function stockUp(s: RunState): void {
  for (const id of ['wood', 'plank', 'stone', 'brick', 'part', 'tool', 'copperBar'] as const) {
    s.stock[id] = 40
  }
  for (let i = 0; i < 3; i++) stand(s, 'warehouse', { x: -60 - i * 3, y: -60 }, 2)
  s.storageCap = computeStorageCap(s, 40)
}

describe('upgrade data', () => {
  it('gives a meaningful subset of buildings one or two tiers', () => {
    const upgradable = BUILDING_LIST.filter((d) => (d.upgrades?.length ?? 0) > 0)
    expect(upgradable.length).toBeGreaterThanOrEqual(12)
    for (const id of [
      'shelter', 'cabin', 'warehouse', 'woodcuttersCamp', 'foragersCamp', 'smallFarm',
      'trappersCamp', 'stonecuttersCamp', 'lumberMill', 'cookhouse', 'brewery', 'tavern',
      'temple', 'guildHouse', 'bathHouse', 'apothecary', 'arena', 'brazier', 'tradingPost',
    ]) {
      expect(maxTier(id), id).toBeGreaterThanOrEqual(1)
      expect(maxTier(id), id).toBeLessThanOrEqual(2)
    }
    expect(maxTier('ancientHearth')).toBe(0)
  })

  it('prices upgrades in processed goods and only references real recipes', () => {
    const midTier = new Set(['plank', 'brick', 'part', 'tool', 'copperBar'])
    for (const def of BUILDING_LIST) {
      const allIds = new Set(def.recipes.map((r) => r.id))
      for (const upgrade of def.upgrades ?? []) {
        expect(upgrade.buildSeconds).toBeGreaterThan(0)
        const goods = Object.keys(upgrade.cost)
        expect(goods.every((id) => id in RESOURCES)).toBe(true)
        expect(goods.some((id) => midTier.has(id)), `${upgrade.name} uses mid-tier goods`).toBe(true)
        for (const recipe of upgrade.effects.recipes ?? []) {
          expect(allIds.has(recipe.id), `${recipe.id} is a new id`).toBe(false)
          allIds.add(recipe.id)
        }
        for (const recipeId of Object.keys(upgrade.effects.extraOutputs ?? {})) {
          expect(def.recipes.some((r) => r.id === recipeId), `${def.id}:${recipeId}`).toBe(true)
        }
        expect(describeUpgrade(def, upgrade).length).toBeGreaterThan(0)
      }
    }
  })

  it('stacks tier effects and names each tier', () => {
    expect(effectsAt('shelter', 0).housing).toBe(0)
    expect(effectsAt('shelter', 1).housing).toBe(2)
    expect(effectsAt('shelter', 2).housing).toBe(4)
    expect(effectsAt('shelter', 2).insulated).toBe(true)
    expect(effectsAt('shelter', 2).comfort).toBe(true)
    const s = newRun()
    const b = stand(s, 'shelter')
    expect(displayName(b)).toBe('Shelter')
    b.tier = 1
    expect(displayName(b)).toBe('Reinforced Shelter')
  })
})

describe('tier effects on each stat', () => {
  it('housing, comfort and insulation', () => {
    const s = newRun()
    const before = totalHousing(s)
    // Far beyond every fire: cold in the Storm until insulated.
    const shelter = stand(s, 'shelter', { x: 60, y: 60 })
    expect(totalHousing(s)).toBe(before + 5)
    const warmBefore = warmHousing(s)
    expect(isWarmAt(s, shelter.pos)).toBe(false)

    shelter.tier = 1
    expect(totalHousing(s)).toBe(before + 7)
    expect(warmHousing(s)).toBe(warmBefore + 7)
    expect(comfortableHousing(s)).toBe(0)

    shelter.tier = 2
    expect(totalHousing(s)).toBe(before + 9)
    expect(comfortableHousing(s)).toBe(9)
  })

  it('a comfortable upgraded home lifts the comfort term of resolve', () => {
    const s = newRun()
    const mods = computeModifiers(s)
    const comfortOf = () => resolveBreakdowns(s, mods)[0].comfort
    for (let i = 0; i < 2; i++) stand(s, 'shelter', { x: 2 + i * 2, y: 2 })
    expect(comfortOf()).toBe(0)
    for (const b of Object.values(s.buildings)) if (b.defId === 'shelter') b.tier = 2
    expect(comfortOf()).toBeGreaterThan(0)
  })

  it('storage', () => {
    const s = newRun()
    const base = computeStorageCap(s)
    const warehouse = stand(s, 'warehouse')
    expect(computeStorageCap(s)).toBe(base + 120)
    warehouse.tier = 1
    expect(computeStorageCap(s)).toBe(base + 200)
    warehouse.tier = 2
    expect(computeStorageCap(s)).toBe(base + 300)
    // The sim reads the same cap.
    tick(s, 0.125)
    expect(s.storageCap).toBeGreaterThanOrEqual(base + 300)
  })

  it('service capacity, before and with neighbours, and coverage', () => {
    const s = newRun()
    const tavern = stand(s, 'tavern')
    expect(serviceCapacity(s, tavern)).toBe(25)
    tavern.tier = 1
    expect(serviceCapacity(s, tavern)).toBe(35)
    tavern.tier = 2
    expect(serviceCapacity(s, tavern)).toBe(47)
    // A home next door adds its 10% on top of the upgraded base.
    stand(s, 'shelter', { x: 41.5, y: 40 })
    expect(serviceCapacity(s, tavern)).toBe(Math.floor(47 * 1.1))
    s.stock.ale = 5
    assignWorker(s, tavern.id)
    expect(serviceCoverage(s).luxury.capacity).toBe(Math.floor(47 * 1.1))
  })

  it('worker slots', () => {
    const s = newRun()
    const camp = stand(s, 'woodcuttersCamp')
    const total = workerCapacity(s).total
    for (let i = 0; i < 2; i++) expect(assignWorker(s, camp.id)).toBeNull()
    expect(assignWorker(s, camp.id)).toBe('All slots are full.')
    camp.tier = 1
    expect(workerSlotsOf(camp)).toBe(3)
    expect(workerCapacity(s).total).toBe(total + 1)
    expect(assignWorker(s, camp.id)).toBeNull()
  })

  it('work speed, folded into the forecast too', () => {
    const s = newRun()
    const mill = stand(s, 'lumberMill')
    assignWorker(s, mill.id)
    s.stock = { wood: 50 }
    const mods = computeModifiers(s)
    const base = workRate(s, mill, mods)
    mill.tier = 1
    expect(workRate(s, mill, mods)).toBeCloseTo(base * 1.25)
    const status = buildingStatus(s, mill, mods)
    expect(status.kind).toBe('working')
    if (status.kind === 'working') expect(status.rate).toBeCloseTo(base * 1.25)
  })

  it('gather radius brings more deposits into reach when the tier lands', () => {
    const s = newRun()
    const trees = Object.values(s.deposits).find(
      (d) => d.kind === 'trees' && s.glades[d.gladeId]?.cleared,
    )!
    // Just beyond the base reach of 3, inside 4.
    const camp = stand(s, 'woodcuttersCamp', { x: trees.pos.x + trees.radius + 3.5, y: trees.pos.y })
    expect(gatherRadiusOf(camp)).toBe(3)
    stockUp(s)
    expect(upgradeBuilding(s, camp.id)).toBeNull()
    s.stock.amber = 999
    expect(rushConstruction(s, camp.id)).toBeNull()
    expect(gatherRadiusOf(camp)).toBe(4)
    expect(camp.depositsInRange.trees).toContain(trees.id)
  })

  it('warmth radius', () => {
    const s = newRun()
    const brazier = stand(s, 'brazier', { x: 30, y: 30 })
    const radius = () => warmthSources(s).find((w) => w.id === brazier.id)!.radius
    const base = radius()
    brazier.tier = 1
    expect(radius()).toBeCloseTo(base + 1.5)
    expect(isWarmAt(s, { x: 30 + base + 1, y: 30 })).toBe(true)
  })

  it('better output ratios and recipes unlocked at tier 2', () => {
    const s = newRun()
    const brewery = stand(s, 'brewery')
    expect(recipesOf(brewery).find((r) => r.id === 'aleBerry')!.outputs.ale).toBe(3)
    brewery.tier = 1
    expect(recipesOf(brewery).find((r) => r.id === 'aleBerry')!.outputs.ale).toBe(4)
    // The def itself is never mutated.
    expect(BUILDINGS.brewery.recipes.find((r) => r.id === 'aleBerry')!.outputs.ale).toBe(3)

    const kitchen = stand(s, 'cookhouse', { x: 44, y: 40 })
    expect(setRecipe(s, kitchen.id, 'rootPorridge')).toBe('Unknown recipe.')
    kitchen.tier = 2
    expect(availableRecipes(kitchen).map((r) => r.id)).toContain('rootPorridge')
    expect(setRecipe(s, kitchen.id, 'rootPorridge')).toBeNull()

    // And production actually pays the better ratio.
    s.stock = { root: 30 }
    s.storageCap = 1000
    assignWorker(s, kitchen.id)
    kitchen.recipeProgress = 19.99
    stepProduction(s, 0.125, computeModifiers(s))
    expect(s.stock.porridge).toBe(4)
    expect(s.stock.root).toBe(27)
  })
})

describe('the upgrade construction flow', () => {
  it('explains every refusal', () => {
    const s = newRun()
    expect(canUpgradeBuilding(s, 'nope')).toBe('No such building.')
    expect(canUpgradeBuilding(s, 'hearth')).toMatch(/cannot be upgraded/)
    const site = stand(s, 'shelter')
    site.built = false
    expect(canUpgradeBuilding(s, site.id)).toBe('Finish building it first.')
    site.built = true
    s.stock = {}
    expect(upgradeBuilding(s, site.id)).toBe('Not enough materials.')
    stockUp(s)
    expect(upgradeBuilding(s, site.id)).toBeNull()
    expect(upgradeBuilding(s, site.id)).toBe('An upgrade is already under way.')
    site.tier = 2
    delete site.upgradeProgress
    expect(canUpgradeBuilding(s, site.id)).toMatch(/fully upgraded/)
  })

  it('pays the cost, uses idle builders, keeps working, then raises the tier', () => {
    const s = newRun()
    stockUp(s)
    const mill = stand(s, 'lumberMill', { x: 3, y: 3 })
    assignWorker(s, mill.id)
    const plankBefore = s.stock.plank!
    expect(upgradeBuilding(s, mill.id)).toBeNull()
    expect(s.stock.plank).toBe(plankBefore - 4)
    expect(s.stock.brick).toBe(40 - 4)
    expect(isUpgrading(mill)).toBe(true)
    expect(tierOf(mill)).toBe(0)

    // Under way: it is still a working mill, at its old tier.
    const mods = computeModifiers(s)
    expect(buildingStatus(s, mill, mods).kind).toBe('working')
    tick(s, 0.5)
    expect(isUpgrading(mill)).toBe(true)
    expect(mill.recipeProgress).toBeGreaterThan(0)
    let guard = 0
    while (isUpgrading(mill) && guard++ < 400) tick(s, 0.125)
    expect(isUpgrading(mill)).toBe(false)
    expect(tierOf(mill)).toBe(1)
    expect(s.log.some((e) => e.text.includes('Water-wheel Mill'))).toBe(true)
  })

  it('makes no progress without idle builders, and shares them with other sites', () => {
    const s = newRun()
    stockUp(s)
    const shelter = stand(s, 'shelter')
    upgradeBuilding(s, shelter.id)
    const idle = idleVillagers(s)
    const mods = computeModifiers(s)

    // Everyone busy: nobody to build.
    const saved = idle.map((v) => v.assignment)
    for (const v of idle) v.assignment = 'elsewhere'
    stepProduction(s, 1, mods)
    expect(shelter.upgradeProgress).toBe(0)
    idle.forEach((v, i) => (v.assignment = saved[i]))

    stepProduction(s, 1, mods)
    const alone = shelter.upgradeProgress!
    expect(alone).toBeGreaterThan(0)

    // A second site halves the share each gets.
    const site = stand(s, 'cabin', { x: 50, y: 50 })
    site.built = false
    site.buildProgress = 0
    stepProduction(s, 1, mods)
    expect(shelter.upgradeProgress! - alone).toBeCloseTo(alone / 2)
    expect(site.buildProgress).toBeCloseTo(alone / 2)
  })

  it('can be rushed with amber', () => {
    const s = newRun()
    stockUp(s)
    const warehouse = stand(s, 'warehouse')
    expect(rushCost(s, warehouse.id)).toBe(0)
    expect(rushConstruction(s, warehouse.id)).toBe('Already finished.')
    upgradeBuilding(s, warehouse.id)
    const cost = rushCost(s, warehouse.id)
    expect(cost).toBe(Math.max(5, Math.ceil(16 * RUSH_COST_PER_SECOND)))
    s.stock.amber = cost - 1
    expect(rushConstruction(s, warehouse.id)).toBe('Not enough amber.')
    s.stock.amber = cost
    expect(rushConstruction(s, warehouse.id)).toBeNull()
    expect(s.stock.amber ?? 0).toBe(0)
    expect(tierOf(warehouse)).toBe(1)
    expect(isUpgrading(warehouse)).toBe(false)
    // Built count is about new buildings only.
    expect(s.stats.buildingsBuilt).toBe(0)
  })
})

describe('orders and decrees with tiers', () => {
  it('counting goals count each tier as a construction; standing orders count buildings', () => {
    const s = newRun()
    const goal = { kind: 'buildingsOfCategory', category: 'housing', amount: 2 } as const
    const baseline = goalCount(goal, s)!
    const shelter = stand(s, 'shelter')
    expect(goalProgress(goal, s, baseline)).toBeCloseTo(0.5)
    shelter.tier = 1
    expect(goalProgress(goal, s, baseline)).toBe(1)
    expect(describeTimedGoal(goal)).toMatch(/Build or upgrade 2 more housing/)
    // An ordinary order asks for buildings standing.
    expect(evaluateGoal({ kind: 'buildingId', buildingId: 'shelter', amount: 2 }, s)).toBeCloseTo(0.5)
  })
})

describe('upgrades and saves', () => {
  it('a mid-upgrade save resumes to the same future', () => {
    const s = newRun()
    stockUp(s)
    const shelter = stand(s, 'shelter', { x: 3, y: -3 })
    upgradeBuilding(s, shelter.id)
    for (let i = 0; i < 20; i++) tick(s, 0.125)
    const restored = JSON.parse(JSON.stringify(s)) as RunState
    for (let i = 0; i < 400; i++) {
      tick(s, 0.125)
      tick(restored, 0.125)
    }
    expect(restored.buildings).toEqual(s.buildings)
    expect(restored.stock).toEqual(s.stock)
    expect(tierOf(restored.buildings[shelter.id])).toBe(1)
  })

  it('old saves without tiers load at tier 0', () => {
    const legacy = JSON.parse(JSON.stringify(newRun())) as RunState
    for (const b of Object.values(legacy.buildings)) {
      delete b.tier
      delete b.upgradeProgress
    }
    expect(tierOf(Object.values(legacy.buildings)[0])).toBe(0)
    const store = new Map<string, string>([['emberwatch.run.v1', JSON.stringify(legacy)]])
    const original = globalThis.localStorage
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage
    try {
      const loaded = loadRun()!
      for (const b of Object.values(loaded.buildings)) {
        expect(b.tier).toBe(0)
        expect(b.upgradeProgress).toBeUndefined()
      }
      tick(loaded, 0.125)
      expect(loaded.phase).toBe('playing')
    } finally {
      globalThis.localStorage = original
    }
  })
})

describe('demolishing upgraded buildings', () => {
  const shelter = BUILDINGS.shelter
  const tier1 = shelter.upgrades![0]
  const half = (bag: Partial<Record<string, number>>, share: number) =>
    Object.fromEntries(Object.entries(bag).map(([k, v]) => [k, (v ?? 0) * share]))
  const sum = (...bags: Record<string, number>[]) => {
    const out: Record<string, number> = {}
    for (const bag of bags) for (const [k, v] of Object.entries(bag)) out[k] = (out[k] ?? 0) + v
    for (const k of Object.keys(out)) out[k] = Math.floor(out[k] + 1e-9)
    for (const k of Object.keys(out)) if (out[k] === 0) delete out[k]
    return out
  }

  it('returns half of the base cost and of every finished tier', () => {
    const s = newRun()
    const b = stand(s, 'shelter', { x: 40, y: 40 }, 1)
    expect(demolishRefund(b)).toEqual(
      sum(half(shelter.cost, DEMOLISH_REFUND_BUILT), half(tier1.cost, DEMOLISH_REFUND_BUILT)),
    )
    expect(demolishSpent(b)).toEqual(sum(half(shelter.cost, 1), half(tier1.cost, 1)))
    // The share the Inspector states is the rule's, before per-resource rounding.
    expect(demolishRefundPercent(b)).toBeCloseTo(DEMOLISH_REFUND_BUILT)
  })

  it('refunds an upgrade in full before work starts, sliding to half as it progresses', () => {
    const s = newRun()
    const b = stand(s, 'shelter')
    b.upgradeProgress = 0
    expect(demolishRefund(b)).toEqual(
      sum(half(shelter.cost, DEMOLISH_REFUND_BUILT), half(tier1.cost, 1)),
    )
    b.upgradeProgress = tier1.buildSeconds / 2
    const midShare = 1 - (1 - DEMOLISH_REFUND_BUILT) / 2
    expect(demolishRefund(b)).toEqual(
      sum(half(shelter.cost, DEMOLISH_REFUND_BUILT), half(tier1.cost, midShare)),
    )
  })

  it('pays the tier refund back into the stockpile on demolition', () => {
    const s = newRun()
    s.storageCap = 999
    s.stock = {}
    const b = stand(s, 'shelter', { x: 40, y: 40 }, 1)
    const expected = demolishRefund(b)
    expect(demolishBuilding(s, b.id)).toBeNull()
    for (const [id, amount] of Object.entries(expected)) {
      expect(s.stock[id as keyof typeof s.stock]).toBe(amount)
    }
  })
})
