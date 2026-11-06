import type {
  CitadelPerks,
  CornerstoneEffect,
  GladeEventOptionDef,
  MetaHistoryEntry,
  MetaState,
  ResourceBag,
  RunState,
  SpeciesId,
} from '../types'
import {
  backfillAchievements,
  emptyAchievementState,
  isAchievementTitle,
  migrateAchievementState,
} from './achievements'
import { emptyDailyLedger, isDateKey, migrateDailyLedger } from './daily'

/**
 * Between-run progression: the Citadel's upgrade tree and the Queen's Edicts.
 *
 * Upgrades are data, like cornerstones: each declares what it changes and
 * `citadelPerks` folds the owned set into one summary that `createRun` reads.
 * Most of the tree widens the option space (more draft options, extra event
 * choices, a starting cornerstone pick, cornerstones that only the Citadel can
 * admit to the pool) rather than adding raw power.
 */

export type MetaBranch = 'provisions' | 'charters' | 'knowledge' | 'crown'

export const META_BRANCHES: { id: MetaBranch; name: string; icon: string; blurb: string }[] = [
  {
    id: 'provisions',
    name: 'Provisions',
    icon: '📦',
    blurb: 'What the wagons carry out of the Citadel.',
  },
  {
    id: 'charters',
    name: 'Charters',
    icon: '📜',
    blurb: 'Who may settle, and what they may build.',
  },
  {
    id: 'knowledge',
    name: 'Knowledge',
    icon: '📚',
    blurb: 'Archives that widen every draft and every decision.',
  },
  {
    id: 'crown',
    name: 'Crown',
    icon: '👑',
    blurb: "The Queen's own favours and writs.",
  },
]

/** Everything an upgrade can change. All fields stack additively. */
export interface MetaUpgradeEffects {
  /** Added to the starting stockpile. */
  startStock?: ResourceBag
  /** Extra starting villagers. */
  startVillagers?: number
  /** Extra picks in the opening blueprint draft. */
  openingPicks?: number
  /** Blueprints unlocked from the first moment of every run. */
  startBlueprints?: string[]
  /** Extra options in every blueprint draft. */
  blueprintOptions?: number
  /** Extra options in every cornerstone draft. */
  cornerstoneOptions?: number
  /** Draft rerolls per run that cost no amber. */
  freeRerolls?: number
  /** Cornerstones laid before the first tick. */
  startCornerstones?: string[]
  /** The run opens with a cornerstone draft as well as blueprints. */
  startCornerstoneChoice?: boolean
  /** Citadel-locked cornerstones admitted to the draft pool. */
  unlockCornerstones?: string[]
  /** Extra options appended to every glade event (`CITADEL_EVENT_OPTIONS`). */
  eventOptions?: string[]
  /** Extra room in the Queen's patience. */
  maxImpatience?: number
  /** Run-long modifiers, shown in the run as a "Citadel provisions" effect. */
  ongoing?: CornerstoneEffect[]
  /** Citadel-locked map modifiers admitted to the land's draw pool. */
  unlockModifiers?: string[]
  /** Re-rolls of the land's modifiers allowed on the setup screen. */
  landRerolls?: number
  /** One map modifier may be chosen on the setup screen. */
  chooseModifier?: boolean
  /** The Inspector names the events waiting in the first ring of glades. */
  scoutReport?: boolean
  /** Extra perks offered by the Queen's mid-run charter. */
  charterOptions?: number
  /** Cosmetic hearth flame (id in `HEARTH_STYLES`). */
  hearthStyle?: string
}

/** Cosmetic hearth flames. `ember` is the plain fire every run has. */
export const HEARTH_STYLES: Record<string, { name: string; flame: string; light: string }> = {
  ember: { name: 'Ember', flame: '#ff8a3d', light: '#ffab52' },
  sapphire: { name: 'Sapphire', flame: '#4fb4ff', light: '#8fd3ff' },
}

export interface MetaUpgradeDef {
  id: string
  name: string
  icon: string
  cost: number
  branch: MetaBranch
  /** Upgrades that must all be owned before this one can be bought. */
  requires?: string[]
  description: string
  /** Species this upgrade adds to the draw pool. */
  unlocksSpecies?: SpeciesId
  effects?: MetaUpgradeEffects
}

