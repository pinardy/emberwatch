import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DAILY_EDICT,
  DAILY_HISTORY_LIMIT,
  DAILY_SPECIES_POOL,
  betterDaily,
  dailyExpedition,
  dailyResultFor,
  dailySeed,
  dailyShareText,
  dailyStreak,
  emptyDailyLedger,
  isDateKey,
  migrateDailyLedger,
  msUntilNextDaily,
  recordDaily,
  shiftDateKey,
  utcDateKey,
} from './content/daily'
import { bankRun, defaultMeta, migrateMeta } from './content/meta'
import { RUN_MODIFIERS } from './content/runModifiers'
import { createRun } from './engine/createRun'
import { drawRunModifiers } from './engine/runModifiers'
import { settleRun } from './progression'
import { useGameStore } from './store'
import type { DailyResult, RunState } from './types'

const NOV5 = Date.UTC(2026, 10, 5, 12, 0, 0)

/** Node's environment (the app's tsconfig has no Node types). Changing TZ applies at once. */
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process.env

function result(date: string, patch: Partial<DailyResult> = {}): DailyResult {
  return {
    date,
    seed: dailySeed(date),
    won: true,
    years: 4,
    reputation: 20,
    villagersLost: 0,
    seconds: 19 * 60,
    attempts: 1,
    at: 1,
    ...patch,
  }
}

/** A finished daily run for `date`, without playing it. */
function finishedDaily(
  date: string,
  phase: 'won' | 'lost',
  patch: Partial<RunState> = {},
): RunState {
  const day = dailyExpedition(date)
  const run = createRun({ seed: day.seed, species: day.species, edict: day.edict, daily: date })
  run.phase = phase
  run.clock = 20 * 60
  run.season.year = 4
  Object.assign(run, patch)
  return run
}

describe('the daily seed', () => {
  const originalTz = env.TZ
  afterEach(() => {
    env.TZ = originalTz
  })

  it('names the UTC calendar day, whatever the local timezone', () => {
    // The same instant seen from either side of the date line.
    const instant = Date.UTC(2026, 10, 5, 23, 30)
    const keys: string[] = []
    const localHours = new Set<number>()
    for (const tz of [
      'UTC',
      'Pacific/Kiritimati',
      'America/Los_Angeles',
      'Asia/Kolkata',
      'Pacific/Pago_Pago',
    ]) {
      env.TZ = tz
      keys.push(utcDateKey(new Date(instant)))
      localHours.add(new Date(instant).getHours())
    }
    // The local clock really did move (so the check means something)...
    expect(localHours.size).toBeGreaterThan(1)
    // ...but the day did not.
    expect(new Set(keys)).toEqual(new Set(['2026-11-05']))
  })

  it('reads offsets in ISO strings as the UTC day they fall on', () => {
    expect(utcDateKey(new Date('2026-11-05T20:00:00-05:00'))).toBe('2026-11-06')
    expect(utcDateKey(new Date('2026-11-06T08:00:00+09:00'))).toBe('2026-11-05')
    expect(utcDateKey(new Date('2026-11-05T00:00:00Z'))).toBe('2026-11-05')
  })

  it('changes exactly at UTC midnight', () => {
    const midnight = Date.UTC(2026, 10, 6)
    expect(utcDateKey(midnight - 1)).toBe('2026-11-05')
    expect(utcDateKey(midnight)).toBe('2026-11-06')
    expect(dailySeed(utcDateKey(midnight - 1))).not.toBe(dailySeed(utcDateKey(midnight)))
    expect(msUntilNextDaily(midnight - 1)).toBe(1)
    expect(msUntilNextDaily(midnight)).toBe(24 * 60 * 60 * 1000)
  })

  it('is stable: the same day always gives the same seed, trio, edict and land', () => {
    const a = dailyExpedition('2026-11-05')
    const b = dailyExpedition(utcDateKey(NOV5))
    expect(a).toEqual(b)
    expect(a.seed).toBe(dailySeed('2026-11-05'))
    expect(a.edict).toBe(DAILY_EDICT)
    expect(a.modifiers).toEqual(drawRunModifiers(a.seed))
  })

  it('draws three distinct species from all five, and varies across days', () => {
    const trios = new Set<string>()
    const seeds = new Set<number>()
    for (let d = 0; d < 60; d++) {
      const key = shiftDateKey('2026-01-01', d)
      const day = dailyExpedition(key)
      expect(day.species).toHaveLength(3)
      expect(new Set(day.species).size).toBe(3)
      for (const s of day.species) expect(DAILY_SPECIES_POOL).toContain(s)
      for (const id of day.modifiers) expect(RUN_MODIFIERS[id].citadelLocked).toBeFalsy()
      trios.add(day.species.join('+'))
      seeds.add(day.seed)
    }
    expect(seeds.size).toBe(60)
    expect(trios.size).toBeGreaterThan(5)
  })

  it('handles month, year and leap-day boundaries', () => {
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDateKey('2028-02-28', 1)).toBe('2028-02-29')
    expect(shiftDateKey('2028-03-01', -1)).toBe('2028-02-29')
    expect(isDateKey('2028-02-29')).toBe(true)
    expect(isDateKey('2026-02-29')).toBe(false)
    expect(isDateKey('2026-11-5')).toBe(false)
    expect(isDateKey(20261105)).toBe(false)
  })

  it('plays the fixed edict with no Citadel upgrades, whatever the Citadel owns', () => {
    const day = dailyExpedition('2026-11-05')
    const rich = {
      ...defaultMeta(),
      upgrades: [
        'deeperStores',
        'surveyorsNotes',
        'unchartedLands',
        'secondSurvey',
        'gildedHearth',
      ],
      edictUnlocked: 7,
    }
    useGameStore.setState({ meta: rich })
    useGameStore.getState().startDaily(NOV5)
    const run = useGameStore.getState().run!
    expect(run.daily).toBe('2026-11-05')
    expect(run.seed).toBe(day.seed)
    expect(run.speciesPool).toEqual(day.species)
    expect(run.edict).toBe(DAILY_EDICT)
    expect(run.runModifiers).toEqual(day.modifiers)
    const plain = createRun({ seed: day.seed, species: day.species, edict: DAILY_EDICT })
    expect(run.stock).toEqual(plain.stock)
    expect(run.citadel).toEqual(plain.citadel)
    expect(Object.keys(run.villagers)).toHaveLength(Object.keys(plain.villagers).length)
    useGameStore.setState({ run: null, meta: defaultMeta(), screen: 'menu' })
  })
})

