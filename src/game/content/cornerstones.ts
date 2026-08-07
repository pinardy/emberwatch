import type { CornerstoneDef } from '../types'

/**
 * Cornerstones are the run-shaping perks offered at reputation milestones.
 * Effects are pure data — `engine/modifiers.ts` folds them into a single
 * `Modifiers` object once per tick rather than scanning the list repeatedly.
 */
const defs: CornerstoneDef[] = [
  // ---- common --------------------------------------------------------------
  {
    id: 'sturdyScaffolds',
    name: 'Sturdy Scaffolds',
    icon: '🏗️',
    rarity: 'common',
    description: 'Construction is 30% faster.',
    effects: [{ kind: 'buildSpeed', percent: 30 }],
  },
  {
    id: 'sharpenedAxes',
    name: 'Sharpened Axes',
    icon: '🪓',
    rarity: 'common',
    description: 'Gathering camps work 20% faster.',
    effects: [{ kind: 'productionSpeed', tag: 'gathering', percent: 20 }],
  },
  {
    id: 'deepPantry',
    name: 'Deep Pantry',
    icon: '🥫',
    rarity: 'common',
    description: 'Villagers eat 20% less.',
    effects: [{ kind: 'foodUpkeep', percent: -20 }],
  },
  {
    id: 'tidyStores',
    name: 'Tidy Stores',
    icon: '📦',
    rarity: 'common',
    description: '+150 stockpile capacity.',
    effects: [{ kind: 'globalStorage', amount: 150 }],
  },
  {
    id: 'campfireTales',
    name: 'Campfire Tales',
    icon: '🔥',
    rarity: 'common',
    description: '+2 resolve for every species.',
    effects: [{ kind: 'resolveFlat', species: 'all', amount: 2 }],
  },
  {
    id: 'pathfinders',
    name: 'Pathfinders',
    icon: '🧭',
    rarity: 'common',
    description: 'Glades are cleared 35% faster.',
    effects: [{ kind: 'clearSpeed', percent: 35 }],
  },
  {
    id: 'coldForge',
    name: 'Cold Forge',
    icon: '🔩',
    rarity: 'common',
    description: 'Smithing and crafting are 25% faster.',
    effects: [
      { kind: 'productionSpeed', tag: 'smithing', percent: 25 },
      { kind: 'productionSpeed', tag: 'crafting', percent: 25 },
    ],
  },
  {
    id: 'humanTradition',
    name: 'Human Tradition',
    icon: '🧑‍🌾',
    rarity: 'common',
    description: 'Humans gain +6 resolve.',
    effects: [{ kind: 'resolveFlat', species: 'human', amount: 6 }],
  },
  {
    id: 'beaverGuilds',
    name: 'Beaver Guilds',
    icon: '🦫',
    rarity: 'common',
    description: 'Beavers gain +6 resolve and woodworking is 15% faster.',
    effects: [
      { kind: 'resolveFlat', species: 'beaver', amount: 6 },
      { kind: 'productionSpeed', tag: 'woodworking', percent: 15 },
    ],
  },
  {
    id: 'lizardRites',
    name: 'Lizard Rites',
    icon: '🦎',
    rarity: 'common',
    description: 'Lizards gain +6 resolve and hunting is 15% faster.',
    effects: [
      { kind: 'resolveFlat', species: 'lizard', amount: 6 },
      { kind: 'productionSpeed', tag: 'hunting', percent: 15 },
    ],
  },

  {
    id: 'rainCatchers',
    name: 'Rain Catchers',
    icon: '🪣',
    rarity: 'common',
    description: 'The hearth burns 30% less wood.',
    effects: [{ kind: 'hearthFuel', percent: -30 }],
  },
  {
    id: 'wardenOfRoads',
    name: 'Warden of the Roads',
    icon: '🛤️',
    rarity: 'common',
    description: 'Newcomers arrive 30% sooner.',
    effects: [{ kind: 'newcomerRate', percent: -30 }],
  },
  {
    id: 'scavengersInstinct',
    name: "Scavengers' Instinct",
    icon: '🪶',
    rarity: 'common',
    description: 'Cleared glades yield 40% more loot.',
    effects: [{ kind: 'gladeLoot', percent: 40 }],
  },
  {
    id: 'quietFootfalls',
    name: 'Quiet Footfalls',
    icon: '🐾',
    rarity: 'common',
    description: 'Clearing a glade angers the forest 40% less.',
    effects: [{ kind: 'gladeHostility', percent: -40 }],
  },
  {
    id: 'stormLanterns',
    name: 'Storm Lanterns',
    icon: '🏮',
    rarity: 'common',
    description: '+4 resolve for every species while the Storm rages.',
    effects: [{ kind: 'stormResolve', amount: 4 }],
  },

  // ---- rare ---------------------------------------------------------------
  {
    id: 'stormShroud',
    name: 'Storm Shroud',
    icon: '🌩️',
    rarity: 'rare',
    description: 'Hostility rises 30% more slowly.',
    effects: [{ kind: 'hostilityRate', percent: -30 }],
  },
  {
    id: 'queensFavour',
    name: "Queen's Favour",
    icon: '👑',
    rarity: 'rare',
    description: 'Reputation accrues 25% faster.',
    effects: [{ kind: 'reputationRate', percent: 25 }],
  },
  {
    id: 'boundlessHarvest',
    name: 'Boundless Harvest',
    icon: '🌻',
    rarity: 'rare',
    description: 'Farms and cookhouses have a 25% chance of doubling output.',
    effects: [
      { kind: 'extraOutput', tag: 'farming', chance: 0.25 },
      { kind: 'extraOutput', tag: 'cooking', chance: 0.25 },
    ],
  },
  {
    id: 'modestNeeds',
    name: 'Modest Needs',
    icon: '🕊️',
    rarity: 'rare',
    description: 'Every species needs one fewer service.',
    effects: [{ kind: 'needsFewerServices', species: 'all', amount: 1 }],
  },
  {
    id: 'efficientKilns',
    name: 'Efficient Kilns',
    icon: '♨️',
    rarity: 'rare',
    description: 'All production buildings work 15% faster.',
    effects: [{ kind: 'productionSpeed', tag: 'all', percent: 15 }],
  },

  {
    id: 'greenhouseFrames',
    name: 'Greenhouse Frames',
    icon: '🪟',
    rarity: 'rare',
    description: 'Farms keep working at 40% speed during the Storm.',
    effects: [{ kind: 'farmsInStorm', percent: 40 }],
  },
  {
    id: 'courtEnvoy',
    name: 'Court Envoy',
    icon: '📯',
    rarity: 'rare',
    description: "The Queen's impatience grows 30% slower.",
    effects: [{ kind: 'impatienceRate', percent: -30 }],
  },
  {
    id: 'silverTongues',
    name: 'Silver Tongues',
    icon: '🗣️',
    rarity: 'rare',
    description: 'Caravans charge 25% less.',
    effects: [{ kind: 'tradePrices', percent: -25 }],
  },

  // ---- epic ---------------------------------------------------------------
  {
    id: 'woodlandTruce',
    name: 'Woodland Truce',
    icon: '🕊️',
    rarity: 'epic',
    description: 'Clearing glades angers the forest not at all.',
    effects: [{ kind: 'gladeHostility', percent: -100 }],
  },
  {
    id: 'emberSanctum',
    name: 'Ember Sanctum',
    icon: '🕳️',
    rarity: 'epic',
    description: 'The hearth burns 60% less wood, and every species gains +3 resolve in the Storm.',
    effects: [
      { kind: 'hearthFuel', percent: -60 },
      { kind: 'stormResolve', amount: 3 },
    ],
  },
  {
    id: 'openGates',
    name: 'Open Gates',
    icon: '🚪',
    rarity: 'epic',
    description: 'Newcomers arrive 50% sooner and every species gains +2 resolve.',
    effects: [
      { kind: 'newcomerRate', percent: -50 },
      { kind: 'resolveFlat', species: 'all', amount: 2 },
    ],
  },
  {
    id: 'heraldOfTheFlame',
    name: 'Herald of the Flame',
    icon: '🕯️',
    rarity: 'epic',
    description: '+5 resolve for all species and reputation accrues 20% faster.',
    effects: [
      { kind: 'resolveFlat', species: 'all', amount: 5 },
      { kind: 'reputationRate', percent: 20 },
    ],
  },
  {
    id: 'forestAccord',
    name: 'Forest Accord',
    icon: '🌲',
    rarity: 'epic',
    description: 'Hostility rises 50% more slowly and glades clear 25% faster.',
    effects: [
      { kind: 'hostilityRate', percent: -50 },
      { kind: 'clearSpeed', percent: 25 },
    ],
  },
  {
    id: 'overflowingCoffers',
    name: 'Overflowing Coffers',
    icon: '💰',
    rarity: 'epic',
    description: 'All buildings have a 15% chance of doubling output. +100 storage.',
    effects: [
      { kind: 'extraOutput', tag: 'all', chance: 0.15 },
      { kind: 'globalStorage', amount: 100 },
    ],
  },
]

export const CORNERSTONES: Record<string, CornerstoneDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
)

export const CORNERSTONE_LIST = defs

export const RARITY_WEIGHTS: Record<CornerstoneDef['rarity'], number> = {
  common: 60,
  rare: 30,
  epic: 10,
}