/*
 * Ids are what saves hold: never rename one. The first five ids (deeperStores, travelRations, unlockHarpy, unlockFox,
 * citadelBlessing) predate the tree and must never be renamed — they are what
 * v1 saves hold.
 */
const defs: MetaUpgradeDef[] = [
  // ---- Provisions ----------------------------------------------------------
  {
    id: 'deeperStores',
    name: 'Deeper Stores',
    icon: '🪵',
    cost: 3,
    branch: 'provisions',
    description: 'Every settlement starts with 20 extra wood.',
    effects: { startStock: { wood: 20 } },
  },
  {
    id: 'travelRations',
    name: 'Travel Rations',
    icon: '🍪',
    cost: 4,
    branch: 'provisions',
    requires: ['deeperStores'],
    description: 'Start each run with 15 biscuits — enough to survive a slow opening.',
    effects: { startStock: { biscuit: 15 } },
  },
  {
    id: 'amberPurse',
    name: 'Amber Purse',
    icon: '💰',
    cost: 6,
    branch: 'provisions',
    requires: ['deeperStores'],
    description: 'Start with 25 extra amber — a reroll, a rush, or an early trade.',
    effects: { startStock: { amber: 25 } },
  },
  {
    id: 'secondWagon',
    name: 'Second Wagon',
    icon: '🛒',
    cost: 9,
    branch: 'provisions',
    requires: ['travelRations'],
    description: 'Two more settlers ride along, with 12 planks to roof them.',
    effects: { startVillagers: 2, startStock: { plank: 12 } },
  },

  // ---- Charters ------------------------------------------------------------
  {
    id: 'unlockHarpy',
    name: 'Harpy Charter',
    icon: '🦅',
    cost: 5,
    branch: 'charters',
    description: 'Harpies may be drawn as settlers. Excellent scholars and foragers.',
    unlocksSpecies: 'harpy',
  },
  {
    id: 'unlockFox',
    name: 'Fox Charter',
    icon: '🦊',
    cost: 5,
    branch: 'charters',
    description: 'Foxes may be drawn as settlers. Fine cooks, keen foragers.',
    unlocksSpecies: 'fox',
  },
  {
    id: 'merchantCharter',
    name: 'Merchant Charter',
    icon: '⚖️',
    cost: 6,
    branch: 'charters',
    requires: ['unlockFox'],
    description: 'The Trading Post blueprint is yours from the start of every run.',
    effects: { startBlueprints: ['tradingPost'] },
  },
  {
    id: 'openRoads',
    name: 'Open Roads',
    icon: '🛤️',
    cost: 7,
    branch: 'charters',
    requires: ['unlockHarpy'],
    description: 'Word travels the Citadel roads: newcomers arrive 15% sooner.',
    effects: { ongoing: [{ kind: 'newcomerRate', percent: -15 }] },
  },
  {
    id: 'charterOffice',
    name: 'Charter Office',
    icon: '🗂️',
    cost: 6,
    branch: 'charters',
    requires: ['merchantCharter'],
    description: "Clerks draft a spare: the Queen's mid-run charter offers one more perk to choose from.",
    effects: { charterOptions: 1 },
  },
  {
    id: 'frontierCharter',
    name: 'Frontier Charter',
    icon: '🐺',
    cost: 7,
    branch: 'charters',
    requires: ['openRoads'],
    description: 'Settlers may be sent past the last road: the Wild Frontier joins the pool of lands a map can draw.',
    effects: { unlockModifiers: ['wildFrontier'] },
  },

  // ---- Knowledge -----------------------------------------------------------
  {
    id: 'surveyorsNotes',
    name: "Surveyor's Notes",
    icon: '🗺️',
    cost: 4,
    branch: 'knowledge',
    description: 'The opening blueprint draft has one more pick.',
    effects: { openingPicks: 1 },
  },
  {
    id: 'secondThoughts',
    name: 'Second Thoughts',
    icon: '🎲',
    cost: 5,
    branch: 'knowledge',
    requires: ['surveyorsNotes'],
    description: 'Your first draft reroll in every run costs no amber.',
    effects: { freeRerolls: 1 },
  },
  {
    id: 'broaderArchives',
    name: 'Broader Archives',
    icon: '📐',
    cost: 8,
    branch: 'knowledge',
    requires: ['surveyorsNotes'],
    description: 'Every blueprint draft offers one more option.',
    effects: { blueprintOptions: 1 },
  },
  {
    id: 'forestLore',
    name: 'Forest Lore',
    icon: '🍄',
    cost: 6,
    branch: 'knowledge',
    requires: ['secondThoughts'],
    description:
      'Every glade event gains a "Study the signs" option: +1 reputation, at the cost of 6 hostility.',
    effects: { eventOptions: ['studySigns'] },
  },
  {
    id: 'masonsArchive',
    name: "Masons' Archive",
    icon: '🏛️',
    cost: 8,
    branch: 'knowledge',
    requires: ['broaderArchives'],
    description:
      'Admits two Citadel cornerstones to the draft pool: Citadel Masons and Wayfarer’s Ledger.',
    effects: { unlockCornerstones: ['citadelMasons', 'wayfarersLedger'] },
  },
  {
    id: 'scoutsReport',
    name: "Scouts' Report",
    icon: '🔍',
    cost: 5,
    branch: 'knowledge',
    requires: ['surveyorsNotes'],
    description:
      'Scouts walk the first ring of glades before you arrive: the Inspector names the event waiting in each one.',
    effects: { scoutReport: true },
  },
  {
    id: 'unchartedLands',
    name: 'Uncharted Lands',
    icon: '🧭',
    cost: 6,
    branch: 'knowledge',
    requires: ['surveyorsNotes'],
    description: 'Two new lands join the pool a map can draw: Amber Springs and the Pilgrim Road.',
    effects: { unlockModifiers: ['amberSprings', 'pilgrimRoad'] },
  },
  {
    id: 'secondSurvey',
    name: 'Second Survey',
    icon: '🔭',
    cost: 5,
    branch: 'knowledge',
    requires: ['unchartedLands'],
    description: "Don't like the lay of the land? Re-roll a map's modifiers once on the setup screen.",
    effects: { landRerolls: 1 },
  },

  // ---- Crown ---------------------------------------------------------------
  {
    id: 'citadelBlessing',
    name: "Citadel's Blessing",
    icon: '🕯️',
    cost: 8,
    branch: 'crown',
    description: 'Begin every run with the Campfire Tales cornerstone (+2 resolve to all).',
    effects: { startCornerstones: ['campfireTales'] },
  },
  {
    id: 'wardensWrit',
    name: "Wardens' Writ",
    icon: '🛡️',
    cost: 5,
    branch: 'crown',
    description:
      'Every glade event gains a "Call the wardens" option: pay 25 amber to settle it quietly (−4 hostility).',
    effects: { eventOptions: ['callWardens'] },
  },
  {
    id: 'viceroysSignet',
    name: "Viceroy's Signet",
    icon: '💍',
    cost: 10,
    branch: 'crown',
    requires: ['citadelBlessing'],
    description: 'Every run opens with a second cornerstone draft: lay two cornerstones before the first tick.',
    effects: { startCornerstoneChoice: true },
  },
  {
    id: 'queensEar',
    name: "Queen's Ear",
    icon: '👂',
    cost: 9,
    branch: 'crown',
    requires: ['wardensWrit'],
    description: "A friend at court: the Queen's patience holds 2 more points.",
    effects: { maxImpatience: 2 },
  },
  {
    id: 'royalArchive',
    name: 'Royal Archive',
    icon: '📖',
    cost: 12,
    branch: 'crown',
    requires: ['viceroysSignet', 'masonsArchive'],
    description:
      'Cornerstone drafts offer one more option, and Royal Mandate and Stormwardens join the pool.',
    effects: {
      cornerstoneOptions: 1,
      unlockCornerstones: ['royalMandate', 'stormwardens'],
    },
  },
  {
    id: 'gildedHearth',
    name: 'Gilded Hearth',
    icon: '💠',
    cost: 3,
    branch: 'crown',
    description: 'Cosmetic: a royal gift of salts makes every hearth burn with a sapphire flame.',
    effects: { hearthStyle: 'sapphire' },
  },
  {
    id: 'chosenGround',
    name: 'Chosen Ground',
    icon: '📌',
    cost: 10,
    branch: 'crown',
    requires: ['queensEar', 'secondSurvey'],
    description:
      'The Queen lets you pick the site: choose one map modifier on the setup screen, and the seed fills in the rest.',
    effects: { chooseModifier: true },
  },
]

