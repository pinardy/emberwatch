import type { CornerstoneEffect, GladeEventOptionDef, ResourceBag, SpeciesId } from '../types'

/**
 * Between-run progression: the Citadel's upgrade tree and the Queen's Edicts.
 *
 * Upgrades are data, like cornerstones: each declares what it changes and
 * `citadelLoadout` (engine/meta.ts) folds the owned set into one summary that
 * `createRun` reads.
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

// ---------------------------------------------------------------------------
// What style achievements open in the Citadel
// ---------------------------------------------------------------------------

/**
 * A style achievement's Citadel unlock: a Citadel-locked cornerstone admitted
 * to every draft, an upgrade whose prerequisites are waived (it can be bought
 * early), or a commission put on the board before the upgrade that opens it.
 */
export interface AchievementUnlock {
  cornerstone?: string
  upgrade?: string
  commission?: string
}

/**
 * Achievement id → what earning it opens. Data only, read by
 * `achievementUnlocks` (the loadout, the upgrade rules, the commission board)
 * and shown on the achievements screen and in the Citadel. Earned
 * achievements are what saves hold, so these follow an old save's progress.
 */
export const ACHIEVEMENT_UNLOCKS: Record<string, AchievementUnlock> = {
  lightFootprint: { cornerstone: 'tendedGrounds' },
  ownCounsel: { upgrade: 'masonsArchive' },
  vowKept: { upgrade: 'queensEar' },
  refinedTastes: { cornerstone: 'connoisseurs' },
  warmWinters: { cornerstone: 'hearthkeepers' },
  termsHonoured: { commission: 'royalWorks' },
  beforeThirdStorm: { cornerstone: 'forcedMarch' },
}

export interface AchievementOpenings {
  cornerstones: string[]
  upgrades: string[]
  commissions: string[]
}

/** Everything the earned achievements in `unlocked` (id → when) open. */
export function achievementUnlocks(
  unlocked: Readonly<Record<string, number>> | undefined,
): AchievementOpenings {
  const out: AchievementOpenings = { cornerstones: [], upgrades: [], commissions: [] }
  for (const [id, unlock] of Object.entries(ACHIEVEMENT_UNLOCKS)) {
    if (unlocked?.[id] === undefined) continue
    if (unlock.cornerstone) out.cornerstones.push(unlock.cornerstone)
    if (unlock.upgrade) out.upgrades.push(unlock.upgrade)
    if (unlock.commission) out.commissions.push(unlock.commission)
  }
  return out
}

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
