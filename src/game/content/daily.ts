import { hashInt, makeRng, parseSeed } from '../engine/rng'
import { drawRunModifiers } from '../engine/runModifiers'
import type { DailyLedger, DailyResult, RunState, SpeciesId } from '../types'

/**
 * The daily expedition: one map a day, the same for every player.
 *
 * Everything here is a pure function of the UTC calendar date, so it needs no
 * server and no clock agreement beyond "what day is it in UTC". The day's
 * seed, species trio and map modifiers are drawn from the date key alone; the
 * run is played under a fixed edict with no Citadel upgrades, so everyone
 * faces the same challenge however far their Citadel has grown.
 *
 * This module never imports `meta.ts` (which imports it).
 */

/** The fixed Queen's Edict every daily expedition is played under. */
export const DAILY_EDICT = 2

/**
 * Days of daily results kept in the save (a result is ~150 bytes). Streaks are
 * counted from these, so one longer than this many days reads as this long.
 */
export const DAILY_HISTORY_LIMIT = 400

/** Every species, in a stable order: dailies ignore the player's charters. */
export const DAILY_SPECIES_POOL: readonly SpeciesId[] = [
  'human',
  'beaver',
  'lizard',
  'harpy',
  'fox',
]

/** Salt for the species stream, so the trio does not track the map RNG. */
const SPECIES_STREAM = 0x64617973

const DAY_MS = 24 * 60 * 60 * 1000
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/**
 * The UTC calendar date of an instant as `YYYY-MM-DD`. Uses only the UTC
 * getters, so the answer is the same in every local timezone.
 */
export function utcDateKey(when: Date | number = Date.now()): string {
  const d = typeof when === 'number' ? new Date(when) : when
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** True for a well-formed, real calendar date key. */
export function isDateKey(key: unknown): key is string {
  if (typeof key !== 'string') return false
  const m = DATE_KEY.exec(key)
  if (!m) return false
  return utcDateKey(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) === key
}

/** Midnight UTC that opens the day `key`, in epoch ms. */
export function dateKeyToUtcMs(key: string): number {
  const m = DATE_KEY.exec(key)
  if (!m) return NaN
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** The date key `days` after (or before, if negative) `key`. */
export function shiftDateKey(key: string, days: number): string {
  return utcDateKey(dateKeyToUtcMs(key) + days * DAY_MS)
}

/** Milliseconds from `now` until the next UTC midnight (when the daily changes). */
export function msUntilNextDaily(now: number = Date.now()): number {
  const today = dateKeyToUtcMs(utcDateKey(now))
  return today + DAY_MS - now
}

/** The day's seed. A plain function of the date key. */
export function dailySeed(key: string): number {
  return parseSeed(`emberwatch-daily-${key}`)
}

export interface DailyExpedition {
  date: string
  seed: number
  species: SpeciesId[]
  edict: number
  modifiers: string[]
}

/** Everything about one day's expedition, derived from its date key. */
export function dailyExpedition(key: string): DailyExpedition {
  const seed = dailySeed(key)
  const rng = makeRng(hashInt((seed ^ SPECIES_STREAM) >>> 0, 0), 0)
  const picked = rng.sample(DAILY_SPECIES_POOL, 3)
  return {
    date: key,
    seed,
    // Shown in the pool's order, so the trio reads the same every time.
    species: DAILY_SPECIES_POOL.filter((s) => picked.includes(s)),
    edict: DAILY_EDICT,
    // The base pool only: Citadel-admitted lands never reach a daily.
    modifiers: drawRunModifiers(seed),
  }
}

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------

export function emptyDailyLedger(): DailyLedger {
  return { results: [], bestStreak: 0 }
}

/** A finished daily run as a result row. */
export function dailyResultOf(run: RunState, now: number): DailyResult | null {
  if (!run.daily || run.phase === 'playing') return null
  return {
    date: run.daily,
    seed: run.seed,
    won: run.phase === 'won',
    years: run.season.year,
    reputation: run.reputation,
    villagersLost: run.stats.villagersLost,
    seconds: Math.round(run.clock),
    attempts: 1,
    at: now,
  }
}

/**
 * True when `a` is a better result than `b`: a win beats a loss; between
 * wins the faster one, then fewer villagers lost; between losses the one with
 * more reputation, then the one that lasted longer.
 */
export function betterDaily(a: DailyResult, b: DailyResult): boolean {
  if (a.won !== b.won) return a.won
  if (a.won) {
    if (a.seconds !== b.seconds) return a.seconds < b.seconds
    return a.villagersLost < b.villagersLost
  }
  if (a.reputation !== b.reputation) return a.reputation > b.reputation
  return a.seconds > b.seconds
}

/**
 * Consecutive days with a finished daily, ending today — or yesterday, so a
 * streak is not shown as broken before today's expedition has been tried.
 */
export function dailyStreak(ledger: DailyLedger, today: string): number {
  const days = new Set(ledger.results.map((r) => r.date))
  let day = days.has(today) ? today : shiftDateKey(today, -1)
  let streak = 0
  while (days.has(day)) {
    streak++
    day = shiftDateKey(day, -1)
  }
  return streak
}

/** The longest run of consecutive days anywhere in the ledger. */
function longestStreak(results: readonly DailyResult[]): number {
  const days = new Set(results.map((r) => r.date))
  let best = 0
  for (const day of days) {
    if (days.has(shiftDateKey(day, -1))) continue
    let len = 0
    let d = day
    while (days.has(d)) {
      len++
      d = shiftDateKey(d, 1)
    }
    best = Math.max(best, len)
  }
  return best
}

/**
 * Records a finished daily run: keeps the better of it and any earlier
 * attempt at the same day, counts the attempt, and updates the best streak.
 * Never mutates `ledger`.
 */
export function recordDaily(ledger: DailyLedger, result: DailyResult): DailyLedger {
  const existing = ledger.results.find((r) => r.date === result.date)
  let entry: DailyResult
  if (!existing) {
    entry = { ...result, attempts: 1 }
  } else {
    const attempts = existing.attempts + 1
    entry = betterDaily(result, existing) ? { ...result, attempts } : { ...existing, attempts }
  }
  const all = [entry, ...ledger.results.filter((r) => r.date !== result.date)].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  )
  // Measured before the oldest day is trimmed, so a streak as long as the
  // whole window still counts in full once.
  return {
    results: all.slice(0, DAILY_HISTORY_LIMIT),
    bestStreak: Math.max(ledger.bestStreak, longestStreak(all)),
  }
}

/** The ledger row for `date`, if that day was attempted. */
export function dailyResultFor(ledger: DailyLedger, date: string): DailyResult | undefined {
  return ledger.results.find((r) => r.date === date)
}

/** Whole minutes, rounded, never below 1 for a run that happened at all. */
export function runMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60))
}