export const META_UPGRADES: Record<string, MetaUpgradeDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
)

export const META_UPGRADE_LIST = defs

/**
 * Glade-event options the Citadel can add to every event. They are appended
 * after an event's own options, so the indices of the originals never move and
 * the "last original option is always free" invariant still holds.
 */
export const CITADEL_EVENT_OPTIONS: Record<string, GladeEventOptionDef> = {
  callWardens: {
    label: 'Call the wardens',
    description: 'Citadel wardens settle the matter quietly — for a fee.',
    requires: { amber: 25 },
    cost: { amber: 25 },
    hostility: -4,
  },
  studySigns: {
    label: 'Study the signs',
    description: 'Your scholars read the glade and send their notes to the Queen.',
    reputation: 1,
    hostility: 6,
  },
}

// ---------------------------------------------------------------------------
// Upgrade purchase rules
// ---------------------------------------------------------------------------

export type UpgradeStatus = 'owned' | 'available' | 'poor' | 'locked'

/** Prerequisites of `id` the player does not own yet. */
export function missingPrerequisites(meta: MetaState, id: string): string[] {
  const def = META_UPGRADES[id]
  if (!def) return []
  return (def.requires ?? []).filter((req) => !meta.upgrades.includes(req))
}

export function upgradeStatus(meta: MetaState, id: string): UpgradeStatus {
  const def = META_UPGRADES[id]
  if (meta.upgrades.includes(id)) return 'owned'
  if (!def || missingPrerequisites(meta, id).length > 0) return 'locked'
  return meta.citadelSupplies >= def.cost ? 'available' : 'poor'
}

