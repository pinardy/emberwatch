import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_LIST,
  ALL_SERVICE_NEEDS,
  backfillAchievements,
  defaultFeats,
  earnedTitles,
  emptyAchievementState,
  evaluateAchievements,
  migrateAchievementState,
  progressCount,
  trioKey,
  type AchievementContext,
} from './content/achievements'
import { BUILDINGS, BUILDING_LIST } from './content/buildings'
import { META_VERSION, bankRun, defaultMeta, migrateMeta, supplyReward } from './content/meta'
import { appeaseThreat } from './engine/events'
import { createRun } from './engine/createRun'
import { stepDecree } from './engine/structure'
import { tick } from './engine/tick'
import { loadRun, saveRun } from './persistence'
import { settleRun } from './progression'
import { useGameStore } from './store'
import type { ActiveThreat, AchievementState, BuildingInstance, MetaState, RunState, SpeciesId } from './types'

const TRIO: SpeciesId[] = ['human', 'beaver', 'lizard']
const CTX: AchievementContext = { dailyStreak: 0 }

function baseRun(patch: Partial<RunState> = {}): RunState {
  const s = createRun({ seed: 77, species: [...TRIO], modifiers: [] })
  Object.assign(s, patch)
  return s
}

/** A finished run: by default a Year-4, 22-minute loss with nothing notable. */
function ended(phase: 'won' | 'lost', patch: Partial<RunState> = {}): RunState {
  const s = baseRun()
  s.phase = phase
  s.clock = 22 * 60
  s.season.year = 4
  Object.assign(s, patch)
  return s
}

const won = (patch: Partial<RunState> = {}) => ended('won', patch)
const lost = (patch: Partial<RunState> = {}) => ended('lost', patch)

/** Ids this single run would earn from scratch. */
function earns(run: RunState, ctx: AchievementContext = CTX): string[] {
  return evaluateAchievements(emptyAchievementState(), run, ctx, 1).unlocked.map((d) => d.id)
}

function check(id: string, run: RunState, ctx: AchievementContext = CTX): boolean {
  return earns(run, ctx).includes(id)
}

function withStats(run: RunState, stats: Partial<RunState['stats']>): RunState {
  run.stats = { ...run.stats, ...stats }
  return run
}

function addBuilding(run: RunState, defId: string, patch: Partial<BuildingInstance> = {}): void {
  const id = `t${Object.keys(run.buildings).length}`
  run.buildings[id] = {
    ...run.buildings.hearth,
    id,
    defId,
    pos: { x: 3, y: 3 },
    built: true,
    tier: 0,
    workers: [],
    ...patch,
  }
}

