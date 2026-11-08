import {
  BRAZIER_FOOTPRINT,
  BRAZIER_FUEL_PER_SECOND,
  BRAZIER_WARMTH_RADIUS,
  WARD_HOSTILITY_PER_OFFERING,
} from '../engine/balance'
import type { AdjacencyBonus, BuildingDef } from '../types'
import { BUILDING_ART } from './art'
import { BUILDING_UPGRADES } from './upgrades'

/**
 * Building catalogue. Recipes are declarative so the sim never needs a switch
 * over building ids — see `engine/production.ts`.
 *
 * Balance notes:
 *  - `seconds` is work-seconds at one worker's base speed (1/s). Two workers
 *    halve the wall-clock time; species bonuses stack on top.
 *  - Gathering recipes name a deposit; the camp only offers them if that
 *    deposit sits within `gatherRadius` world units of the camp.
 */
/**
 * Every service venue serves its neighbours best: each home within reach adds
 * capacity (up to three homes), and its supplier next door adds a little more.
 * Where homes go relative to services is therefore a real decision.
 */
function neighbourhood(supplierId: string): AdjacencyBonus[] {
  return [
    { nearCategory: 'housing', percent: 10, effect: 'capacity', maxPartners: 3 },
    { nearId: supplierId, percent: 10, effect: 'capacity' },
  ]
}

