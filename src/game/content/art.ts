import type { BaseIconId, IconId } from '../../art/icons'
import type {
  DepositId,
  GladeKind,
  ResourceId,
  Season,
  ServiceNeed,
  SpeciesId,
  TerrainId,
} from '../types'

/**
 * Which drawn icon (see `src/art/icons.ts`) stands for each piece of content.
 *
 * Content keeps its emoji `icon` — it is the fallback wherever art is
 * missing, and the glyph used in plain-text places (the log, `<option>`s,
 * `title`s). The records keyed by a closed id union are exhaustive, so a new
 * resource or species without art is a compile error. Buildings are keyed by
 * free-form strings: one without an entry renders its emoji, and a test lists
 * every building that is still waiting for art.
 */

export const RESOURCE_ART: Record<ResourceId, IconId> = {
  wood: 'wood',
  plank: 'plank',
  stone: 'stone',
  brick: 'brick',
  clay: 'clay',
  copperOre: 'copperOre',
  copperBar: 'copperBar',
  plantFiber: 'plantFiber',
  fabric: 'fabric',
  resin: 'resin',
  part: 'part',
  tool: 'tool',
  berry: 'berry',
  root: 'root',
  meat: 'meat',
  grain: 'grain',
  vegetable: 'vegetable',
  mushroom: 'mushroom',
  insect: 'insect',
  egg: 'egg',
  herb: 'herb',
  biscuit: 'biscuit',
  skewer: 'skewer',
  jerky: 'jerky',
  porridge: 'porridge',
  pickles: 'pickles',
  ale: 'ale',
  incense: 'incense',
  scroll: 'scroll',
  tea: 'tea',
  trainingGear: 'trainingGear',
  amber: 'amber',
}

export const BUILDING_ART: Partial<Record<string, IconId>> = {
  ancientHearth: 'ancientHearth',
  shelter: 'shelter',
  cabin: 'cabin',
  warehouse: 'warehouse',
  brazier: 'brazier',
  tradingPost: 'tradingPost',
  woodcuttersCamp: 'woodcuttersCamp',
  stonecuttersCamp: 'stonecuttersCamp',
  clayPit: 'clayPit',
  copperMine: 'copperMine',
  herbalistsCamp: 'herbalistsCamp',
  foragersCamp: 'foragersCamp',
  trappersCamp: 'trappersCamp',
  smallFarm: 'smallFarm',
  lumberMill: 'lumberMill',
  brickyard: 'brickyard',
  weaver: 'weaver',
  smelter: 'smelter',
  toolshop: 'toolshop',
  cookhouse: 'cookhouse',
  smokehouse: 'smokehouse',
  picklingShed: 'picklingShed',
  brewery: 'brewery',
  scribesOffice: 'scribesOffice',
  apothecaryWorkshop: 'apothecaryWorkshop',
  tavern: 'tavern',
  temple: 'temple',
  guildHouse: 'guildHouse',
  bathHouse: 'bathHouse',
  apothecary: 'apothecary',
  arena: 'arena',
}

export const SPECIES_ART: Record<SpeciesId, IconId> = {
  human: 'human',
  beaver: 'beaver',
  lizard: 'lizard',
  harpy: 'harpy',
  fox: 'fox',
}

export const NEED_ART: Record<ServiceNeed, IconId> = {
  rest: 'rest',
  luxury: 'luxury',
  religion: 'religion',
  education: 'education',
  brawling: 'brawling',
  treatment: 'treatment',
}

export const SEASON_ART: Record<Season, IconId> = {
  drizzle: 'drizzle',
  clearance: 'clearance',
  storm: 'storm',
}

/** The three HUD meters. */
export const METER_ART = {
  reputation: 'reputation',
  impatience: 'impatience',
  hostility: 'hostility',
} as const satisfies Record<string, IconId>

export const DEPOSIT_ART: Record<DepositId, IconId> = {
  trees: 'trees',
  stoneVein: 'stoneVein',
  clayPatch: 'clayPatch',
  orePatch: 'orePatch',
  vegetation: 'vegetation',
  game: 'game',
  fertileSoil: 'fertileSoil',
}

export const GLADE_ART: Record<GladeKind, IconId> = {
  settlement: 'settlement',
  small: 'small',
  dangerous: 'dangerous',
  forbidden: 'forbidden',
}

