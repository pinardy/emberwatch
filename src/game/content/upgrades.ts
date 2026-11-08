import type { BuildingUpgrade } from '../types'

/**
 * Upgrade tiers, by building def id. Data only — the building catalogue
 * attaches each list to its def's `upgrades` (see `content/buildings.ts`), and
 * `engine/upgrades.ts` folds the effects into the sim.
 *
 * Design notes:
 *  - Tier 1 is priced in the first processed goods (planks, bricks), tier 2
 *    in the deeper chains (parts, tools, copper bars), so the production
 *    chains past the brickyard pay off in the late game.
 *  - An upgrade is worth less per material than a fresh building, but it
 *    takes no new ground — inside the hearth's warmth, beside the right
 *    neighbours — and no new worker. That is the trade.
 */

/** Every service venue grows the same way: a wing, then a hall. */
function venue(wing: string, hall: string): BuildingUpgrade[] {
  return [
    {
      name: wing,
      cost: { plank: 6, brick: 4 },
      buildSeconds: 20,
      effects: { serviceCapacity: 10 },
    },
    {
      name: hall,
      cost: { brick: 6, part: 3 },
      buildSeconds: 26,
      effects: { serviceCapacity: 12 },
    },
  ]
}

/** A gathering camp's first tier: an extra hand and a longer reach. */
function camp(name: string, extra: BuildingUpgrade['effects'] = {}): BuildingUpgrade {
  return {
    name,
    cost: { plank: 4, brick: 2 },
    buildSeconds: 14,
    effects: { workerSlots: 1, gatherRadius: 1, ...extra },
  }
}

export const BUILDING_UPGRADES: Record<string, BuildingUpgrade[]> = {
  // --- housing ---------------------------------------------------------------
  shelter: [
    {
      name: 'Reinforced Shelter',
      cost: { plank: 5, wood: 4 },
      buildSeconds: 12,
      // Tarred walls: stays warm in the Storm wherever it stands.
      effects: { housing: 2, insulated: true },
    },
    {
      name: 'Snug Lodge',
      cost: { plank: 4, brick: 4 },
      buildSeconds: 16,
      effects: { housing: 2, comfort: true },
    },
  ],
  cabin: [
    {
      name: 'Two-storey Cabin',
      cost: { plank: 6, brick: 6 },
      buildSeconds: 22,
      effects: { housing: 4, insulated: true },
    },
  ],

  // --- logistics -------------------------------------------------------------
  warehouse: [
    {
      name: 'Raised Warehouse',
      cost: { plank: 6, stone: 6 },
      buildSeconds: 16,
      effects: { storage: 80 },
    },
    {
      name: 'Stone Depot',
      cost: { brick: 8, part: 2 },
      buildSeconds: 24,
      effects: { storage: 100 },
    },
  ],
  brazier: [
    {
      name: 'Iron Brazier',
      cost: { brick: 3, plank: 2 },
      buildSeconds: 10,
      effects: { warmthRadius: 1.5 },
    },
  ],
  tradingPost: [
    {
      name: 'Counting House',
      cost: { plank: 6, brick: 6 },
      buildSeconds: 20,
      effects: { extraOutputs: { amberFromGoods: { amber: 4 }, amberFromFabric: { amber: 4 } } },
    },
    {
      name: 'Caravanserai',
      cost: { part: 3, copperBar: 2 },
      buildSeconds: 26,
      effects: {
        workerSlots: 1,
        recipes: [{ id: 'amberFromTools', inputs: { tool: 1 }, outputs: { amber: 14 }, seconds: 20 }],
      },
    },
  ],

  // --- gathering -------------------------------------------------------------
  woodcuttersCamp: [
    camp('Logging Camp'),
    {
      name: 'Timber Yard',
      cost: { part: 2, tool: 1 },
      buildSeconds: 20,
      effects: { workSpeed: 20, extraOutputs: { wood: { wood: 1 } } },
    },
  ],
  foragersCamp: [camp('Foragers’ Lodge')],
  trappersCamp: [
    camp('Hunting Lodge'),
    {
      name: 'Game Warden’s Lodge',
      cost: { part: 2, tool: 1 },
      buildSeconds: 20,
      effects: { workSpeed: 20 },
    },
  ],
  stonecuttersCamp: [
    camp('Quarry'),
    {
      name: 'Deep Quarry',
      cost: { part: 2, tool: 2 },
      buildSeconds: 22,
      effects: { extraOutputs: { stone: { stone: 1 } } },
    },
  ],
  herbalistsCamp: [camp('Herb Garden')],
  smallFarm: [
    {
      name: 'Irrigated Farm',
      cost: { plank: 4, brick: 2 },
      buildSeconds: 16,
      effects: { workerSlots: 1, workSpeed: 15 },
    },
    {
      name: 'Homestead',
      cost: { brick: 4, tool: 2 },
      buildSeconds: 22,
      effects: {
        extraOutputs: { grain: { grain: 1 }, vegetable: { vegetable: 1 }, root: { root: 1 } },
        recipes: [
          { id: 'herbBeds', inputs: {}, outputs: { herb: 4 }, seconds: 18, requiresDeposit: 'fertileSoil' },
        ],
      },
    },
  ],

  // --- production ------------------------------------------------------------
  lumberMill: [
    {
      name: 'Water-wheel Mill',
      cost: { plank: 4, brick: 4 },
      buildSeconds: 18,
      effects: { workSpeed: 25 },
    },
    {
      name: 'Joinery',
      cost: { part: 2, copperBar: 2 },
      buildSeconds: 24,
      effects: { workerSlots: 1, extraOutputs: { plank: { plank: 1 } } },
    },
  ],
  cookhouse: [
    {
      name: 'Clay-oven Kitchen',
      cost: { brick: 4, plank: 2 },
      buildSeconds: 18,
      effects: { workerSlots: 1, workSpeed: 10 },
    },
    {
      name: 'Hearth Kitchen',
      cost: { part: 2, copperBar: 2 },
      buildSeconds: 24,
      effects: {
        recipes: [{ id: 'rootPorridge', inputs: { root: 3 }, outputs: { porridge: 4 }, seconds: 20 }],
        extraOutputs: { biscuit: { biscuit: 1 }, skewer: { skewer: 1 } },
      },
    },
  ],
  brewery: [
    {
      name: 'Copper Still',
      cost: { plank: 4, brick: 4 },
      buildSeconds: 18,
      effects: {
        extraOutputs: { aleGrain: { ale: 1 }, aleBerry: { ale: 1 } },
        // Ale steeped with herbs: the humans' refined Luxury (see species.ts).
        recipes: [{ id: 'spicedAle', inputs: { ale: 2, herb: 1 }, outputs: { spicedAle: 2 }, seconds: 20 }],
      },
    },
    {
      name: 'Brewhouse',
      cost: { part: 2, copperBar: 2 },
      buildSeconds: 24,
      effects: { workerSlots: 1, workSpeed: 15 },
    },
  ],

  // --- services --------------------------------------------------------------
  tavern: venue('Taproom', 'Alehouse'),
  temple: venue('Cloister', 'Temple'),
  guildHouse: venue('Reading Room', 'Guild Hall'),
  bathHouse: venue('Steam Room', 'Grand Baths'),
  apothecary: venue('Infirmary', 'Hospice'),
  arena: venue('Sparring Ring', 'Grand Arena'),
}
