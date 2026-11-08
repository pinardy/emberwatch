import type { AchievementState, MetaHistoryEntry, RunFeats, RunState, SpeciesId } from '../types'
import { BUILDINGS } from './buildings'
import { judgeCommission } from './commissions'
import { ACHIEVEMENT_UNLOCKS, type AchievementUnlock } from './meta'

/**
 * Local achievements: data, like cornerstones. Each is judged once, when a
 * finished run is banked, from the run's end state plus the few counters the
 * run keeps as it goes (`RunState.feats`). Nothing here runs per tick.
 *
 * Two shapes:
 *  - `when` — earned by a single run that satisfies the predicate;
 *  - `progress` — earned across runs: a running total (`sum`), a best value
 *    (`max`), or a set of distinct keys (`distinct`) that must reach `target`.
 *
 * A few pay a modest Citadel reward or a cosmetic title. The style
 * achievements reward how a run was won rather than how far it got, and each
 * opens something in the Citadel (`ACHIEVEMENT_UNLOCKS` in content/meta.ts).
 *
 * This module never imports `engine/meta.ts` (which imports it).
 */

export type AchievementTier = 'early' | 'mid' | 'late' | 'style'

export const ACHIEVEMENT_TIERS: { id: AchievementTier; name: string; blurb: string }[] = [
  { id: 'early', name: 'First steps', blurb: 'Things every viceroy does in the first few runs.' },
  { id: 'mid', name: 'Proven viceroy', blurb: 'Harder terms, cleaner wins, wider travels.' },
  { id: 'late', name: 'Legend of the Citadel', blurb: 'The top of the ladder.' },
  {
    id: 'style',
    name: 'Styles of rule',
    blurb: 'Not how far, but how: each opens a cornerstone, an upgrade or a commission in the Citadel.',
  },
]

/** What a banked run is judged with beyond the run itself. */
export interface AchievementContext {
  /** Consecutive days of dailies once this run is recorded (0 when not a daily). */
  dailyStreak: number
}

type RunCheck = (run: RunState, ctx: AchievementContext) => boolean

export interface AchievementProgress {
  target: number
  mode: 'sum' | 'max' | 'distinct'
  /** This run's contribution: a number (`sum`/`max`) or keys (`distinct`); null for none. */
  value: (run: RunState, ctx: AchievementContext) => number | string[] | null
  /** How the counter reads in the UI, e.g. "glades". */
  unit: string
}

export interface AchievementReward {
  /** Citadel supplies paid once, when earned. */
  supplies?: number
  /** A cosmetic title the player may wear. */
  title?: string
}

/** What an achievement opens in the Citadel, if anything (`ACHIEVEMENT_UNLOCKS`). */
export function achievementUnlockOf(id: string): AchievementUnlock | undefined {
  return ACHIEVEMENT_UNLOCKS[id]
}

export interface AchievementDef {
  id: string
  name: string
  icon: string
  description: string
  tier: AchievementTier
  /** Single-run achievement. */
  when?: RunCheck
  /** Multi-run achievement. */
  progress?: AchievementProgress
  reward?: AchievementReward
}

// ---------------------------------------------------------------------------
// Reads of a finished run
// ---------------------------------------------------------------------------

export function defaultFeats(): RunFeats {
  return { hearthWentCold: false, decreesMet: 0, threatsAppeased: 0 }
}

const featsOf = (run: RunState): RunFeats => ({ ...defaultFeats(), ...(run.feats ?? {}) })
const won = (run: RunState) => run.phase === 'won'
const edictOf = (run: RunState) => run.edict ?? 0
const minutesOf = (run: RunState) => run.clock / 60

/** Distinct service needs with a finished hall standing at the end. */
export function serviceNeedsBuilt(run: RunState): number {
  const needs = new Set<string>()
  for (const b of Object.values(run.buildings)) {
    const need = b.built ? BUILDINGS[b.defId]?.service?.need : undefined
    if (need) needs.add(need)
  }
  return needs.size
}

/** Every service need any building can meet (six today). */
export const ALL_SERVICE_NEEDS = new Set(
  Object.values(BUILDINGS)
    .map((d) => d.service?.need)
    .filter((n): n is NonNullable<typeof n> => !!n),
).size