export const TERRAIN_ART: Record<TerrainId, IconId> = {
  clearing: 'small',
  fertile: 'fertileSoil',
  rock: 'stoneVein',
  marsh: 'marsh',
  forest: 'trees',
}

// ---------------------------------------------------------------------------
// Framed families. Each maps an id to a motif; the family's frame (and the
// rarity, glade kind, branch or tier that colours it) is added by the helper
// below it. The UI calls the helper with the def and keeps `def.icon` as the
// emoji fallback, so content files need no art fields of their own.
// ---------------------------------------------------------------------------

export const CORNERSTONE_MOTIF: Partial<Record<string, BaseIconId>> = {
  sturdyScaffolds: 'scaffold',
  sharpenedAxes: 'woodcuttersCamp',
  deepPantry: 'pantry',
  tidyStores: 'warehouse',
  campfireTales: 'settlement',
  pathfinders: 'compass',
  coldForge: 'bolt',
  humanTradition: 'human',
  beaverGuilds: 'beaver',
  lizardRites: 'lizard',
  rainCatchers: 'bucket',
  wardenOfRoads: 'road',
  scavengersInstinct: 'feather',
  quietFootfalls: 'game',
  stormLanterns: 'lantern',
  stormShroud: 'storm',
  queensFavour: 'reputation',
  boundlessHarvest: 'sunflower',
  modestNeeds: 'dove',
  efficientKilns: 'brickyard',
  greenhouseFrames: 'window',
  courtEnvoy: 'horn',
  silverTongues: 'speech',
  woodlandTruce: 'handshake',
  emberSanctum: 'pit',
  openGates: 'door',
  heraldOfTheFlame: 'religion',
  forestAccord: 'trees',
  overflowingCoffers: 'coins',
  kindlingBaskets: 'foragersCamp',
  stiltFoundations: 'ladder',
  harpyAeries: 'harpy',
  foxDens: 'fox',
  surveyorsEye: 'telescope',
  guildQuarters: 'houses',
  royalCouriers: 'horse',
  clearSkiesAlmanac: 'calendar',
  everburningBraziers: 'brazier',
  geomancersCompact: 'monolith',
  crownSeal: 'seal',
  citadelMasons: 'brick',
  wayfarersLedger: 'ledger',
  royalMandate: 'writ',
  stormwardens: 'swirl',
}

/** A cornerstone: its motif on a carved slab rimmed in its rarity's colour. */
export function cornerstoneArt(def: { id: string; rarity: 'common' | 'rare' | 'epic' }): IconId | undefined {
  const motif = CORNERSTONE_MOTIF[def.id]
  return motif && `stone-${def.rarity}/${motif}`
}

export const GLADE_EVENT_MOTIF: Partial<Record<string, BaseIconId>> = {
  rainDrenchedCache: 'chest',
  drownedShrine: 'temple',
  blightTouchedGrove: 'fog',
  stragglersCamp: 'shelter',
  humsOfTheDeep: 'notes',
  howlingDen: 'wolf',
  blightedWell: 'pit',
  leaningWatchtower: 'tower',
  abandonedApiary: 'bee',
  sunkenGranary: 'grain',
  wanderingMinstrel: 'lute',
  queensSurveyors: 'map',
  lostChildren: 'lantern',
  thunderstruckOak: 'oak',
  moulderingCellar: 'mushroom',
  stormTornCaravan: 'wheel',
  ratKingsCourt: 'rat',
  wardstoneCircle: 'monolith',
  fogboundFerry: 'ferry',
  emberMoths: 'moth',
  hermitsGarden: 'hermit',
  collapsedMine: 'stonecuttersCamp',
  mirrorPool: 'mirror',
  lostCourier: 'envelope',
  ancientVault: 'key',
  stormBeast: 'wolf',
  sunkenLibrary: 'books',
  sleepingTitan: 'mountain',
  echoingCatacombs: 'grave',
  stormheartGrove: 'storm',
  abandonedForge: 'forge',
  starfallCrater: 'comet',
  drownedBellTower: 'bell',
  fenWitch: 'witch',
  sealedTreasury: 'coins',
}

/** A glade event: its motif in a ring of its glade kind's colour. */
export function gladeEventArt(def: { id: string; kind: 'dangerous' | 'forbidden' }): IconId | undefined {
  const motif = GLADE_EVENT_MOTIF[def.id]
  return motif && `event-${def.kind}/${motif}`
}

