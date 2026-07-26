import type { OrderDef, OrderGoal, RunState } from '../types'
import { BUILDINGS } from './buildings'
import { RESOURCES, resourceName } from './resources'
import { totalHousing } from '../engine/queries'

/**
 * The Queen's orders. Three are active at a time; completing one grants
 * reputation and immediately draws a replacement.
 */
const defs: OrderDef[] = [
  { id: 'stock_plank_30', name: 'Stockpile planks', goal: { kind: 'stock', resource: 'plank', amount: 30 }, reputationReward: 1, reward: { amber: 20 } },
  { id: 'stock_brick_25', name: 'Stockpile bricks', goal: { kind: 'stock', resource: 'brick', amount: 25 }, reputationReward: 1, reward: { amber: 20 } },
  { id: 'stock_fabric_20', name: 'Stockpile fabric', goal: { kind: 'stock', resource: 'fabric', amount: 20 }, reputationReward: 1, reward: { amber: 20 } },
  { id: 'stock_tool_8', name: 'Forge a set of tools', goal: { kind: 'stock', resource: 'tool', amount: 8 }, reputationReward: 2, reward: { amber: 35 } },
  { id: 'stock_ale_15', name: 'Lay in ale for the Storm', goal: { kind: 'stock', resource: 'ale', amount: 15 }, reputationReward: 1, reward: { amber: 20 } },
  { id: 'stock_incense_12', name: 'Supply the shrines', goal: { kind: 'stock', resource: 'incense', amount: 12 }, reputationReward: 1, reward: { amber: 20 } },

  { id: 'stock_food_60', name: 'Fill the larders', goal: { kind: 'stockCategory', category: 'rawFood', amount: 60 }, reputationReward: 1, reward: { amber: 25 } },
  { id: 'stock_cooked_35', name: 'Cook for the settlement', goal: { kind: 'stockCategory', category: 'food', amount: 35 }, reputationReward: 2, reward: { amber: 35 } },

  { id: 'produced_wood_120', name: 'Fell the forest', goal: { kind: 'produced', resource: 'wood', amount: 120 }, reputationReward: 1, reward: { amber: 20 } },
  { id: 'produced_stone_80', name: 'Quarry stone', goal: { kind: 'produced', resource: 'stone', amount: 80 }, reputationReward: 1, reward: { amber: 20 } },
  { id: 'produced_plank_60', name: 'Mill timber', goal: { kind: 'produced', resource: 'plank', amount: 60 }, reputationReward: 1, reward: { amber: 25 } },
  { id: 'produced_scroll_20', name: 'Copy the archives', goal: { kind: 'produced', resource: 'scroll', amount: 20 }, reputationReward: 2, reward: { amber: 35 } },

  { id: 'pop_20', name: 'Grow the settlement', goal: { kind: 'population', amount: 20 }, reputationReward: 1, reward: { amber: 20 } },
  { id: 'pop_32', name: 'A settlement worth the name', goal: { kind: 'population', amount: 32 }, reputationReward: 2, reward: { amber: 40 } },
  { id: 'housing_35', name: 'Roofs for everyone', goal: { kind: 'housing', amount: 35 }, reputationReward: 1, reward: { amber: 25 } },

  { id: 'services_3', name: 'Open three services', goal: { kind: 'buildingsOfCategory', category: 'service', amount: 3 }, reputationReward: 2, reward: { amber: 35 } },
  { id: 'production_4', name: 'Industrialise', goal: { kind: 'buildingsOfCategory', category: 'production', amount: 4 }, reputationReward: 2, reward: { amber: 35 } },
  { id: 'housing_buildings_4', name: 'Build four homes', goal: { kind: 'buildingsOfCategory', category: 'housing', amount: 4 }, reputationReward: 1, reward: { amber: 20 } },
  { id: 'tavern_1', name: 'Raise a tavern', goal: { kind: 'buildingId', buildingId: 'tavern', amount: 1 }, reputationReward: 1, reward: { amber: 20 } },
  { id: 'warehouse_2', name: 'Two warehouses', goal: { kind: 'buildingId', buildingId: 'warehouse', amount: 2 }, reputationReward: 1, reward: { amber: 20 } },

  { id: 'glades_3', name: 'Push back the forest', goal: { kind: 'gladesCleared', amount: 3 }, reputationReward: 1, reward: { amber: 25 } },
  { id: 'glades_6', name: 'Tame the woods', goal: { kind: 'gladesCleared', amount: 6 }, reputationReward: 2, reward: { amber: 40 } },

  { id: 'resolve_25', name: 'A contented people', goal: { kind: 'resolveAbove', value: 25 }, reputationReward: 2, reward: { amber: 40 } },
  { id: 'resolve_35', name: 'Songs by the hearth', goal: { kind: 'resolveAbove', value: 35 }, reputationReward: 3, reward: { amber: 60 } },
]

export const ORDERS: Record<string, OrderDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
)

export const ORDER_LIST = defs

/** Human-readable goal, e.g. "Have 30 Planks in the stockpile". */
export function describeGoal(goal: OrderGoal): string {
  switch (goal.kind) {
    case 'stock':
      return `Have ${goal.amount} ${resourceName(goal.resource)} in the stockpile`
    case 'stockCategory':
      return `Have ${goal.amount} ${goal.category === 'food' ? 'cooked food' : 'raw food'} in the stockpile`
    case 'produced':
      return `Produce ${goal.amount} ${resourceName(goal.resource)} in total`
    case 'population':
      return `Reach ${goal.amount} villagers`
    case 'housing':
      return `Provide housing for ${goal.amount} villagers`
    case 'buildingsOfCategory':
      return `Build ${goal.amount} ${goal.category} buildings`
    case 'buildingId':
      return `Build ${goal.amount} × ${BUILDINGS[goal.buildingId]?.name ?? goal.buildingId}`
    case 'gladesCleared':
      return `Clear ${goal.amount} glades`
    case 'resolveAbove':
      return `Raise average resolve to ${goal.value}`
  }
}

/** Returns 0..1 progress toward the goal. */
export function evaluateGoal(goal: OrderGoal, s: RunState): number {
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  switch (goal.kind) {
    case 'stock':
      return clamp((s.stock[goal.resource] ?? 0) / goal.amount)
    case 'stockCategory': {
      let sum = 0
      for (const [id, amount] of Object.entries(s.stock)) {
        const def = RESOURCES[id as keyof typeof RESOURCES]
        if (def && def.category === goal.category) sum += amount ?? 0
      }
      return clamp(sum / goal.amount)
    }
    case 'produced':
      return clamp((s.producedTotals[goal.resource] ?? 0) / goal.amount)
    case 'population':
      return clamp(Object.keys(s.villagers).length / goal.amount)
    case 'housing':
      return clamp(totalHousing(s) / goal.amount)
    case 'buildingsOfCategory': {
      const n = Object.values(s.buildings).filter(
        (b) => b.built && BUILDINGS[b.defId]?.category === goal.category,
      ).length
      return clamp(n / goal.amount)
    }
    case 'buildingId': {
      const n = Object.values(s.buildings).filter(
        (b) => b.built && b.defId === goal.buildingId,
      ).length
      return clamp(n / goal.amount)
    }
    case 'gladesCleared':
      return clamp(s.stats.gladesCleared / goal.amount)
    case 'resolveAbove': {
      const present = s.speciesPool.filter((sp) =>
        Object.values(s.villagers).some((v) => v.species === sp),
      )
      if (present.length === 0) return 0
      const avg =
        present.reduce((acc, sp) => acc + s.resolve[sp], 0) / present.length
      return clamp(avg / goal.value)
    }
  }
}
