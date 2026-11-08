import type { BaseIconId, IconId } from '../../art/icons'
import type {
  BiomeId,
  DepositId,
  GladeKind,
  LayoutId,
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
  spicedAle: 'spicedAle',
  folio: 'folio',
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
  deadfall: 'deadfall',
  fireweed: 'fireweed',
  ruins: 'ruins',
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
  cinder: 'cinder',
}

/** Map layouts and biomes (`content/layouts.ts`), on the setup screen and the Founding. */
export const LAYOUT_ART: Record<LayoutId, IconId> = {
  rings: 'settlement',
  river: 'river',
  ridge: 'cliff',
  ruins: 'ruins',
}

export const BIOME_ART: Record<BiomeId, IconId> = {
  woodland: 'trees',
  cinderwood: 'cinder',
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

/** Lands (run modifiers): shown on the menu's daily card, so they ship eagerly. */
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