const defs: BuildingDef[] = [
  // -------------------------------------------------------------------------
  // Hearth
  // -------------------------------------------------------------------------
  {
    id: 'ancientHearth',
    name: 'Ancient Hearth',
    icon: '🔥',
    category: 'hearth',
    tags: ['special'],
    cost: {},
    buildSeconds: 0,
    // A firekeeper, when the forest needs calming: staffing it is optional.
    workerSlots: 1,
    recipes: [{ id: 'offering', inputs: { herb: 2 }, outputs: {}, seconds: 20 }],
    ward: { hostilityPerCycle: WARD_HOSTILITY_PER_OFFERING },
    // Comfortably more than the starting stock, so a new settlement is never
    // already over capacity on its first tick.
    storage: 80,
    // Villagers can bed down by the fire, so the opening is not an instant
    // homelessness penalty. Growth still needs real housing.
    housing: 6,
    unique: true,
    description:
      'The heart of the settlement. Burns wood to hold back the Blightstorm, shelters six, and marks where newcomers arrive. A firekeeper set here burns herbs as an offering to the forest, calming its hostility.',
  },

  // -------------------------------------------------------------------------
  // Housing
  // -------------------------------------------------------------------------
  {
    id: 'shelter',
    name: 'Shelter',
    icon: '⛺',
    category: 'housing',
    tags: ['housing'],
    cost: { wood: 12 },
    buildSeconds: 18,
    workerSlots: 0,
    recipes: [],
    housing: 5,
    description: 'Cheap, draughty, and enough to keep five villagers out of the rain.',
  },
  {
    id: 'cabin',
    name: 'Timber Cabin',
    icon: '🏠',
    category: 'housing',
    tags: ['housing'],
    cost: { plank: 8, brick: 4 },
    buildSeconds: 30,
    workerSlots: 0,
    recipes: [],
    housing: 10,
    description: 'A proper roof. Houses ten and grants a small resolve bonus to its residents.',
  },

  // -------------------------------------------------------------------------
  // Logistics
  // -------------------------------------------------------------------------
  {
    id: 'warehouse',
    name: 'Warehouse',
    icon: '📦',
    category: 'logistics',
    tags: ['storage'],
    cost: { wood: 10, stone: 6 },
    buildSeconds: 22,
    workerSlots: 0,
    recipes: [],
    storage: 120,
    description: 'Raises the settlement stockpile limit.',
  },
  {
    id: 'brazier',
    name: 'Brazier',
    icon: '🏮',
    category: 'logistics',
    tags: ['special'],
    cost: { wood: 10 },
    buildSeconds: 10,
    workerSlots: 0,
    recipes: [],
    warmth: { radius: BRAZIER_WARMTH_RADIUS, fuelPerSecond: BRAZIER_FUEL_PER_SECOND },
    footprint: BRAZIER_FOOTPRINT,
    description:
      'A fire bowl on a stone plinth. During the Storm it keeps homes within its small reach warm, burning a little wood — and goes cold when the woodpile runs out.',
  },
  {
    id: 'tradingPost',
    name: 'Trading Post',
    icon: '⚖️',
    category: 'logistics',
    tags: ['special'],
    cost: { plank: 6, stone: 8 },
    buildSeconds: 28,
    workerSlots: 1,
    unique: true,
    recipes: [
      {
        id: 'amberFromGoods',
        inputs: { plank: 2 },
        outputs: { amber: 12 },
        seconds: 24,
      },
      {
        id: 'amberFromFabric',
        inputs: { fabric: 2 },
        outputs: { amber: 14 },
        seconds: 24,
      },
    ],
    description: 'Lets you convert surplus goods into amber, and buy from passing caravans.',
  },

  // -------------------------------------------------------------------------
  // Gathering camps
  // -------------------------------------------------------------------------
  {
    id: 'woodcuttersCamp',
    name: "Woodcutters' Camp",
    icon: '🪓',
    category: 'gathering',
    tags: ['gathering'],
    cost: { wood: 6 },
    buildSeconds: 14,
    workerSlots: 2,
    gatherRadius: 3,
    recipes: [
      {
        id: 'wood',
        inputs: {},
        outputs: { wood: 3 },
        seconds: 14,
        requiresDeposit: 'trees',
      },
      {
        id: 'resin',
        inputs: {},
        outputs: { resin: 2, wood: 1 },
        seconds: 18,
        requiresDeposit: 'trees',
      },
    ],
    description: 'Fells trees in range for wood, or taps them slowly for resin.',
  },
  {
    id: 'stonecuttersCamp',
    name: "Stonecutters' Camp",
    icon: '⛏️',
    category: 'gathering',
    tags: ['gathering', 'masonry'],
    cost: { wood: 8 },
    buildSeconds: 16,
    workerSlots: 2,
    gatherRadius: 3,
    recipes: [
      {
        id: 'stone',
        inputs: {},
        outputs: { stone: 3 },
        seconds: 16,
        requiresDeposit: 'stoneVein',
      },
    ],
    description: 'Quarries stone veins in range.',
  },
  {
    id: 'clayPit',
    name: 'Clay Pit',
    icon: '🕳️',
    category: 'gathering',
    tags: ['gathering'],
    cost: { wood: 8 },
    buildSeconds: 16,
    workerSlots: 2,
    gatherRadius: 2,
    recipes: [
      {
        id: 'clay',
        inputs: {},
        outputs: { clay: 3 },
        seconds: 15,
        requiresDeposit: 'clayPatch',
      },
    ],
    description: 'Digs clay from wet ground.',
  },
  {
    id: 'copperMine',
    name: 'Copper Mine',
    icon: '🚧',
    category: 'gathering',
    tags: ['gathering'],
    cost: { plank: 4, stone: 8 },
    buildSeconds: 26,
    workerSlots: 3,
    gatherRadius: 2,
    recipes: [
      {
        id: 'ore',
        inputs: {},
        outputs: { copperOre: 3 },
        seconds: 20,
        requiresDeposit: 'orePatch',
      },
    ],
    description: 'Extracts copper ore from exposed seams.',
  },
  {
    id: 'herbalistsCamp',
    name: "Herbalists' Camp",
    icon: '🌿',
    category: 'gathering',
    tags: ['gathering', 'alchemy'],
    cost: { wood: 6 },
    buildSeconds: 14,
    workerSlots: 2,
    gatherRadius: 3,
    recipes: [
      {
        id: 'herb',
        inputs: {},
        outputs: { herb: 3 },
        seconds: 16,
        requiresDeposit: 'vegetation',
      },
      {
        id: 'fiber',
        inputs: {},
        outputs: { plantFiber: 3 },
        seconds: 15,
        requiresDeposit: 'vegetation',
      },
    ],
    description: 'Harvests undergrowth for herbs or plant fibre.',
  },
  {
    id: 'foragersCamp',
    name: "Foragers' Camp",
    icon: '🧺',
    category: 'gathering',
    tags: ['gathering'],
    cost: { wood: 6 },
    buildSeconds: 14,
    workerSlots: 2,
    gatherRadius: 3,
    recipes: [
      {
        id: 'berry',
        inputs: {},
        outputs: { berry: 4 },
        seconds: 15,
        requiresDeposit: 'vegetation',
      },
      {
        id: 'mushroom',
        inputs: {},
        outputs: { mushroom: 4 },
        seconds: 16,
        requiresDeposit: 'vegetation',
      },
      {
        id: 'insect',
        inputs: {},
        outputs: { insect: 5 },
        seconds: 17,
        requiresDeposit: 'vegetation',
      },
    ],
    description: 'Gathers whatever the forest floor is willing to give.',
  },
  {
    id: 'trappersCamp',
    name: "Trappers' Camp",
    icon: '🪤',
    category: 'gathering',
    tags: ['gathering', 'hunting'],
    cost: { wood: 8 },
    buildSeconds: 16,
    workerSlots: 2,
    gatherRadius: 3,
    recipes: [
      {
        id: 'meat',
        inputs: {},
        outputs: { meat: 4 },
        seconds: 17,
        requiresDeposit: 'game',
      },
      {
        id: 'egg',
        inputs: {},
        outputs: { egg: 4 },
        seconds: 16,
        requiresDeposit: 'game',
      },
    ],
    description: 'Sets snares for meat and raids nests for eggs.',
  },
  {
    id: 'smallFarm',
    name: 'Small Farm',
    icon: '🌾',
    category: 'gathering',
    tags: ['farming'],
    cost: { wood: 10 },
    buildSeconds: 20,
    workerSlots: 2,
    gatherRadius: 2,
    recipes: [
      {
        id: 'grain',
        inputs: {},
        outputs: { grain: 5 },
        seconds: 20,
        requiresDeposit: 'fertileSoil',
      },
      {
        id: 'vegetable',
        inputs: {},
        outputs: { vegetable: 5 },
        seconds: 20,
        requiresDeposit: 'fertileSoil',
      },
      {
        id: 'root',
        inputs: {},
        outputs: { root: 5 },
        seconds: 18,
        requiresDeposit: 'fertileSoil',
      },
    ],
    description: 'Works fertile soil. Yields nothing during the Storm.',
  },

  // -------------------------------------------------------------------------
  // Production
  // -------------------------------------------------------------------------
  {
    id: 'lumberMill',
    name: 'Lumber Mill',
    icon: '🪚',
    category: 'production',
    tags: ['woodworking'],
    cost: { wood: 12, stone: 4 },
    buildSeconds: 24,
    workerSlots: 2,
    recipes: [
      { id: 'plank', inputs: { wood: 2 }, outputs: { plank: 2 }, seconds: 16 },
      { id: 'part', inputs: { wood: 2, resin: 1 }, outputs: { part: 2 }, seconds: 24 },
    ],
    adjacency: [{ nearId: 'woodcuttersCamp', percent: 20 }],
    description: 'Saws wood into planks, or glues up mechanical parts. Works faster beside a Woodcutters’ Camp.',
  },
  {
    id: 'brickyard',
    name: 'Brickyard',
    icon: '🧱',
    category: 'production',
    tags: ['masonry'],
    cost: { wood: 8, stone: 8 },
    buildSeconds: 24,
    workerSlots: 2,
    recipes: [
      { id: 'brick', inputs: { clay: 2 }, outputs: { brick: 2 }, seconds: 17 },
      { id: 'brickStone', inputs: { clay: 1, stone: 2 }, outputs: { brick: 3 }, seconds: 22 },
    ],
    adjacency: [
      { nearId: 'clayPit', percent: 20 },
      { nearId: 'stonecuttersCamp', percent: 10 },
    ],
    description: 'Fires clay into bricks. Works faster beside a Clay Pit, and a little faster beside a Stonecutters’ Camp.',
  },
  {
    id: 'weaver',
    name: "Weaver's Shed",
    icon: '🧶',
    category: 'production',
    tags: ['crafting'],
    cost: { wood: 10, plank: 2 },
    buildSeconds: 22,
    workerSlots: 2,
    recipes: [
      { id: 'fabric', inputs: { plantFiber: 3 }, outputs: { fabric: 3 }, seconds: 18 },
      { id: 'gear', inputs: { fabric: 1, plank: 1 }, outputs: { trainingGear: 3 }, seconds: 22 },
    ],
    adjacency: [{ nearId: 'herbalistsCamp', percent: 15 }],
    description: 'Spins plant fibre into fabric and stitches training gear. Works faster beside an Herbalists’ Camp.',
  },
  {
    id: 'smelter',
    name: 'Smelter',
    icon: '♨️',
    category: 'production',
    tags: ['smithing'],
    cost: { brick: 6, stone: 8 },
    buildSeconds: 30,
    workerSlots: 2,
    recipes: [
      { id: 'bar', inputs: { copperOre: 2, wood: 1 }, outputs: { copperBar: 2 }, seconds: 22 },
    ],
    adjacency: [
      { nearId: 'copperMine', percent: 20 },
      { nearId: 'woodcuttersCamp', percent: 10 },
    ],
    description: 'Burns wood to render copper ore into bars. Works faster beside a Copper Mine, and a little faster beside a Woodcutters’ Camp.',
  },
  {
    id: 'toolshop',
    name: 'Toolshop',
    icon: '🔨',
    category: 'production',
    tags: ['smithing', 'crafting'],
    cost: { plank: 8, brick: 4 },
    buildSeconds: 30,
    workerSlots: 2,
    recipes: [
      { id: 'tool', inputs: { copperBar: 1, plank: 1 }, outputs: { tool: 2 }, seconds: 24 },
      { id: 'part', inputs: { copperBar: 1, fabric: 1 }, outputs: { part: 3 }, seconds: 26 },
    ],
    adjacency: [
      { nearId: 'smelter', percent: 20 },
      { nearId: 'lumberMill', percent: 10 },
    ],
    description: 'Turns bars and planks into tools and parts. Works faster beside a Smelter, and a little faster beside a Lumber Mill.',
  },
  {
    id: 'cookhouse',
    name: 'Cookhouse',
    icon: '🍳',
    category: 'production',
    tags: ['cooking'],
    cost: { wood: 10, clay: 4 },
    buildSeconds: 22,
    workerSlots: 2,
    recipes: [
      { id: 'biscuit', inputs: { grain: 2 }, outputs: { biscuit: 3 }, seconds: 18 },
      { id: 'skewer', inputs: { meat: 2 }, outputs: { skewer: 3 }, seconds: 18 },
      { id: 'porridge', inputs: { root: 2, grain: 1 }, outputs: { porridge: 4 }, seconds: 22 },
    ],
    adjacency: [
      { nearId: 'smallFarm', percent: 20 },
      { nearId: 'trappersCamp', percent: 10 },
    ],
    description: 'Cooked food feeds villagers twice as far and lifts resolve. Works faster beside a Small Farm, and a little faster beside a Trappers’ Camp.',
  },
  {
    id: 'smokehouse',
    name: 'Smokehouse',
    icon: '🏚️',
    category: 'production',
    tags: ['cooking'],
    cost: { wood: 8, brick: 4 },
    buildSeconds: 24,
    workerSlots: 2,
    recipes: [
      { id: 'jerky', inputs: { meat: 2, wood: 1 }, outputs: { jerky: 4 }, seconds: 20 },
      { id: 'eggJerky', inputs: { egg: 2, herb: 1 }, outputs: { jerky: 3 }, seconds: 20 },
    ],
    adjacency: [{ nearId: 'trappersCamp', percent: 20 }],
    description: 'Preserves meat over a slow fire. Works faster beside a Trappers’ Camp.',
  },
  {
    id: 'picklingShed',
    name: 'Pickling Shed',
    icon: '🫙',
    category: 'production',
    tags: ['cooking'],
    cost: { wood: 8, clay: 6 },
    buildSeconds: 22,
    workerSlots: 2,
    recipes: [
      { id: 'pickles', inputs: { vegetable: 2, herb: 1 }, outputs: { pickles: 4 }, seconds: 20 },
      { id: 'mushPickles', inputs: { mushroom: 3 }, outputs: { pickles: 3 }, seconds: 20 },
    ],
    adjacency: [{ nearId: 'smallFarm', percent: 15 }],
    description: 'Jars vegetables and mushrooms so they last the Storm. Works faster beside a Small Farm.',
  },
  {
    id: 'brewery',
    name: 'Brewery',
    icon: '🛢️',
    category: 'production',
    tags: ['brewing'],
    cost: { plank: 6, clay: 6 },
    buildSeconds: 26,
    workerSlots: 2,
    recipes: [
      { id: 'aleGrain', inputs: { grain: 2 }, outputs: { ale: 3 }, seconds: 18 },
      { id: 'aleBerry', inputs: { berry: 3 }, outputs: { ale: 3 }, seconds: 18 },
    ],
    adjacency: [
      { nearId: 'smallFarm', percent: 15 },
      { nearId: 'foragersCamp', percent: 10 },
    ],
    description: 'Ale keeps the tavern open and the villagers agreeable. Works faster beside a Small Farm, and a little faster beside a Foragers’ Camp.',
  },
  {
    id: 'scribesOffice',
    name: "Scribe's Office",
    icon: '✒️',
    category: 'production',
    tags: ['scholar'],
    cost: { plank: 6, fabric: 2 },
    buildSeconds: 26,
    workerSlots: 2,
    recipes: [
      { id: 'scroll', inputs: { plantFiber: 2, resin: 1 }, outputs: { scroll: 3 }, seconds: 20 },
      // The beavers' refined Education (see species.ts).
      { id: 'folio', inputs: { scroll: 1, plank: 1 }, outputs: { folio: 2 }, seconds: 22 },
    ],
    adjacency: [{ nearId: 'herbalistsCamp', percent: 15 }],
    description: 'Copies out scrolls for the Guild House. Works faster beside an Herbalists’ Camp.',
  },
  {
    id: 'apothecaryWorkshop',
    name: 'Apothecary Workshop',
    icon: '⚗️',
    category: 'production',
    tags: ['alchemy'],
    cost: { wood: 8, clay: 4 },
    buildSeconds: 24,
    workerSlots: 2,
    recipes: [
      { id: 'tea', inputs: { herb: 2 }, outputs: { tea: 3 }, seconds: 18 },
      { id: 'incense', inputs: { herb: 2, resin: 1 }, outputs: { incense: 3 }, seconds: 20 },
    ],
    adjacency: [{ nearId: 'herbalistsCamp', percent: 15 }],
    description: 'Brews tea and rolls incense from gathered herbs. Works faster beside an Herbalists’ Camp.',
  },

  // -------------------------------------------------------------------------
  // Services
  // -------------------------------------------------------------------------
  {
    id: 'tavern',
    name: 'Tavern',
    icon: '🍻',
    category: 'service',
    tags: ['service'],
    cost: { wood: 12, plank: 4 },
    buildSeconds: 26,
    workerSlots: 1,
    service: { need: 'luxury', capacity: 25 },
    recipes: [{ id: 'serve', inputs: { ale: 1 }, outputs: {}, seconds: 20 }],
    adjacency: neighbourhood('brewery'),
    description: 'Satisfies Luxury for up to 25 villagers while ale keeps flowing. Serves more of the settlement with homes close by.',
  },
  {
    id: 'temple',
    name: 'Small Shrine',
    icon: '⛩️',
    category: 'service',
    tags: ['service'],
    cost: { wood: 10, stone: 6 },
    buildSeconds: 26,
    workerSlots: 1,
    service: { need: 'religion', capacity: 25 },
    recipes: [{ id: 'serve', inputs: { incense: 1 }, outputs: {}, seconds: 20 }],
    adjacency: neighbourhood('apothecaryWorkshop'),
    description: 'Satisfies Religion for up to 25 villagers while incense burns. Serves more of the settlement with homes close by.',
  },
  {
    id: 'guildHouse',
    name: 'Guild House',
    icon: '🏛️',
    category: 'service',
    tags: ['service'],
    cost: { plank: 8, brick: 4 },
    buildSeconds: 30,
    workerSlots: 1,
    service: { need: 'education', capacity: 25 },
    recipes: [{ id: 'serve', inputs: { scroll: 1 }, outputs: {}, seconds: 20 }],
    adjacency: neighbourhood('scribesOffice'),
    description: 'Satisfies Education for up to 25 villagers. Serves more of the settlement with homes close by.',
  },
  {
    id: 'bathHouse',
    name: 'Bath House',
    icon: '🛁',
    category: 'service',
    tags: ['service'],
    cost: { plank: 6, clay: 6 },
    buildSeconds: 28,
    workerSlots: 1,
    service: { need: 'rest', capacity: 25 },
    recipes: [{ id: 'serve', inputs: { fabric: 1 }, outputs: {}, seconds: 22 }],
    adjacency: neighbourhood('weaver'),
    description: 'Satisfies Rest for up to 25 villagers. Serves more of the settlement with homes close by.',
  },
  {
    id: 'apothecary',
    name: 'Apothecary',
    icon: '🩹',
    category: 'service',
    tags: ['service'],
    cost: { wood: 10, fabric: 2 },
    buildSeconds: 26,
    workerSlots: 1,
    service: { need: 'treatment', capacity: 25 },
    recipes: [{ id: 'serve', inputs: { tea: 1 }, outputs: {}, seconds: 20 }],
    adjacency: neighbourhood('apothecaryWorkshop'),
    description: 'Satisfies Treatment for up to 25 villagers. Serves more of the settlement with homes close by.',
  },
  {
    id: 'arena',
    name: 'Clan Arena',
    icon: '🛡️',
    category: 'service',
    tags: ['service'],
    cost: { wood: 14, stone: 4 },
    buildSeconds: 28,
    workerSlots: 1,
    service: { need: 'brawling', capacity: 25 },
    recipes: [{ id: 'serve', inputs: { trainingGear: 1 }, outputs: {}, seconds: 20 }],
    adjacency: neighbourhood('weaver'),
    description: 'Satisfies Brawling for up to 25 villagers. Serves more of the settlement with homes close by.',
  },
]

