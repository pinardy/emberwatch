import type { DecreeDef } from '../types'

/**
 * Royal decrees: the Queen's timed orders. One is live at a time, issued on a
 * cadence (see `DECREE_*` in balance.ts). Meeting one before its deadline pays
 * better than an ordinary order; missing it costs her patience.
 *
 * Goals are sized for a few minutes of focused work. Counting goals (produced,
 * built, cleared) count only what happens after the decree is issued, and
 * production amounts are only the listed size: each decree is re-sized from
 * the settlement's live output when it is offered (`decreeCandidate`).
 * What a decree pays says what the court values. Staples (wood, stone,
 * planks, bricks, homes) buy back the Queen's patience rather than her
 * favour — any economy can turn them out, and reputation is meant to follow
 * the services a settlement keeps. A new glade or a full larder earns a
 * point; goods that take a service chain, and a new service hall, earn two.
 */
const defs: DecreeDef[] = [
  { id: 'decree_planks', name: 'Royal Timber Levy', goal: { kind: 'produced', resource: 'plank', amount: 30 }, timeLimit: 240, reputationReward: 0, impatienceRelief: 1, reward: { amber: 30 } },
  { id: 'decree_bricks', name: 'Bricks for the Citadel Walls', goal: { kind: 'produced', resource: 'brick', amount: 24 }, timeLimit: 240, reputationReward: 0, impatienceRelief: 1, reward: { amber: 30 } },
  { id: 'decree_stone', name: 'Quarry Tithe', goal: { kind: 'produced', resource: 'stone', amount: 40 }, timeLimit: 240, reputationReward: 0, impatienceRelief: 1, reward: { amber: 25 } },
  { id: 'decree_wood', name: 'Firewood for the Court', goal: { kind: 'produced', resource: 'wood', amount: 70 }, timeLimit: 210, reputationReward: 0, impatienceRelief: 1, reward: { amber: 25 } },
  { id: 'decree_fabric', name: 'Cloth for the Royal Pavilion', goal: { kind: 'produced', resource: 'fabric', amount: 18 }, timeLimit: 240, reputationReward: 2, reward: { amber: 35 } },
  { id: 'decree_ale', name: "The Queen's Feast Day", goal: { kind: 'produced', resource: 'ale', amount: 18 }, timeLimit: 240, reputationReward: 2, reward: { amber: 35 } },
  { id: 'decree_homes', name: 'Quarter the Royal Guard', goal: { kind: 'buildingsOfCategory', category: 'housing', amount: 2 }, timeLimit: 200, reputationReward: 0, impatienceRelief: 1, reward: { amber: 25 } },
  { id: 'decree_service', name: 'A Hall for the Common Folk', goal: { kind: 'buildingsOfCategory', category: 'service', amount: 1 }, timeLimit: 300, reputationReward: 2, reward: { amber: 40 } },
  { id: 'decree_glade', name: 'Extend the Royal Survey', goal: { kind: 'gladesCleared', amount: 1 }, timeLimit: 270, reputationReward: 1, reward: { amber: 30 } },
  { id: 'decree_larder', name: 'Provision the Envoy', goal: { kind: 'producedCategory', category: 'food', amount: 30 }, timeLimit: 240, reputationReward: 1, reward: { amber: 30 } },
  // Appended: the court's luxuries, offered once a settlement makes them.
  { id: 'decree_incense', name: 'Incense for the Royal Chapel', goal: { kind: 'produced', resource: 'incense', amount: 15 }, timeLimit: 240, reputationReward: 2, reward: { amber: 35 } },
  { id: 'decree_scroll', name: 'Copies for the Royal Library', goal: { kind: 'produced', resource: 'scroll', amount: 15 }, timeLimit: 240, reputationReward: 2, reward: { amber: 35 } },
  { id: 'decree_tea', name: "Tea for the Queen's Physicians", goal: { kind: 'produced', resource: 'tea', amount: 15 }, timeLimit: 240, reputationReward: 2, reward: { amber: 35 } },
]

export const DECREES: Record<string, DecreeDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
)

export const DECREE_LIST = defs
