import type { DecreeDef } from '../types'

/**
 * Royal decrees: the Queen's timed orders. One is live at a time, issued on a
 * cadence (see `DECREE_*` in balance.ts). Meeting one before its deadline pays
 * better than an ordinary order; missing it costs her patience.
 *
 * Goals are sized for a few minutes of focused work. Counting goals (produced,
 * built, cleared) count only what happens after the decree is issued.
 */
const defs: DecreeDef[] = [
  { id: 'decree_planks', name: 'Royal Timber Levy', goal: { kind: 'produced', resource: 'plank', amount: 30 }, timeLimit: 240, reputationReward: 2, reward: { amber: 30 } },
  { id: 'decree_bricks', name: 'Bricks for the Citadel Walls', goal: { kind: 'produced', resource: 'brick', amount: 24 }, timeLimit: 240, reputationReward: 2, reward: { amber: 30 } },
  { id: 'decree_stone', name: 'Quarry Tithe', goal: { kind: 'produced', resource: 'stone', amount: 40 }, timeLimit: 240, reputationReward: 2, reward: { amber: 25 } },
  { id: 'decree_wood', name: 'Firewood for the Court', goal: { kind: 'produced', resource: 'wood', amount: 70 }, timeLimit: 210, reputationReward: 2, reward: { amber: 25 } },
  { id: 'decree_fabric', name: 'Cloth for the Royal Pavilion', goal: { kind: 'produced', resource: 'fabric', amount: 18 }, timeLimit: 240, reputationReward: 2, reward: { amber: 35 } },
  { id: 'decree_ale', name: "The Queen's Feast Day", goal: { kind: 'produced', resource: 'ale', amount: 18 }, timeLimit: 240, reputationReward: 2, reward: { amber: 35 } },
  { id: 'decree_homes', name: 'Quarter the Royal Guard', goal: { kind: 'buildingsOfCategory', category: 'housing', amount: 2 }, timeLimit: 200, reputationReward: 2, reward: { amber: 25 } },
  { id: 'decree_service', name: 'A Hall for the Common Folk', goal: { kind: 'buildingsOfCategory', category: 'service', amount: 1 }, timeLimit: 300, reputationReward: 3, reward: { amber: 40 } },
  { id: 'decree_glade', name: 'Extend the Royal Survey', goal: { kind: 'gladesCleared', amount: 1 }, timeLimit: 270, reputationReward: 2, reward: { amber: 30 } },
  { id: 'decree_larder', name: 'Provision the Envoy', goal: { kind: 'stockCategory', category: 'food', amount: 25 }, timeLimit: 240, reputationReward: 2, reward: { amber: 30 } },
]

export const DECREES: Record<string, DecreeDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
)

export const DECREE_LIST = defs