// Upgrade tiers are declared in `content/upgrades.ts` and attached here, so
// every def carries its own `upgrades` like any other field.
for (const def of defs) def.upgrades ??= BUILDING_UPGRADES[def.id]
// Drawn icons are mapped in `content/art.ts`, alongside the emoji fallback.
for (const def of defs) def.art ??= BUILDING_ART[def.id]

export const BUILDINGS: Record<string, BuildingDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
)

export const BUILDING_LIST = defs

/**
 * Always available. This is the whole basic economy — housing, storage, every
 * gathering camp, and the first tier of processing.
 *
 * Keeping the fundamentals unlocked means a draft is never wasted on "the
 * building I needed to function", and every pick is instead a real choice about
 * which services and advanced chains this settlement will have.
 */
export const STARTING_BLUEPRINTS = [
  'shelter',
  'cabin',
  'warehouse',
  // Warmth is survival, like a roof: drafting it would make sprawl a matter of
  // luck. It costs wood every Storm instead, so it is a trade-off, not a fix.
  'brazier',
  'woodcuttersCamp',
  'stonecuttersCamp',
  'clayPit',
  'foragersCamp',
  'herbalistsCamp',
  'trappersCamp',
  'smallFarm',
  'lumberMill',
  'brickyard',
  'cookhouse',
]

/**
 * Drawn as reward picks during a run: the service venues, the goods that supply
 * them, and the deeper industry. You cannot unlock all of them in one run, so
 * which needs you can satisfy is the run's central decision.
 */
export const BLUEPRINT_POOL = defs
  .map((d) => d.id)
  .filter((id) => id !== 'ancientHearth' && !STARTING_BLUEPRINTS.includes(id))

export const CATEGORY_LABELS: Record<BuildingDef['category'], string> = {
  hearth: 'Hearth',
  housing: 'Housing',
  gathering: 'Gathering',
  production: 'Production',
  service: 'Services',
  logistics: 'Logistics',
}
