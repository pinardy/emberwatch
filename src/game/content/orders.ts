import type { OrderDef } from '../types'

/**
 * The Queen's orders. Three are active at a time; completing one grants
 * reputation, and the Queen then offers two candidates for the empty slot.
 * Candidates are drawn only from goals the settlement can reach and has not
 * already mostly met (see `engine/orders.ts`).
 */
const defs: OrderDef[] = [
  { id: 'stock_plank_30', name: 'Stockpile planks', goal: { kind: 'stock', resource: 'plank', amount: 30 }, reputationReward: 1, reward: { amber: 20 } },
  { id: 'stock_brick_25', name: 'Stockpile bricks', goal: { kind: 'stock', resource: 'brick', amount: 25 }, reputationReward: 1, reward: { amber: 20 } },
  { id: 'stock_fabric_20', name: 'Stockpile fabric', goal: { kind: 'stock', resource: 'fabric', amount: 20 }, reputationReward: 1, reward: { amber: 20 } },
  { id: 'stock_tool_8', name: 'Forge a set of tools', goal: { kind: 'stock', resource: 'tool', amount: 8 }, reputationReward: 2, reward: { amber: 35 } },
  { id: 'stock_ale_15', name: 'Lay in ale for the Storm', goal: { kind: 'stock', resource: 'ale', amount: 15 }, reputationReward: 1, reward: { amber: 20 } },
  { id: 'stock_incense_12', name: 'Supply the shrines', goal: { kind: 'stock', resource: 'incense', amount: 12 }, reputationReward: 1, reward: { amber: 20 } },

  { id: 'stock_food_60', name: 'Fill the larders', goal: { kind: 'stockCategory', category: 'rawFood', amount: 60 }, reputationReward: 1, reward: { amber: 25 } },
  // Cooked food is eaten as it is made, so this counts meals cooked, not a
  // larder level (as a stock goal it sat at 0% in most runs).
  { id: 'stock_cooked_35', name: 'Cook for the settlement', goal: { kind: 'producedCategory', category: 'food', amount: 60 }, reputationReward: 2, reward: { amber: 35 } },

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

  { id: 'glades_3', name: 'Push back the forest', goal: { kind: 'gladesCleared', amount: 2 }, reputationReward: 1, reward: { amber: 25 } },
  { id: 'glades_6', name: 'Tame the woods', goal: { kind: 'gladesCleared', amount: 3 }, reputationReward: 1, reward: { amber: 40 } },

  { id: 'resolve_25', name: 'A contented people', goal: { kind: 'resolveAbove', value: 25 }, reputationReward: 2, reward: { amber: 40 } },
  { id: 'resolve_35', name: 'Songs by the hearth', goal: { kind: 'resolveAbove', value: 35 }, reputationReward: 3, reward: { amber: 60 } },

  // Appended (draws are by position, so existing orders keep their place).
  // Orders never expire, so new ones stick to goals every settlement can reach
  // from its starting blueprints — an unreachable order clogs a slot all run.
  { id: 'produced_wood_250', name: 'Stack the winter woodpile', goal: { kind: 'produced', resource: 'wood', amount: 250 }, reputationReward: 1, reward: { amber: 25 } },
  { id: 'glades_9', name: 'Master of the wilds', goal: { kind: 'gladesCleared', amount: 4 }, reputationReward: 1, reward: { amber: 45 } },
  // Retired: glade orders now count from their draw and reach at most four
  // glades ahead, so this one is never drawn; kept so older saves still read.
  { id: 'glades_12', name: 'Reclaim the old frontier', goal: { kind: 'gladesCleared', amount: 12 }, reputationReward: 2, reward: { amber: 50 } },

  // Citadel shipments: the goods are handed over (consumed) when the order is
  // met, so the deeper non-service chains have a path to reputation too.
  // Only offered once the settlement can make the goods.
  { id: 'ship_tool_8', name: 'Citadel shipment: tools', goal: { kind: 'stock', resource: 'tool', amount: 8 }, reputationReward: 2, reward: { amber: 30 }, consume: true },
  { id: 'ship_part_10', name: 'Citadel shipment: parts', goal: { kind: 'stock', resource: 'part', amount: 10 }, reputationReward: 2, reward: { amber: 30 }, consume: true },
  { id: 'ship_copper_12', name: 'Citadel shipment: copper', goal: { kind: 'stock', resource: 'copperBar', amount: 12 }, reputationReward: 2, reward: { amber: 30 }, consume: true },
]

/**
 * The founding writ: three small Year-1 goals, one chosen at the start,
 * worth a point of reputation in the first few minutes. Never drawn as an
 * ordinary order.
 */
export const WRIT_LIST: OrderDef[] = [
  { id: 'writ_glades', name: 'Claim the near woods', goal: { kind: 'gladesCleared', amount: 2 }, reputationReward: 1, reward: { amber: 10 } },
  { id: 'writ_settlers', name: 'Welcome the first settlers', goal: { kind: 'population', amount: 10 }, reputationReward: 1, reward: { amber: 10 } },
  { id: 'writ_camps', name: 'Set the camps to work', goal: { kind: 'staffed', category: 'gathering', amount: 4 }, reputationReward: 1, reward: { amber: 10 } },
]

/**
 * A counting order ("produce N more of X"), drawn when no ordinary order
 * suits the settlement. Its instance carries the goal, sized from what the
 * settlement makes at the moment; this goal is only a placeholder.
 */
export const COUNTING_ORDER: OrderDef = {
  id: 'count_produce',
  name: 'Royal requisition',
  goal: { kind: 'produced', resource: 'wood', amount: 30 },
  reputationReward: 1,
  reward: { amber: 20 },
}

export const ORDERS: Record<string, OrderDef> = Object.fromEntries(
  [...defs, ...WRIT_LIST, COUNTING_ORDER].map((d) => [d.id, d]),
)

export const ORDER_LIST = defs