describe('achievement content', () => {
  it('has 20–25 achievements across early, mid and late play, with unique ids', () => {
    expect(ACHIEVEMENT_LIST.length).toBeGreaterThanOrEqual(20)
    expect(ACHIEVEMENT_LIST.length).toBeLessThanOrEqual(25)
    expect(new Set(ACHIEVEMENT_LIST.map((d) => d.id)).size).toBe(ACHIEVEMENT_LIST.length)
    for (const tier of ['early', 'mid', 'late'] as const) {
      expect(ACHIEVEMENT_LIST.filter((d) => d.tier === tier).length).toBeGreaterThanOrEqual(5)
    }
    for (const def of ACHIEVEMENT_LIST) {
      // Exactly one way to be earned.
      expect(!!def.when !== !!def.progress, def.id).toBe(true)
      expect(def.description.length, def.id).toBeGreaterThan(5)
    }
  })

  it('keeps rewards modest', () => {
    const supplies = ACHIEVEMENT_LIST.reduce((n, d) => n + (d.reward?.supplies ?? 0), 0)
    expect(supplies).toBeLessThanOrEqual(40)
    for (const d of ACHIEVEMENT_LIST) expect(d.reward?.supplies ?? 0).toBeLessThanOrEqual(10)
    const titles = ACHIEVEMENT_LIST.filter((d) => d.reward?.title).map((d) => d.reward!.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('counts every service need the buildings can meet', () => {
    const needs = new Set(BUILDING_LIST.map((d) => d.service?.need).filter(Boolean))
    expect(ALL_SERVICE_NEEDS).toBe(needs.size)
    expect(ALL_SERVICE_NEEDS).toBe(6)
  })
})

describe('single-run predicates', () => {
  it('a run still in play earns nothing', () => {
    const s = baseRun()
    expect(earns(s)).toEqual([])
  })

  it('First Embers for any finished run; The Settlement Holds only for a win', () => {
    expect(check('firstEmbers', lost())).toBe(true)
    expect(check('firstWin', lost())).toBe(false)
    expect(check('firstWin', won())).toBe(true)
  })

  it('glade counts at 6 and 12, exactly at the threshold', () => {
    expect(check('intoTheWoods', withStats(lost(), { gladesCleared: 5 }))).toBe(false)
    expect(check('intoTheWoods', withStats(lost(), { gladesCleared: 6 }))).toBe(true)
    expect(check('cartographer', withStats(lost(), { gladesCleared: 11 }))).toBe(false)
    expect(check('cartographer', withStats(lost(), { gladesCleared: 12 }))).toBe(true)
  })

  it('decrees and threats come from in-run feats, and old runs default to none', () => {
    expect(check('byRoyalDecree', lost({ feats: undefined }))).toBe(false)
    expect(check('byRoyalDecree', lost({ feats: { ...defaultFeats(), decreesMet: 1 } }))).toBe(true)
    expect(check('queensFavourite', lost({ feats: { ...defaultFeats(), decreesMet: 4 } }))).toBe(false)
    expect(check('queensFavourite', lost({ feats: { ...defaultFeats(), decreesMet: 5 } }))).toBe(true)
    expect(check('paidInFull', lost({ feats: { ...defaultFeats(), threatsAppeased: 1 } }))).toBe(true)
    expect(check('paidInFull', lost())).toBe(false)
  })

  it('upgrade tiers: one raised building, then three at tier 2 (not under construction)', () => {
    const one = lost()
    addBuilding(one, 'shelter', { tier: 1 })
    expect(check('betterBuilt', one)).toBe(true)
    expect(check('masterworks', one)).toBe(false)
    const three = lost()
    addBuilding(three, 'shelter', { tier: 2 })
    addBuilding(three, 'shelter', { tier: 2 })
    addBuilding(three, 'shelter', { tier: 2, built: false })
    expect(check('masterworks', three)).toBe(false)
    addBuilding(three, 'shelter', { tier: 2 })
    expect(check('masterworks', three)).toBe(true)
  })

  it('Every Comfort needs a finished hall for all six needs', () => {
    const s = lost()
    const halls = BUILDING_LIST.filter((d) => d.service)
    const byNeed = new Map(halls.map((d) => [d.service!.need, d.id]))
    const ids = [...byNeed.values()]
    ids.slice(0, -1).forEach((id) => addBuilding(s, id))
    expect(check('everyComfort', s)).toBe(false)
    addBuilding(s, ids[ids.length - 1], { built: false })
    expect(check('everyComfort', s)).toBe(false)
    addBuilding(s, ids[ids.length - 1])
    expect(check('everyComfort', s)).toBe(true)
  })

  it('edict wins at I, IV and VII — never on a loss', () => {
    expect(check('underEdict', won({ edict: 0 }))).toBe(false)
    expect(check('underEdict', won({ edict: 1 }))).toBe(true)
    expect(check('underEdict', lost({ edict: 7 }))).toBe(false)
    expect(check('bitterTerms', won({ edict: 3 }))).toBe(false)
    expect(check('bitterTerms', won({ edict: 4 }))).toBe(true)
    expect(check('exactingCrown', won({ edict: 6 }))).toBe(false)
    expect(check('exactingCrown', won({ edict: 7 }))).toBe(true)
  })

  it('No One Left Behind: a win with zero losses', () => {
    expect(check('noOneLeftBehind', withStats(won(), { villagersLost: 0 }))).toBe(true)
    expect(check('noOneLeftBehind', withStats(won(), { villagersLost: 1 }))).toBe(false)
    expect(check('noOneLeftBehind', withStats(lost(), { villagersLost: 0 }))).toBe(false)
  })

  it('speed wins are strictly under 25 and 18 minutes of game time', () => {
    expect(check('swiftCharter', won({ clock: 25 * 60 }))).toBe(false)
    expect(check('swiftCharter', won({ clock: 25 * 60 - 1 }))).toBe(true)
    expect(check('lightningCharter', won({ clock: 18 * 60 }))).toBe(false)
    expect(check('lightningCharter', won({ clock: 17 * 60 }))).toBe(true)
    expect(check('swiftCharter', lost({ clock: 60 }))).toBe(false)
  })

  it('Kept the Flame: a win past a Storm with the hearth never cold', () => {
    expect(check('keptTheFlame', won())).toBe(true)
    expect(check('keptTheFlame', won({ feats: { ...defaultFeats(), hearthWentCold: true } }))).toBe(false)
    const early = won()
    early.season.year = 1
    expect(check('keptTheFlame', early)).toBe(false)
    expect(check('keptTheFlame', lost())).toBe(false)
  })

  it('Weathered: a win on Long Storms land', () => {
    expect(check('weathered', won({ runModifiers: ['longStorms'] }))).toBe(true)
    expect(check('weathered', lost({ runModifiers: ['longStorms'] }))).toBe(false)
    expect(check('weathered', won({ runModifiers: ['richVeins'] }))).toBe(false)
  })

  it('Daily Bread for any finished daily', () => {
    expect(check('dailyBread', lost({ daily: '2026-11-05' }))).toBe(true)
    expect(check('dailyBread', lost())).toBe(false)
  })
})

describe('multi-run progress', () => {
  function bankMany(runs: RunState[], ctx: AchievementContext = CTX): AchievementState {
    let state = emptyAchievementState()
    for (const r of runs) state = evaluateAchievements(state, r, ctx, 1).state
    return state
  }

  it('Seasoned Viceroy sums finished runs to ten', () => {
    const nine = bankMany(Array.from({ length: 9 }, () => lost()))
    expect(progressCount(nine, 'seasonedViceroy')).toBe(9)
    expect(nine.unlocked.seasonedViceroy).toBeUndefined()
    const ten = evaluateAchievements(nine, lost(), CTX, 5)
    expect(ten.unlocked.map((d) => d.id)).toContain('seasonedViceroy')
    expect(ten.supplies).toBe(ACHIEVEMENTS.seasonedViceroy.reward!.supplies)
  })

  it('Forest Tamer sums glades across runs', () => {
    const state = bankMany([25, 20, 14].map((g) => withStats(lost(), { gladesCleared: g })))
    expect(progressCount(state, 'forestTamer')).toBe(59)
    expect(state.unlocked.forestTamer).toBeUndefined()
    const next = evaluateAchievements(state, withStats(lost(), { gladesCleared: 1 }), CTX, 1)
    expect(next.state.unlocked.forestTamer).toBe(1)
  })

  it('Five Peoples and Many Hands count distinct species and trios from wins only', () => {
    const state = bankMany([
      won({ speciesPool: ['human', 'beaver', 'lizard'] }),
      won({ speciesPool: ['lizard', 'beaver', 'human'] }),
      lost({ speciesPool: ['harpy', 'fox', 'human'] }),
    ])
    expect(progressCount(state, 'fivePeoples')).toBe(3)
    expect(progressCount(state, 'manyHands')).toBe(1)
    const all = evaluateAchievements(state, won({ speciesPool: ['harpy', 'fox', 'human'] }), CTX, 1)
    expect(all.unlocked.map((d) => d.id)).toContain('fivePeoples')
    expect(trioKey(['fox', 'harpy'])).toBeNull()
  })

  it('Every Rung needs a win under each of the eight rungs', () => {
    const state = bankMany([0, 1, 2, 3, 4, 5, 6].map((edict) => won({ edict })))
    expect(progressCount(state, 'everyRung')).toBe(7)
    const repeat = evaluateAchievements(state, won({ edict: 6 }), CTX, 1)
    expect(repeat.state.unlocked.everyRung).toBeUndefined()
    const top = evaluateAchievements(state, won({ edict: 7 }), CTX, 1)
    expect(top.state.unlocked.everyRung).toBe(1)
  })

  it('Three Dawns takes the best daily streak, only from dailies', () => {
    const daily = lost({ daily: '2026-11-05' })
    expect(check('threeDawns', daily, { dailyStreak: 2 })).toBe(false)
    expect(check('threeDawns', daily, { dailyStreak: 3 })).toBe(true)
    // A long streak in the context does not count for an ordinary run.
    expect(check('threeDawns', lost(), { dailyStreak: 9 })).toBe(false)
    const state = bankMany([daily], { dailyStreak: 2 })
    const later = evaluateAchievements(state, daily, { dailyStreak: 1 }, 1)
    expect(progressCount(later.state, 'threeDawns')).toBe(2)
  })

  it('never earns or pays the same achievement twice', () => {
    const first = evaluateAchievements(emptyAchievementState(), won(), CTX, 10)
    expect(first.unlocked.map((d) => d.id)).toContain('firstWin')
    const again = evaluateAchievements(first.state, won(), CTX, 20)
    expect(again.unlocked.map((d) => d.id)).not.toContain('firstWin')
    expect(again.state.unlocked.firstWin).toBe(10)
  })
})

describe('banking achievements', () => {
  it('settles supplies for the run and the achievements, separately itemised', () => {
    const run = won()
    const settled = settleRun(defaultMeta(), run, 5)
    const ids = settled.achievements.map((d) => d.id)
    expect(ids).toEqual(expect.arrayContaining(['firstEmbers', 'firstWin']))
    const bonus = settled.achievements.reduce((n, d) => n + (d.reward?.supplies ?? 0), 0)
    expect(settled.achievementSupplies).toBe(bonus)
    expect(settled.meta.citadelSupplies).toBe(supplyReward(run) + bonus)
    // bankRun alone is unchanged: run supplies only.
    expect(bankRun(defaultMeta(), run, 5).citadelSupplies).toBe(supplyReward(run))
  })

  it('records unlocks through the store and wears only earned titles', () => {
    useGameStore.setState({ meta: defaultMeta(), run: won(), screen: 'game' })
    useGameStore.getState().finishRun()
    const meta = useGameStore.getState().meta
    expect(meta.achievements.unlocked.firstWin).toBeGreaterThan(0)
    expect(useGameStore.getState().notice).toContain('The Settlement Holds')
    useGameStore.getState().setTitle('the Exacting')
    expect(useGameStore.getState().meta.title).toBeNull()
    useGameStore.setState({
      meta: { ...meta, achievements: { ...meta.achievements, unlocked: { ...meta.achievements.unlocked, exactingCrown: 1 } } },
    })
    expect(earnedTitles(useGameStore.getState().meta.achievements)).toContain('the Exacting')
    useGameStore.getState().setTitle('the Exacting')
    expect(useGameStore.getState().meta.title).toBe('the Exacting')
    useGameStore.setState({ meta: defaultMeta(), run: null, screen: 'menu' })
  })
})

describe('meta migration to v3', () => {
  const v2: Record<string, unknown> = {
    version: 2,
    citadelSupplies: 31,
    runsWon: 3,
    runsLost: 8,
    unlockedSpecies: ['fox'],
    upgrades: ['unlockFox', 'surveyorsNotes'],
    edictUnlocked: 5,
    history: [
      { seed: 1, won: true, years: 4, reputation: 20, at: 50, edict: 4, species: ['human', 'fox', 'lizard'] },
      { seed: 2, won: true, years: 4, reputation: 20, at: 40, edict: 0, species: ['human', 'beaver', 'lizard'] },
      { seed: 3, won: false, years: 3, reputation: 9, at: 30, edict: 4 },
    ],
  }

  it('bumps the version and keeps everything that was there', () => {
    const meta = migrateMeta(structuredClone(v2))
    expect(META_VERSION).toBe(3)
    expect(meta.version).toBe(3)
    expect(meta).toMatchObject({
      citadelSupplies: 31,
      runsWon: 3,
      runsLost: 8,
      unlockedSpecies: ['fox'],
      upgrades: ['unlockFox', 'surveyorsNotes'],
      edictUnlocked: 5,
      title: null,
    })
    expect(meta.history).toHaveLength(3)
    expect(meta.daily).toEqual({ results: [], bestStreak: 0 })
  })

  it('credits what the ledger proves, and pays nothing for it', () => {
    const meta = migrateMeta(structuredClone(v2))
    const got = Object.keys(meta.achievements.unlocked)
    expect(got).toEqual(expect.arrayContaining(['firstEmbers', 'seasonedViceroy', 'firstWin', 'underEdict', 'bitterTerms']))
    expect(got).not.toContain('exactingCrown')
    expect(progressCount(meta.achievements, 'seasonedViceroy')).toBe(11)
    expect(meta.achievements.progress.everyRung).toEqual(['0', '4'])
    expect(progressCount(meta.achievements, 'manyHands')).toBe(2)
    expect(meta.citadelSupplies).toBe(31)
  })

  it('backfills nothing for an empty save, so a fresh migrate equals a fresh meta', () => {
    expect(backfillAchievements({ runsWon: 0, runsLost: 0, history: [] })).toEqual(emptyAchievementState())
    expect(migrateMeta({ version: 2 })).toEqual(defaultMeta())
  })

  it('is idempotent on a v3 save and drops unknown or malformed entries', () => {
    const settled = settleRun(migrateMeta(structuredClone(v2)), won({ daily: '2026-11-05' }), 9).meta
    const withTitle: MetaState = { ...settled, title: 'the Shepherd' }
    expect(migrateMeta(structuredClone(withTitle))).toEqual(withTitle)
    const odd = migrateAchievementState({
      unlocked: { firstWin: 5, notAThing: 1, firstEmbers: 'x' },
      progress: { forestTamer: 12, everyRung: ['1', 2, '1'], fivePeoples: 3, nope: 4 },
    })
    expect(odd.unlocked).toEqual({ firstWin: 5, firstEmbers: 0 })
    expect(odd.progress).toEqual({ forestTamer: 12, everyRung: ['1'] })
    expect(migrateMeta({ ...withTitle, title: 'the Pretender' }).title).toBeNull()
  })
})

describe('in-run feats', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a fresh run starts with nothing remarkable', () => {
    expect(baseRun().feats).toEqual(defaultFeats())
  })

  it('notes the moment the hearth goes cold, and not before', () => {
    const s = baseRun({ pendingChoices: [] })
    s.season.season = 'storm'
    for (let i = 0; i < 8; i++) tick(s, 0.125)
    expect(s.coldHearth).toBe(false)
    expect(s.feats!.hearthWentCold).toBe(false)
    s.stock.wood = 0
    tick(s, 0.125)
    expect(s.coldHearth).toBe(true)
    expect(s.feats!.hearthWentCold).toBe(true)
  })

  it('counts decrees met and threats paid off', () => {
    const s = baseRun()
    s.decree = {
      id: 'probe',
      defId: 'decree_glade',
      progress: 0,
      complete: false,
      timeLeft: 100,
      timeLimit: 100,
      baseline: s.stats.gladesCleared - 1,
    }
    stepDecree(s, 0.125)
    expect(s.feats!.decreesMet).toBe(1)

    s.threats.push({
      id: 'th1',
      gladeId: 'glade1',
      timer: 30,
      name: 'Probe',
      icon: '👹',
      appease: {},
    } as unknown as ActiveThreat)
    expect(appeaseThreat(s, 'th1')).toBeNull()
    expect(s.feats!.threatsAppeased).toBe(1)
  })

  it('tolerates states without feats and old saves load with defaults', () => {
    const s = baseRun({ pendingChoices: [] })
    delete s.feats
    s.stock.wood = 0
    s.season.season = 'storm'
    tick(s, 0.125)
    expect(s.feats!.hearthWentCold).toBe(true)

    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
    })
    const old = baseRun()
    delete old.feats
    saveRun(old)
    expect(loadRun()!.feats).toEqual(defaultFeats())
    const busy = baseRun({ feats: { hearthWentCold: true, decreesMet: 2, threatsAppeased: 1 } })
    saveRun(busy)
    expect(loadRun()!.feats).toEqual(busy.feats)
  })

  it('does not change how a run plays', () => {
    const a = baseRun({ pendingChoices: [] })
    const b = baseRun({ pendingChoices: [] })
    delete b.feats
    for (let i = 0; i < 400; i++) {
      tick(a, 0.125)
      tick(b, 0.125)
    }
    const strip = (s: RunState) => ({ ...s, feats: undefined })
    expect(strip(a)).toEqual(strip(b))
    expect(BUILDINGS.ancientHearth).toBeDefined()
  })
})