/** Threats, by name (they are copied into the run, so the name is what a save keeps). */
export const THREAT_MOTIF: Partial<Record<string, BaseIconId>> = {
  'The Wolf Pack': 'wolf',
  'Well Sickness': 'miasma',
  'Things in the Shaft': 'pit',
  'The Waking Titan': 'mountain',
  'The Restless Dead': 'forbidden',
  'The Drowned Choir': 'bell',
}

/** A threat: its motif in a spiked red ring. */
export function threatArt(spec: { name: string }): IconId | undefined {
  const motif = THREAT_MOTIF[spec.name]
  return motif && `threat/${motif}`
}

/** Pacts and blessings an event grants for the rest of the run, by name. */
export const PACT_MOTIF: Partial<Record<string, BaseIconId>> = {
  'Watchful Eyes': 'tower',
  'Feral Pollinators': 'bee',
  'Songs of the Road': 'lute',
  "Rat King's Favour": 'rat',
  'The Old Ward': 'monolith',
  'The Ferry Crossing': 'ferry',
  'Moth-Lit Braziers': 'moth',
  Foresight: 'mirror',
  'Stormheart Saplings': 'lightning',
  'The Old Forge': 'forge',
  'The Storm Bell': 'bell',
  "Witch's Ground-Lore": 'witch',
}

/** Lingering conditions, by name. */
export const CONDITION_MOTIF: Partial<Record<string, BaseIconId>> = {
  "The Spirit's Tribute": 'religion',
  'Spreading Blight': 'fog',
  'Flooded Paths': 'wave',
  "The Surveyors' Wager": 'map',
  "Merchant's Debt": 'writ',
  'Rats in the Stores': 'rat',
  'Restless Dreams': 'rest',
  'Broken Seals': 'envelope',
  "The Witch's Curse": 'witch',
  'The Royal Audit': 'ledger',
}

/** A lingering condition: its motif on a plum octagon. */
export function conditionArt(spec: { name: string }): IconId | undefined {
  const motif = CONDITION_MOTIF[spec.name]
  return motif && `condition/${motif}`
}

export const RUN_MODIFIER_MOTIF: Partial<Record<string, BaseIconId>> = {
  richVeins: 'stonecuttersCamp',
  fertileFloodplain: 'fertileSoil',
  restlessForest: 'trees',
  longStorms: 'swirl',
  wanderingTraders: 'camel',
  sparseGame: 'deer',
  ancientRuins: 'guildHouse',
  earlyFrost: 'snowflake',
  bountifulGroves: 'berry',
  illOmens: 'owl',
  crowdedRoads: 'road',
  petrifiedWoods: 'wood',
  amberSprings: 'drop',
  pilgrimRoad: 'religion',
  wildFrontier: 'wolf',
}

/** A land (run modifier): its motif on a mossy tile. */
export function runModifierArt(def: { id: string }): IconId | undefined {
  const motif = RUN_MODIFIER_MOTIF[def.id]
  return motif && `land/${motif}`
}

export const CHARTER_MOTIF: Partial<Record<string, BaseIconId>> = {
  hearthguardCharter: 'shield',
  wildwardenCharter: 'trees',
  guildCharter: 'part',
  heraldsCharter: 'horn',
  royalIndulgence: 'reputation',
  patientCrown: 'impatience',
  architectsWarrant: 'setSquare',
}

/** One of the Queen's charters: its motif on a gold seal with ribbon tails. */
export function charterArt(def: { id: string }): IconId | undefined {
  const motif = CHARTER_MOTIF[def.id]
  return motif && `charter/${motif}`
}

export type MetaBranchId = 'provisions' | 'charters' | 'knowledge' | 'crown'

export const META_BRANCH_MOTIF: Record<MetaBranchId, BaseIconId> = {
  provisions: 'warehouse',
  charters: 'scroll',
  knowledge: 'books',
  crown: 'reputation',
}

/** A Citadel branch: its motif on its own banner. */
export function metaBranchArt(id: MetaBranchId): IconId {
  return `citadel-${id}/${META_BRANCH_MOTIF[id]}`
}

