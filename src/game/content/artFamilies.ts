import type { BaseIconId, IconId } from '../../art/icons'
import { runModifierArt } from './art'

/**
 * Art for the framed families — cornerstones, glade events, threats, pacts,
 * lingering conditions, lands, charters, Citadel upgrades, achievements —
 * plus villager traits, the side-panel tabs and the map's status badges.
 *
 * Kept apart from `art.ts` so none of it ships in the startup chunk: only the
 * lazily loaded screens (and the icon text helper they load) read it.
 */

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
  tendedGrounds: 'oak',
  connoisseurs: 'spicedAle',
  hearthkeepers: 'snowflake',
  forcedMarch: 'walker',
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
  // Storm blights (content/stormBlights.ts)
  'The Storm Stalker': 'lightning',
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
  // Storm blights: the forecasts, then the damage some leave for the Storm
  'Gathering Clouds': 'rain',
  'Leaking Roofs': 'drop',
  'Creeping Damp': 'moth',
  'Rising Waters': 'ferry',
  'Flooded Workshops': 'wave',
  'Something Stirs': 'owl',
  'Fever Winds': 'swirl',
  'Storm Fever': 'sleepy',
  'Black Frost': 'snowflake',
  'Killing Frost': 'snowflake',
  'The Long Night': 'lantern',
  // The forest's last stand while the Queen's envoy rides
  "The Forest's Dread": 'trees',
}

/** A lingering condition: its motif on a plum octagon. */
export function conditionArt(spec: { name: string }): IconId | undefined {
  const motif = CONDITION_MOTIF[spec.name]
  return motif && `condition/${motif}`
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
  lightFootprint: 'feather',
  ownCounsel: 'setSquare',
  vowKept: 'ring',
  refinedTastes: 'spicedAle',
  warmWinters: 'snowflake',
  termsHonoured: 'seal',
  beforeThirdStorm: 'sunrise',
}

/** An achievement: its motif on a medal — bronze, silver or gold by tier. */
export function achievementArt(def: {
  id: string
  tier: 'early' | 'mid' | 'late' | 'style'
}): IconId | undefined {
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
