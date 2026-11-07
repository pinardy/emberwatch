import {
  backfillAchievements,
  emptyAchievementState,
  isAchievementTitle,
  migrateAchievementState,
} from '../content/achievements'
import { COMMISSIONS, judgeCommission } from '../content/commissions'
import { emptyDailyLedger, isDateKey, migrateDailyLedger } from '../content/daily'
import { EDICTS, EDICT_REWARD_STEP, MAX_EDICT, META_UPGRADES, META_UPGRADE_LIST } from '../content/meta'
import type {
  CitadelPerks,
  CornerstoneEffect,
  MetaHistoryEntry,
  MetaState,
  ResourceBag,
  RunState,
  SpeciesId,
} from '../types'

/**
 * Between-run progression rules over the data in content/meta.ts: buying
 * Citadel upgrades, folding the owned set into run-start parameters, the
 * Queen's Edicts as modifiers, the meta save's shape and migration, and
 * the supplies a finished run banks.
 */

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
  for (const def of META_UPGRADE_LIST) {
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
  const c = e.commission as Record<string, unknown> | null | undefined
  if (c && typeof c === 'object' && typeof c.id === 'string' && COMMISSIONS[c.id]) {
    entry.commission = { id: c.id, met: c.met === true }
  }
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
  /**
   * The run's commission, whether it was met, and the supplies it added (a
   * line in `lines` when met). Absent for a run without one.
   */
  commission?: { id: string; met: boolean; bonus: number }
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
  // A met commission pays a share of the run's own payout on top; the edict
  // then multiplies both, so "double supplies" stays double under any edict.
  const verdict = judgeCommission(run)
  let commission: RewardBreakdown['commission']
  if (verdict) {
    const base = lines.reduce((sum, l) => sum + l.amount, 0)
    const bonus = verdict.met ? Math.round((base * verdict.def.bonusPercent) / 100) : 0
    commission = { id: verdict.def.id, met: verdict.met, bonus }
    if (verdict.met) {
      lines.push({
        label: `Commission met: ${verdict.def.name} (+${verdict.def.bonusPercent}%)`,
        amount: bonus,
      })
    }
  }
  const subtotal = lines.reduce((sum, l) => sum + l.amount, 0)
  const edict = clampEdict(run.edict)
  const edictBonus = Math.round(subtotal * EDICT_REWARD_STEP * edict)
  const out: RewardBreakdown = { lines, subtotal, edict, edictBonus, total: subtotal + edictBonus }
  if (commission) out.commission = commission
  return out
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
  const breakdown = supplyBreakdown(run)
  const reward = breakdown.total
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
  if (breakdown.commission) {
    entry.commission = { id: breakdown.commission.id, met: breakdown.commission.met }
  }
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