describe('daily bookkeeping', () => {
  it('keeps the best attempt for a day and counts every attempt', () => {
    let ledger = recordDaily(
      emptyDailyLedger(),
      result('2026-11-05', { won: false, reputation: 9 }),
    )
    ledger = recordDaily(ledger, result('2026-11-05', { won: true, seconds: 1500 }))
    ledger = recordDaily(ledger, result('2026-11-05', { won: true, seconds: 1700 }))
    const day = dailyResultFor(ledger, '2026-11-05')!
    expect(day.attempts).toBe(3)
    expect(day.won).toBe(true)
    expect(day.seconds).toBe(1500)
    expect(ledger.results).toHaveLength(1)
  })

  it('ranks wins by time then losses, and losses by reputation then endurance', () => {
    expect(betterDaily(result('d', { won: true }), result('d', { won: false }))).toBe(true)
    expect(betterDaily(result('d', { seconds: 900 }), result('d', { seconds: 1000 }))).toBe(true)
    expect(betterDaily(result('d', { villagersLost: 0 }), result('d', { villagersLost: 2 }))).toBe(
      true,
    )
    const loss = (reputation: number, seconds: number) =>
      result('d', { won: false, reputation, seconds })
    expect(betterDaily(loss(12, 600), loss(8, 2000))).toBe(true)
    expect(betterDaily(loss(8, 2000), loss(8, 600))).toBe(true)
    expect(betterDaily(loss(8, 600), loss(8, 600))).toBe(false)
  })

  it('counts a streak of consecutive UTC days, still alive until today is missed', () => {
    let ledger = emptyDailyLedger()
    for (const d of ['2026-11-02', '2026-11-03', '2026-11-04']) {
      ledger = recordDaily(ledger, result(d))
    }
    // Today not played yet: the streak runs to yesterday.
    expect(dailyStreak(ledger, '2026-11-05')).toBe(3)
    ledger = recordDaily(ledger, result('2026-11-05'))
    expect(dailyStreak(ledger, '2026-11-05')).toBe(4)
    // A missed day breaks it.
    expect(dailyStreak(ledger, '2026-11-07')).toBe(0)
    expect(ledger.bestStreak).toBe(4)
  })

  it('keeps the best streak after a gap, and orders history newest first', () => {
    let ledger = emptyDailyLedger()
    for (const d of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10', '2026-10-09']) {
      ledger = recordDaily(ledger, result(d))
    }
    expect(ledger.bestStreak).toBe(3)
    expect(dailyStreak(ledger, '2026-10-10')).toBe(2)
    expect(ledger.results.map((r) => r.date)).toEqual([
      '2026-10-10',
      '2026-10-09',
      '2026-10-03',
      '2026-10-02',
      '2026-10-01',
    ])
  })

  it('caps the stored history but never forgets the best streak', () => {
    let ledger = emptyDailyLedger()
    for (let d = 0; d < DAILY_HISTORY_LIMIT + 10; d++) {
      ledger = recordDaily(ledger, result(shiftDateKey('2026-01-01', d)))
    }
    expect(ledger.results).toHaveLength(DAILY_HISTORY_LIMIT)
    // Streaks are measured over the stored window (plus the day being added).
    expect(ledger.bestStreak).toBeGreaterThanOrEqual(DAILY_HISTORY_LIMIT)
    expect(dailyStreak(ledger, shiftDateKey('2026-01-01', DAILY_HISTORY_LIMIT + 9))).toBe(
      DAILY_HISTORY_LIMIT,
    )
    expect(migrateDailyLedger(structuredClone(ledger))).toEqual(ledger)
  })

  it('writes a share line for wins and losses', () => {
    expect(dailyShareText(result('2026-11-05', { years: 4, seconds: 19 * 60 + 10 }))).toBe(
      'Emberwatch Daily 2026-11-05 — won in Y4, 19 min, 0 lost',
    )
    expect(
      dailyShareText(
        result('2026-11-05', {
          won: false,
          years: 5,
          reputation: 12,
          seconds: 30 * 60,
          villagersLost: 2,
        }),
        3,
      ),
    ).toBe('Emberwatch Daily 2026-11-05 — fell in Y5, 12 reputation, 30 min, 2 lost · 3-day streak')
  })

  it('migrates a stored ledger field by field', () => {
    const ledger = migrateDailyLedger({
      results: [
        null,
        { date: 'nope' },
        { date: '2026-11-04', won: true, years: 3, seconds: 900 },
        { date: '2026-11-04', won: false },
        { date: '2026-11-05', won: 'yes', attempts: -1 },
      ],
      bestStreak: 'x',
    })
    expect(ledger.results.map((r) => r.date)).toEqual(['2026-11-05', '2026-11-04'])
    expect(ledger.results[0]).toMatchObject({
      won: false,
      attempts: 1,
      seed: dailySeed('2026-11-05'),
    })
    expect(ledger.results[1]).toMatchObject({ won: true, years: 3, seconds: 900 })
    expect(ledger.bestStreak).toBe(2)
    expect(migrateDailyLedger(undefined)).toEqual(emptyDailyLedger())
  })
})