/** Finished buildings standing at (at least) upgrade tier `tier`. */
export function buildingsAtTier(run: RunState, tier: number): number {
  return Object.values(run.buildings).filter((b) => b.built && (b.tier ?? 0) >= tier).length
}

/** A species trio as an order-free key, or null for a settlement of fewer. */
export function trioKey(species: readonly SpeciesId[]): string | null {
  const unique = [...new Set(species)]
  return unique.length === 3 ? [...unique].sort().join('+') : null
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

const defs: AchievementDef[] = [
  // ---- early ---------------------------------------------------------------
  {
    id: 'firstEmbers',
    name: 'First Embers',
    icon: '🌱',
    tier: 'early',
    description: 'Finish your first settlement, won or lost.',
    when: () => true,
    reward: { supplies: 2 },
  },
  {
    id: 'firstWin',
    name: 'Held for the Queen',
    icon: '👑',
    tier: 'early',
    description: 'Win a run.',
    when: won,
    reward: { supplies: 3 },
  },
  {
    id: 'intoTheWoods',
    name: 'Into the Woods',
    icon: '🌿',
    tier: 'early',
    description: 'Clear 6 glades in one run.',
    when: (r) => r.stats.gladesCleared >= 6,
  },
  {
    id: 'byRoyalDecree',
    name: 'By Royal Decree',
    icon: '📯',
    tier: 'early',
    description: 'Fulfil a royal decree before its deadline.',
    when: (r) => featsOf(r).decreesMet >= 1,
  },
  {
    id: 'paidInFull',
    name: 'Paid in Full',
    icon: '🪙',
    tier: 'early',
    description: 'Pay off a threat the forest unleashed.',
    when: (r) => featsOf(r).threatsAppeased >= 1,
  },
  {
    id: 'betterBuilt',
    name: 'Better Built',
    icon: '🔨',
    tier: 'early',
    description: 'End a run with at least one building raised an upgrade tier.',
    when: (r) => buildingsAtTier(r, 1) >= 1,
  },
  {
    id: 'dailyBread',
    name: 'Daily Bread',
    icon: '📅',
    tier: 'early',
    description: 'Finish a daily expedition.',
    when: (r) => !!r.daily,
  },

  // ---- mid -----------------------------------------------------------------
  {
    id: 'underEdict',
    name: 'Under Edict',
    icon: '📜',
    tier: 'mid',
    description: "Win under a Queen's Edict (Edict I or harsher).",
    when: (r) => won(r) && edictOf(r) >= 1,
  },
  {
    id: 'bitterTerms',
    name: 'Bitter Terms',
    icon: '⛈️',
    tier: 'mid',
    description: 'Win under Edict IV or harsher.',
    when: (r) => won(r) && edictOf(r) >= 4,
    reward: { supplies: 5 },
  },
  {
    id: 'noOneLeftBehind',
    name: 'No One Left Behind',
    icon: '🕊️',
    tier: 'mid',
    description: 'Win without losing a single villager.',
    when: (r) => won(r) && r.stats.villagersLost === 0,
    reward: { title: 'the Shepherd' },
  },
  {
    id: 'swiftCharter',
    name: 'Swift Charter',
    icon: '⚡',
    tier: 'mid',
    description: 'Win in under 25 minutes.',
    when: (r) => won(r) && minutesOf(r) < 25,
  },
  {
    id: 'keptTheFlame',
    name: 'Kept the Flame',
    icon: '🔥',
    tier: 'mid',
    description: 'Win having weathered at least one Storm without the hearth ever going cold.',
    when: (r) => won(r) && r.season.year >= 2 && !featsOf(r).hearthWentCold,
  },
  {
    id: 'cartographer',
    name: 'Cartographer',
    icon: '🗺️',
    tier: 'mid',
    description: 'Clear 12 glades in one run.',
    when: (r) => r.stats.gladesCleared >= 12,
    reward: { supplies: 3 },
  },
  {
    id: 'weathered',
    name: 'Weathered',
    icon: '🌀',
    tier: 'mid',
    description: 'Win on a map with Long Storms.',
    when: (r) => won(r) && (r.runModifiers ?? []).includes('longStorms'),
  },
  {
    id: 'fivePeoples',
    name: 'Five Peoples',
    icon: '🤝',
    tier: 'mid',
    description: 'Win with each of the five species among your settlers.',
    progress: {
      target: 5,
      mode: 'distinct',
      unit: 'species',
      value: (r) => (won(r) ? [...new Set(r.speciesPool)] : null),
    },
  },
  {
    id: 'seasonedViceroy',
    name: 'Seasoned Viceroy',
    icon: '🎖️',
    tier: 'mid',
    description: 'Finish 10 settlements, won or lost.',
    progress: { target: 10, mode: 'sum', unit: 'runs', value: () => 1 },
    reward: { supplies: 5 },
  },
  {
    id: 'forestTamer',
    name: 'Forest Tamer',
    icon: '🌲',
    tier: 'mid',
    description: 'Clear 60 glades across all your runs.',
    progress: { target: 60, mode: 'sum', unit: 'glades', value: (r) => r.stats.gladesCleared },
  },
  {
    id: 'threeDawns',
    name: 'Three Dawns',
    icon: '🌅',
    tier: 'mid',
    description: 'Finish the daily expedition three days in a row (UTC).',
    progress: {
      target: 3,
      mode: 'max',
      unit: 'days',
      value: (r, ctx) => (r.daily ? ctx.dailyStreak : null),
    },
    reward: { title: 'the Dawnwalker' },
  },

  // ---- late ----------------------------------------------------------------
  {
    id: 'exactingCrown',
    name: 'The Exacting Crown',
    icon: '💎',
    tier: 'late',
    description: 'Win under Edict VII, the harshest terms the Queen sets.',
    when: (r) => won(r) && edictOf(r) >= 7,
    reward: { supplies: 10, title: 'the Exacting' },
  },
  {
    id: 'everyRung',
    name: 'Every Rung',
    icon: '🪜',
    tier: 'late',
    description: 'Win under every rung of the ladder, from no edict to Edict VII.',
    progress: {
      target: 8,
      mode: 'distinct',
      unit: 'rungs',
      value: (r) => (won(r) ? [String(edictOf(r))] : null),
    },
    reward: { title: "the Queen's Own" },
  },
  {
    id: 'queensFavourite',
    name: "Queen's Favourite",
    icon: '🏅',
    tier: 'late',
    description: 'Fulfil 5 royal decrees in a single run.',
    when: (r) => featsOf(r).decreesMet >= 5,
  },
  {
    id: 'everyComfort',
    name: 'Every Comfort',
    icon: '🏛️',
    tier: 'late',
    description: 'End a run with a hall standing for every service need — all six.',
    when: (r) => serviceNeedsBuilt(r) >= ALL_SERVICE_NEEDS,
    reward: { supplies: 5 },
  },
  {
    id: 'masterworks',
    name: 'Masterworks',
    icon: '🏰',
    tier: 'late',
    description: 'End a run with 3 buildings raised to their second upgrade tier.',
    when: (r) => buildingsAtTier(r, 2) >= 3,
  },
  {
    id: 'lightningCharter',
    name: 'Lightning Charter',
    icon: '🌩️',
    tier: 'late',
    description: 'Win in under 18 minutes.',
    when: (r) => won(r) && minutesOf(r) < 18,
  },
  {
    id: 'manyHands',
    name: 'Many Hands',
    icon: '🧭',
    tier: 'late',
    description: 'Win with 10 different species trios — every trio there is.',
    progress: {
      target: 10,
      mode: 'distinct',
      unit: 'trios',
      value: (r) => {
        const key = won(r) ? trioKey(r.speciesPool) : null
        return key ? [key] : null
      },
    },
    reward: { title: 'of Many Peoples' },
  },

  // ---- style: how the run was won (each opens something in the Citadel) ----
  {
    id: 'lightFootprint',
    name: 'Light Footprint',
    icon: '🪶',
    tier: 'style',
    description: 'Win having cleared no more than 8 glades.',
    when: (r) => won(r) && r.stats.gladesCleared <= 8,
  },
  {
    id: 'ownCounsel',
    name: 'Own Counsel',
    icon: '📐',
    tier: 'style',
    description: "Win without ever buying plans from the Queen's Architect.",
    when: (r) => won(r) && (r.architectPlans ?? 0) === 0,
  },
  {
    id: 'vowKept',
    name: 'True to Your Word',
    icon: '💍',
    tier: 'style',
    description: "Keep the vow of a Grand Petition: the reputation promised, in time.",
    when: (r) => r.petition?.outcome === 'kept',
  },
  {
    id: 'refinedTastes',
    name: 'Refined Tastes',
    icon: '🍹',
    tier: 'style',
    description: "Win having met every species' refined need at the same time.",
    when: (r) => won(r) && featsOf(r).refinedAll === true,
  },
  {
    id: 'warmWinters',
    name: 'Warm Winters',
    icon: '❄️',
    tier: 'style',
    description:
      "Win after two Storms or more with no brazier standing and no villager ever sleeping in a cold home: everyone inside the hearth's warmth.",
    when: (r) =>
      won(r) &&
      r.season.year >= 3 &&
      !featsOf(r).sleptCold &&
      (featsOf(r).frostLosses ?? 0) === 0 &&
      !Object.values(r.buildings).some((b) => BUILDINGS[b.defId]?.warmth),
  },
  {
    id: 'termsHonoured',
    name: 'Terms Honoured',
    icon: '📜',
    tier: 'style',
    description: 'Win on a Citadel commission with its objective met.',
    when: (r) => won(r) && judgeCommission(r)?.met === true,
  },
  {
    id: 'beforeThirdStorm',
    name: 'Before the Third Storm',
    icon: '🌅',
    tier: 'style',
    description: 'Win in Year 3 or earlier: the Envoy arrives before the year is out.',
    when: (r) => won(r) && r.season.year <= 3,
  },
]

export const ACHIEVEMENT_LIST = defs

export const ACHIEVEMENTS: Record<string, AchievementDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
)