/** The line a player can paste anywhere: "Emberwatch Daily 2026-11-05 — won in Y4, 19 min, 0 lost". */
export function dailyShareText(result: DailyResult, streak = 0): string {
  const minutes = runMinutes(result.seconds)
  const lost = `${result.villagersLost} lost`
  const body = result.won
    ? `won in Y${result.years}, ${minutes} min, ${lost}`
    : `fell in Y${result.years}, ${result.reputation} reputation, ${minutes} min, ${lost}`
  const tail = streak > 1 ? ` · ${streak}-day streak` : ''
  return `Emberwatch Daily ${result.date} — ${body}${tail}`
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Reads a stored ledger field by field; anything unreadable is dropped. */
export function migrateDailyLedger(raw: unknown): DailyLedger {
  if (!raw || typeof raw !== 'object') return emptyDailyLedger()
  const l = raw as Record<string, unknown>
  const seen = new Set<string>()
  const results: DailyResult[] = []
  for (const item of Array.isArray(l.results) ? l.results : []) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (!isDateKey(r.date) || seen.has(r.date)) continue
    seen.add(r.date)
    results.push({
      date: r.date,
      seed: num(r.seed, dailySeed(r.date)),
      won: r.won === true,
      years: Math.max(1, num(r.years, 1)),
      reputation: Math.max(0, num(r.reputation)),
      villagersLost: Math.max(0, num(r.villagersLost)),
      seconds: Math.max(0, num(r.seconds)),
      attempts: Math.max(1, num(r.attempts, 1)),
      at: num(r.at),
    })
  }
  results.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const kept = results.slice(0, DAILY_HISTORY_LIMIT)
  return {
    results: kept,
    bestStreak: Math.max(0, num(l.bestStreak), longestStreak(kept)),
  }
}