export const META_UPGRADE_MOTIF: Partial<Record<string, BaseIconId>> = {
  deeperStores: 'wood',
  travelRations: 'biscuit',
  amberPurse: 'coins',
  secondWagon: 'cart',
  unlockHarpy: 'harpy',
  unlockFox: 'fox',
  merchantCharter: 'tradingPost',
  openRoads: 'road',
  charterOffice: 'folder',
  frontierCharter: 'wolf',
  surveyorsNotes: 'map',
  secondThoughts: 'die',
  broaderArchives: 'setSquare',
  forestLore: 'mushroom',
  masonsArchive: 'guildHouse',
  scoutsReport: 'magnifier',
  unchartedLands: 'compass',
  secondSurvey: 'telescope',
  citadelBlessing: 'religion',
  wardensWrit: 'shield',
  viceroysSignet: 'ring',
  queensEar: 'ear',
  royalArchive: 'education',
  gildedHearth: 'gem',
  chosenGround: 'pin',
}

/** A Citadel upgrade: its motif on a banner in its branch's colour. */
export function metaUpgradeArt(def: { id: string; branch: MetaBranchId }): IconId | undefined {
  const motif = META_UPGRADE_MOTIF[def.id]
  return motif && `citadel-${def.branch}/${motif}`
}

/** The Queen's Edicts by rung (1–7). */
export const EDICT_MOTIF: Partial<Record<number, BaseIconId>> = {
  1: 'impatience',
  2: 'bread',
  3: 'trees',
  4: 'storm',
  5: 'chain',
  6: 'walker',
  7: 'scroll',
}

/** An edict: its motif on a red-rimmed shield. */
export function edictArt(level: number): IconId | undefined {
  const motif = EDICT_MOTIF[level]
  return motif && `edict/${motif}`
}

export const ACHIEVEMENT_MOTIF: Partial<Record<string, BaseIconId>> = {
  firstEmbers: 'small',
  firstWin: 'reputation',
  intoTheWoods: 'herb',
  byRoyalDecree: 'horn',
  paidInFull: 'coin',
  betterBuilt: 'tool',
  dailyBread: 'calendar',
  underEdict: 'scroll',
  bitterTerms: 'storm',
  noOneLeftBehind: 'dove',
  swiftCharter: 'horse',
  keptTheFlame: 'settlement',
  cartographer: 'map',
  weathered: 'swirl',
  fivePeoples: 'handshake',
  seasonedViceroy: 'star',
  forestTamer: 'trees',
  threeDawns: 'sunrise',
  exactingCrown: 'gem',
  everyRung: 'ladder',
  queensFavourite: 'medal',
  everyComfort: 'guildHouse',
  masterworks: 'castle',
  lightningCharter: 'lightning',
  manyHands: 'people',
}

/** An achievement: its motif on a medal — bronze, silver or gold by tier. */
export function achievementArt(def: { id: string; tier: 'early' | 'mid' | 'late' }): IconId | undefined {
  const motif = ACHIEVEMENT_MOTIF[def.id]
  return motif && `medal-${def.tier}/${motif}`
}

export const VILLAGER_TRAIT_ART: Partial<Record<string, IconId>> = {
  diligent: 'arm',
  sluggish: 'sleepy',
  glutton: 'meat',
  frugal: 'spoon',
  strongback: 'brick',
  pathfinder: 'compass',
  forager: 'mushroom',
  stormborn: 'storm',
}

/**
 * An entry in the run's "Pacts & blessings": a glade pact, a land, a charter,
 * the Citadel's provisions or the founding edict. Matched by the id the sim
 * gives each kind, then by name, so older saves find their art too.
 */
export function ongoingArt(effect: { id: string; name: string }): IconId | undefined {
  if (effect.id === 'citadel') return 'pact/guildHouse'
  if (effect.id === 'edict') return 'edict/scroll'
  if (effect.id.startsWith('land_')) return runModifierArt({ id: effect.id.slice(5) })
  if (effect.id.startsWith('charter_')) return charterArt({ id: effect.id.slice(8) })
  const motif = PACT_MOTIF[effect.name]
  return motif && `pact/${motif}`
}

/** The side-panel tabs. */
export const TAB_ART = {
  build: 'tool',
  villagers: 'people',
  orders: 'scroll',
  trade: 'tradingPost',
  log: 'ledger',
} as const satisfies Record<string, IconId>

/** Building status badges on both maps: a white glyph on the badge's colour. */
export const STATUS_BADGE_ART = {
  construction: 'mono/tool',
  paused: 'mono/pause',
  noWorkers: 'mono/person',
  noDeposit: 'mono/noEntry',
  offSeason: 'mono/rain',
  waitingInputs: 'mono/impatience',
  storageFull: 'mono/warehouse',
  working: 'mono/part',
  cold: 'mono/snowflake',
} as const satisfies Record<string, IconId>