/** How many achievements are earned (ignores ids no longer in the list). */
export function achievementCount(state: AchievementState): number {
  return defs.filter((d) => state.unlocked[d.id] !== undefined).length
}

/** Titles any achievement can grant. */
export function isAchievementTitle(title: string): boolean {
  return defs.some((d) => d.reward?.title === title)
}

/** Titles the player has earned, in list order. */
export function earnedTitles(state: AchievementState): string[] {
  return defs
    .filter((d) => d.reward?.title && state.unlocked[d.id] !== undefined)
    .map((d) => d.reward!.title!)
}

// ---------------------------------------------------------------------------
// State and evaluation
// ---------------------------------------------------------------------------

export function emptyAchievementState(): AchievementState {
  return { unlocked: {}, progress: {} }
}

/** A multi-run achievement's counter as a number (distinct keys count). */
export function progressCount(state: AchievementState, id: string): number {
  const p = state.progress[id]
  if (Array.isArray(p)) return p.length
  return typeof p === 'number' ? p : 0
}

function nextProgress(
  prev: number | string[] | undefined,
  spec: AchievementProgress,
  value: number | string[],
): number | string[] {
  if (spec.mode === 'distinct') {
    const keys = Array.isArray(value) ? value : [String(value)]
    const before = Array.isArray(prev) ? prev : []
    return [...new Set([...before, ...keys])].sort()
  }
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  const p = typeof prev === 'number' ? prev : 0
  return spec.mode === 'sum' ? p + n : Math.max(p, n)
}