/**
 * Buys an upgrade. Returns the next meta state, or an error string the UI can
 * show. Never mutates `meta`.
 */
export function purchaseUpgrade(
  meta: MetaState,
  id: string,
): { meta: MetaState; error: null } | { meta: null; error: string } {
  const def = META_UPGRADES[id]
  if (!def) return { meta: null, error: 'No such upgrade.' }
  if (meta.upgrades.includes(id)) return { meta: null, error: 'Already unlocked.' }
  const missing = missingPrerequisites(meta, id)
  if (missing.length > 0) {
    const names = missing.map((m) => META_UPGRADES[m]?.name ?? m).join(' and ')
    return { meta: null, error: `Requires ${names} first.` }
  }
  if (meta.citadelSupplies < def.cost) {
    return { meta: null, error: 'Not enough Citadel supplies.' }
  }
  return {
    error: null,
    meta: {
      ...meta,
      citadelSupplies: meta.citadelSupplies - def.cost,
      upgrades: [...meta.upgrades, id],
      unlockedSpecies: def.unlocksSpecies
        ? [...new Set([...meta.unlockedSpecies, def.unlocksSpecies])]
        : meta.unlockedSpecies,
    },
  }
}

// ---------------------------------------------------------------------------
// Folding owned upgrades into run-start parameters
// ---------------------------------------------------------------------------

export interface CitadelLoadout {
  startStock: ResourceBag
  startVillagers: number
  openingPicks: number
  startBlueprints: string[]
  startCornerstones: string[]
  startCornerstoneChoice: boolean
  maxImpatience: number
  ongoing: CornerstoneEffect[]
  /** Citadel-locked map modifiers admitted to the draw pool. */
  unlockModifiers: string[]
  landRerolls: number
  chooseModifier: boolean
  /** The part that keeps acting during the run; stored on `RunState`. */
  perks: CitadelPerks
}

export function emptyCitadelPerks(): CitadelPerks {
  return {
    blueprintOptions: 0,
    cornerstoneOptions: 0,
    freeRerolls: 0,
    cornerstones: [],
    eventOptions: [],
  }
}