describe('banking a daily', () => {
  it('records the result, pays supplies, and climbs no edict rung', () => {
    const run = finishedDaily('2026-11-05', 'won')
    const banked = bankRun(defaultMeta(), run, 5)
    expect(banked.edictUnlocked).toBe(0)
    expect(banked.runsWon).toBe(1)
    expect(banked.history[0].daily).toBe('2026-11-05')
    // The migration does not mistake a daily win for an edict earned.
    expect(migrateMeta(structuredClone(banked)).edictUnlocked).toBe(0)

    const settled = settleRun(defaultMeta(), run, 5)
    expect(settled.daily).toMatchObject({ date: '2026-11-05', won: true, years: 4, seconds: 1200 })
    expect(dailyResultFor(settled.meta.daily, '2026-11-05')).toBeDefined()
    expect(settled.streak).toBe(1)
  })

  it('leaves the daily ledger alone for an ordinary run', () => {
    const run = createRun({ seed: 3, species: ['human', 'beaver', 'lizard'] })
    run.phase = 'lost'
    const settled = settleRun(defaultMeta(), run, 5)
    expect(settled.daily).toBeNull()
    expect(settled.meta.daily).toEqual(emptyDailyLedger())
  })

  it('carries a streak across days through the whole settle step', () => {
    let meta = defaultMeta()
    for (const d of ['2026-11-03', '2026-11-04', '2026-11-05']) {
      meta = settleRun(meta, finishedDaily(d, 'lost'), Date.parse(`${d}T12:00:00Z`)).meta
    }
    expect(dailyStreak(meta.daily, '2026-11-05')).toBe(3)
    expect(meta.daily.bestStreak).toBe(3)
  })
})

describe('the daily survives a save', () => {
  it('keeps its date key through a save/load round trip', async () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
    })
    const { loadRun, saveRun } = await import('./persistence')
    const run = finishedDaily('2026-11-05', 'won')
    run.phase = 'playing'
    saveRun(run)
    expect(loadRun()!.daily).toBe('2026-11-05')
    vi.unstubAllGlobals()
  })
})