export interface AchievementResult {
  state: AchievementState
  /** Newly earned, in list order. */
  unlocked: AchievementDef[]
  /** Citadel supplies the new ones pay. */
  supplies: number
}

/**
 * Judges a finished run. Pure: returns the next state, what was newly earned
 * and the supplies it pays. A run still in play earns nothing.
 */
export function evaluateAchievements(
  state: AchievementState,
  run: RunState,
  ctx: AchievementContext,
  now: number,
): AchievementResult {
  if (run.phase === 'playing') return { state, unlocked: [], supplies: 0 }
  const unlockedMap = { ...state.unlocked }
  const progress = { ...state.progress }
  const unlocked: AchievementDef[] = []
  for (const def of defs) {
    if (unlockedMap[def.id] !== undefined) continue
    let earned = false
    if (def.when) {
      earned = def.when(run, ctx)
    } else if (def.progress) {
      const value = def.progress.value(run, ctx)
      if (value === null) continue
      progress[def.id] = nextProgress(progress[def.id], def.progress, value)
      earned = progressCount({ unlocked: unlockedMap, progress }, def.id) >= def.progress.target
    }
    if (earned) {
      unlockedMap[def.id] = now
      unlocked.push(def)
    }
  }
  return {
    state: { unlocked: unlockedMap, progress },
    unlocked,
    supplies: unlocked.reduce((sum, d) => sum + (d.reward?.supplies ?? 0), 0),
  }
}