/** Sums the effects of every owned upgrade. Unknown ids are ignored. */
export function citadelLoadout(upgrades: readonly string[]): CitadelLoadout {
  const out: CitadelLoadout = {
    startStock: {},
    startVillagers: 0,
    openingPicks: 0,
    startBlueprints: [],
    startCornerstones: [],
    startCornerstoneChoice: false,
    maxImpatience: 0,
    ongoing: [],
    unlockModifiers: [],
    landRerolls: 0,
    chooseModifier: false,
    perks: emptyCitadelPerks(),
  }
  const addUnique = (list: string[], ids: string[] | undefined) => {
    for (const id of ids ?? []) if (!list.includes(id)) list.push(id)
  }
  // Iterate in definition order so the result does not depend on purchase order.
  for (const def of defs) {
    if (!upgrades.includes(def.id) || !def.effects) continue
    const e = def.effects
    for (const [res, amount] of Object.entries(e.startStock ?? {})) {
      const key = res as keyof ResourceBag
      out.startStock[key] = (out.startStock[key] ?? 0) + (amount ?? 0)
    }
    out.startVillagers += e.startVillagers ?? 0
    out.openingPicks += e.openingPicks ?? 0
    addUnique(out.startBlueprints, e.startBlueprints)
    addUnique(out.startCornerstones, e.startCornerstones)
    if (e.startCornerstoneChoice) out.startCornerstoneChoice = true
    out.maxImpatience += e.maxImpatience ?? 0
    out.ongoing.push(...(e.ongoing ?? []))
    out.perks.blueprintOptions += e.blueprintOptions ?? 0
    out.perks.cornerstoneOptions += e.cornerstoneOptions ?? 0
    out.perks.freeRerolls += e.freeRerolls ?? 0
    addUnique(out.perks.cornerstones, e.unlockCornerstones)
    addUnique(out.perks.eventOptions, e.eventOptions)
    addUnique(out.unlockModifiers, e.unlockModifiers)
    out.landRerolls += e.landRerolls ?? 0
    if (e.chooseModifier) out.chooseModifier = true
    // In-run perks are only set when owned, so a run without them is unchanged.
    if (e.scoutReport) out.perks.scoutReport = true
    if (e.charterOptions) out.perks.charterOptions = (out.perks.charterOptions ?? 0) + e.charterOptions
    if (e.hearthStyle) out.perks.hearthStyle = e.hearthStyle
  }
  return out
}

// ---------------------------------------------------------------------------
// Queen's Edicts — the difficulty ladder
// ---------------------------------------------------------------------------

export interface EdictDef {
  /** 1-based; edict N is active at every difficulty level >= N. */
  level: number
  name: string
  icon: string
  description: string
  /** Run-long modifiers, folded into one "Queen's Edict" ongoing effect. */
  effects?: CornerstoneEffect[]
  /** Percent change to the starting stockpile (negative = less). */
  startStockPercent?: number
  startVillagers?: number
  maxImpatience?: number
  maxReputation?: number
}

/**
 * Each level adds its edict on top of all the ones below it. Winning at a
 * level unlocks the next.
 */
export const EDICTS: EdictDef[] = [
  {
    level: 1,
    name: 'Impatient Court',
    icon: '⏳',
    description: "The Queen's impatience grows 15% faster.",
    effects: [{ kind: 'impatienceRate', percent: 15 }],
  },
  {
    level: 2,
    name: 'Lean Provisions',
    icon: '🥖',
    description: 'The starting stockpile is 30% smaller.',
    startStockPercent: -30,
  },
  {
    level: 3,
    name: 'Restless Forest',
    icon: '🌲',
    description: 'Hostility rises 12% faster and clearing a glade angers the forest 15% more.',
    effects: [
      { kind: 'hostilityRate', percent: 12 },
      { kind: 'gladeHostility', percent: 15 },
    ],
  },
  {
    level: 4,
    name: 'Bitter Storms',
    icon: '⛈️',
    description: 'The hearth burns 30% more wood and every species loses 2 resolve in the Storm.',
    effects: [
      { kind: 'hearthFuel', percent: 30 },
      { kind: 'stormResolve', amount: -2 },
    ],
  },
  {
    level: 5,
    name: 'Short Leash',
    icon: '🔗',
    description: "The Queen's patience holds 3 fewer points.",
    maxImpatience: -3,
  },
  {
    level: 6,
    name: 'Thin Ranks',
    icon: '🚶',
    description: 'One fewer starting villager, and newcomers arrive 20% later.',
    startVillagers: -1,
    effects: [{ kind: 'newcomerRate', percent: 20 }],
  },
  {
    level: 7,
    name: 'Exacting Crown',
    icon: '📜',
    description: 'Victory demands 3 more reputation.',
    maxReputation: 3,
  },
]

export const MAX_EDICT = EDICTS.length

/** Supply payout bonus per edict level (0.25 = +25% per level). */
export const EDICT_REWARD_STEP = 0.25

export function clampEdict(level: number | undefined): number {
  if (typeof level !== 'number' || !Number.isFinite(level)) return 0
  return Math.max(0, Math.min(MAX_EDICT, Math.floor(level)))
}

/** Roman numerals for the ladder's labels. */
export function edictNumeral(level: number): string {
  const numerals = ['—', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']
  return numerals[level] ?? String(level)
}

export function edictLabel(level: number): string {
  return level <= 0 ? 'No edict' : `Edict ${edictNumeral(level)}`
}

export interface EdictModifiers {
  level: number
  effects: CornerstoneEffect[]
  /** Multiplier on every starting stock amount. */
  stockFactor: number
  startVillagers: number
  maxImpatience: number
  maxReputation: number
  /** Multiplier on the supply payout. */
  rewardMultiplier: number
}

/** Folds every edict up to `level` into one set of run-start modifiers. */
export function edictModifiers(level: number | undefined): EdictModifiers {
  const lvl = clampEdict(level)
  const out: EdictModifiers = {
    level: lvl,
    effects: [],
    stockFactor: 1,
    startVillagers: 0,
    maxImpatience: 0,
    maxReputation: 0,
    rewardMultiplier: 1 + EDICT_REWARD_STEP * lvl,
  }
  for (const d of EDICTS) {
    if (d.level > lvl) continue
    out.effects.push(...(d.effects ?? []))
    out.stockFactor *= 1 + (d.startStockPercent ?? 0) / 100
    out.startVillagers += d.startVillagers ?? 0
    out.maxImpatience += d.maxImpatience ?? 0
    out.maxReputation += d.maxReputation ?? 0
  }
  return out
}

// ---------------------------------------------------------------------------
// Meta state, migration
// ---------------------------------------------------------------------------

/**
 * v1: five flat upgrades, no edicts.
 * v2: upgrade tree with prerequisites, Queen's Edicts, richer history.
 * v3: achievements, the daily expedition ledger, and a worn title.
 */
export const META_VERSION = 3

/** History entries kept in the save; the Citadel shows the newest ten. */
export const HISTORY_LIMIT = 20

export function defaultMeta(): MetaState {
  return {
    version: META_VERSION,
    citadelSupplies: 0,
    runsWon: 0,
    runsLost: 0,
    unlockedSpecies: [],
    upgrades: [],
    edictUnlocked: 0,
    history: [],
    achievements: emptyAchievementState(),
    daily: emptyDailyLedger(),
    title: null,
  }
}

const SPECIES_IDS: readonly SpeciesId[] = ['human', 'beaver', 'lizard', 'harpy', 'fox']

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function migrateHistoryEntry(raw: unknown): MetaHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  if (typeof e.seed !== 'number') return null
  const entry: MetaHistoryEntry = {
    seed: e.seed,
    won: e.won === true,
    years: num(e.years, 1),
    reputation: num(e.reputation),
    at: num(e.at),
  }
  if (Array.isArray(e.species)) {
    entry.species = e.species.filter((s): s is SpeciesId =>
      SPECIES_IDS.includes(s as SpeciesId),
    )
  }
  if (typeof e.edict === 'number') entry.edict = clampEdict(e.edict)
  if (typeof e.supplies === 'number') entry.supplies = e.supplies
  if (Array.isArray(e.modifiers)) {
    entry.modifiers = e.modifiers.filter((m): m is string => typeof m === 'string')
  }
  if (isDateKey(e.daily)) entry.daily = e.daily
  return entry
}

/**
 * Upgrades any stored meta save to the current shape without losing supplies,
 * upgrades, or history. Tolerates partial and corrupt data field by field
 * rather than discarding the whole save.
 */