/** Reads a stored achievement state, dropping unknown ids and bad values. */
export function migrateAchievementState(raw: unknown): AchievementState {
  const out = emptyAchievementState()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  if (r.unlocked && typeof r.unlocked === 'object') {
    for (const [id, at] of Object.entries(r.unlocked as Record<string, unknown>)) {
      if (ACHIEVEMENTS[id])
        out.unlocked[id] = typeof at === 'number' && Number.isFinite(at) ? at : 0
    }
  }
  if (r.progress && typeof r.progress === 'object') {
    for (const [id, value] of Object.entries(r.progress as Record<string, unknown>)) {
      const spec = ACHIEVEMENTS[id]?.progress
      if (!spec) continue
      if (spec.mode === 'distinct' && Array.isArray(value)) {
        out.progress[id] = [
          ...new Set(value.filter((v): v is string => typeof v === 'string')),
        ].sort()
      } else if (spec.mode !== 'distinct' && typeof value === 'number' && Number.isFinite(value)) {
        out.progress[id] = Math.max(0, value)
      }
    }
  }
  return out
}

/**
 * Credits a pre-achievement save with what its ledger proves: finished and
 * won runs, wins per edict, species and trios. Pays no rewards — those are for
 * earning, not for upgrading. Counts only what is certain, so it can only
 * under-credit (the ledger is capped).
 */
export function backfillAchievements(meta: {
  runsWon: number
  runsLost: number
  history: readonly MetaHistoryEntry[]
}): AchievementState {
  const state = emptyAchievementState()
  const finished = meta.runsWon + meta.runsLost
  const wins = meta.history.filter((e) => e.won)
  const mark = (id: string) => (state.unlocked[id] = 0)
  if (finished > 0) {
    mark('firstEmbers')
    state.progress.seasonedViceroy = finished
    if (finished >= 10) mark('seasonedViceroy')
  }
  if (meta.runsWon > 0) mark('firstWin')
  if (wins.some((e) => (e.edict ?? 0) >= 1)) mark('underEdict')
  if (wins.some((e) => (e.edict ?? 0) >= 4)) mark('bitterTerms')
  if (wins.some((e) => (e.edict ?? 0) >= 7)) mark('exactingCrown')
  if (meta.history.some((e) => e.daily)) mark('dailyBread')
  if (wins.length > 0) {
    state.progress.everyRung = [...new Set(wins.map((e) => String(e.edict ?? 0)))].sort()
    const species = [...new Set(wins.flatMap((e) => e.species ?? []))].sort()
    if (species.length > 0) state.progress.fivePeoples = species
    const trios = [
      ...new Set(wins.map((e) => trioKey(e.species ?? [])).filter((k): k is string => !!k)),
    ].sort()
    if (trios.length > 0) state.progress.manyHands = trios
    if (progressCount(state, 'everyRung') >= 8) mark('everyRung')
    if (progressCount(state, 'fivePeoples') >= 5) mark('fivePeoples')
    if (progressCount(state, 'manyHands') >= 10) mark('manyHands')
  }
  return state
}

/** How far along a multi-run achievement is, for the UI: `[count, target]`. */
export function achievementProgress(
  state: AchievementState,
  def: AchievementDef,
): [number, number] | null {
  if (!def.progress) return null
  const target = def.progress.target
  const count = state.unlocked[def.id] !== undefined ? target : progressCount(state, def.id)
  return [Math.min(count, target), target]
}