export function migrateMeta(raw: unknown): MetaState {
  if (!raw || typeof raw !== 'object') return defaultMeta()
  const m = raw as Record<string, unknown>

  const upgrades = Array.isArray(m.upgrades)
    ? [...new Set(m.upgrades.filter((u): u is string => typeof u === 'string'))]
    : []
  const storedSpecies = Array.isArray(m.unlockedSpecies)
    ? m.unlockedSpecies.filter((s): s is SpeciesId => SPECIES_IDS.includes(s as SpeciesId))
    : []
  // Charters are the source of truth for species; re-derive in case they drifted.
  const charterSpecies = upgrades
    .map((id) => META_UPGRADES[id]?.unlocksSpecies)
    .filter((s): s is SpeciesId => !!s)
  const history = (Array.isArray(m.history) ? m.history : [])
    .map(migrateHistoryEntry)
    .filter((e): e is MetaHistoryEntry => e !== null)
    .slice(0, HISTORY_LIMIT)

  // Every win in the ledger proves the edict above it was earned; pre-v2 wins
  // count as wins at level 0. Daily expeditions are played under a fixed
  // edict and prove nothing about the ladder.
  const earned = history
    .filter((e) => e.won && !e.daily)
    .reduce((best, e) => Math.max(best, (e.edict ?? 0) + 1), 0)
  // Only pre-v2 saves need this: since v2 every win is in the ledger with its
  // edict (and a daily win, under a fixed edict, must not count).
  const v1Wins = num(m.version, 1) < 2 && num(m.runsWon) > 0 ? 1 : 0

  const runsWon = Math.max(0, num(m.runsWon))
  const runsLost = Math.max(0, num(m.runsLost))
  const title = typeof m.title === 'string' && isAchievementTitle(m.title) ? m.title : null
  return {
    version: META_VERSION,
    citadelSupplies: Math.max(0, num(m.citadelSupplies)),
    runsWon,
    runsLost,
    unlockedSpecies: [...new Set([...storedSpecies, ...charterSpecies])],
    upgrades,
    edictUnlocked: clampEdict(Math.max(num(m.edictUnlocked), earned, v1Wins)),
    history,
    // Saves from before v3 have no achievements: credit what the ledger proves.
    achievements:
      m.achievements === undefined
        ? backfillAchievements({ runsWon, runsLost, history })
        : migrateAchievementState(m.achievements),
    daily: migrateDailyLedger(m.daily),
    title,
  }
}

// ---------------------------------------------------------------------------
// Run rewards
// ---------------------------------------------------------------------------

export interface RewardLine {
  label: string
  amount: number
}

export interface RewardBreakdown {
  lines: RewardLine[]
  /** Sum of `lines`, before the edict bonus. */
  subtotal: number
  edict: number
  edictBonus: number
  total: number
}

/**
 * Supplies awarded when a run ends. A loss that reached the late game pays
 * roughly half of a win, so every serious attempt moves the Citadel forward;
 * higher edicts multiply the whole payout.
 */
export function supplyBreakdown(run: RunState): RewardBreakdown {
  const won = run.phase === 'won'
  const lines: RewardLine[] = [
    { label: won ? 'Settlement held' : 'Settlement founded', amount: won ? 8 : 2 },
    { label: 'Reputation earned', amount: Math.floor(run.reputation / 2) },
    { label: 'Glades reclaimed', amount: Math.floor(run.stats.gladesCleared / 2) },
    { label: 'Orders fulfilled', amount: Math.floor(run.stats.ordersCompleted / 2) },
    { label: 'Years endured', amount: Math.min(5, Math.max(0, run.season.year - 1)) },
  ]
  const subtotal = lines.reduce((sum, l) => sum + l.amount, 0)
  const edict = clampEdict(run.edict)
  const edictBonus = Math.round(subtotal * EDICT_REWARD_STEP * edict)
  return { lines, subtotal, edict, edictBonus, total: subtotal + edictBonus }
}

export function supplyReward(run: RunState): number {
  return supplyBreakdown(run).total
}

/**
 * Banks a finished run: pays out supplies, records it in the ledger, and
 * unlocks the next edict on a win at the highest one available.
 */
export function bankRun(meta: MetaState, run: RunState, now = Date.now()): MetaState {
  const won = run.phase === 'won'
  const reward = supplyReward(run)
  const edict = clampEdict(run.edict)
  const entry: MetaHistoryEntry = {
    seed: run.seed,
    won,
    years: run.season.year,
    reputation: run.reputation,
    at: now,
    species: [...run.speciesPool],
    edict,
    supplies: reward,
    modifiers: [...(run.runModifiers ?? [])],
  }
  if (run.daily) entry.daily = run.daily
  return {
    ...meta,
    citadelSupplies: meta.citadelSupplies + reward,
    runsWon: meta.runsWon + (won ? 1 : 0),
    runsLost: meta.runsLost + (run.phase === 'lost' ? 1 : 0),
    // A daily's edict is fixed for fairness, so winning one climbs no rung.
    edictUnlocked:
      won && !run.daily
        ? Math.max(meta.edictUnlocked, clampEdict(edict + 1))
        : meta.edictUnlocked,
    history: [entry, ...meta.history].slice(0, HISTORY_LIMIT),
  }
}
