import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../content/buildings'
import { CORNERSTONES } from '../content/cornerstones'
import { DECREES } from '../content/decrees'
import { GLADE_EVENTS } from '../content/gladeEvents'
import { bankRun, defaultMeta, migrateMeta } from '../content/meta'
import {
  MAX_RUN_MODIFIERS,
  MIN_RUN_MODIFIERS,
  RUN_MODIFIERS,
  RUN_MODIFIER_LIST,
} from '../content/runModifiers'
import { TERRAIN } from '../content/terrain'
import { loadRun } from '../persistence'
import type { DepositId, GladeKind, RunState, TerrainId } from '../types'
import { adjacencyMultiplier } from './adjacency'
import {
  CARAVAN_INTERVAL,
  DECREE_MISS_IMPATIENCE,
  HEARTH_FUEL_PER_SECOND,
  SEASON_LENGTH,
  STARTING_STOCK,
} from './balance'
import { createRun } from './createRun'
import { optionAffordable, resolveGladeEvent, stepOrders, takeChoice } from './events'
import { hearthForecast, secondsUntilStorm } from './forecast'
import { DEPOSIT_RADIUS, generateMap } from './mapgen'
import { computeModifiers, emptyModifiers } from './modifiers'
import { seasonMultiplier, terrainBuildMultiplier, terrainWorkMultiplier } from './production'
import { makeRng } from './rng'
import {
  drawRunModifiers,
  mapgenHooksFor,
  modifierOngoingId,
  modifiersClash,
} from './runModifiers'
import { issueDecree, stepDecree } from './structure'
import { storageUsed } from './queries'
import { tick } from './tick'
import { caravanAvailable, hasTradingPost, stepCaravan } from './trade'

const SEED = 20260726
const TRIO = ['human', 'beaver', 'lizard'] as const

function runWith(modifiers: string[], seed = SEED): RunState {
  const state = createRun({ seed, species: [...TRIO], modifiers })
  drain(state)
  return state
}

/** Answers every pending choice with its first affordable option. */
function drain(state: RunState): void {
  let guard = 0
  while (state.pendingChoices.length > 0 && guard++ < 20) {
    const choice = state.pendingChoices[0]
    if (choice.kind === 'gladeEvent') {
      const def = GLADE_EVENTS[choice.options[0]]
      const index = def.options.findIndex((o) => optionAffordable(state.stock, o))
      resolveGladeEvent(state, index >= 0 ? index : def.options.length - 1)
    } else {
      takeChoice(state, choice.options[0])
    }
  }
}

function simulate(state: RunState, seconds: number, step = 0.125): void {
  for (let t = 0; t < seconds; t += step) {
    tick(state, step)
    drain(state)
  }
}

/** A finished building dropped straight into the run (no placement rules). */
function stand(state: RunState, defId: string, pos = { x: 99, y: 99 }, gladeId = 'glade0') {
  const id = `test_${defId}_${Object.keys(state.buildings).length}`
  state.buildings[id] = {
    id,
    defId,
    pos,
    gladeId,
    built: true,
    buildProgress: BUILDINGS[defId].buildSeconds,
    workers: [],
    activeRecipeId: BUILDINGS[defId].recipes[0]?.id ?? '',
    recipeProgress: 0,
    paused: false,
    depositsInRange: {},
  }
  return state.buildings[id]
}

function countDeposits(
  deposits: Record<string, { kind: DepositId; gladeId: string }>,
  kind: DepositId,
  where: 'outside' | 'settlement' = 'outside',
): number {
  return Object.values(deposits).filter(
    (d) => d.kind === kind && (where === 'settlement') === (d.gladeId === 'glade0'),
  ).length
}

// ---------------------------------------------------------------------------
// Content invariants
// ---------------------------------------------------------------------------

describe('run modifier pool invariants', () => {
  it('offers ten to twelve modifiers with unique ids and something to say', () => {
    expect(RUN_MODIFIER_LIST.length).toBeGreaterThanOrEqual(10)
    expect(RUN_MODIFIER_LIST.length).toBeLessThanOrEqual(12)
    expect(new Set(RUN_MODIFIER_LIST.map((d) => d.id)).size).toBe(RUN_MODIFIER_LIST.length)
    for (const def of RUN_MODIFIER_LIST) {
      expect(def.name.length, def.id).toBeGreaterThan(0)
      expect(def.icon.length, def.id).toBeGreaterThan(0)
      expect(def.description.length, def.id).toBeGreaterThan(20)
      expect(['boon', 'bane', 'mixed']).toContain(def.tone)
    }
  })

  it('every modifier does something: map hooks, run-long effects or a starting grant', () => {
    for (const def of RUN_MODIFIER_LIST) {
      const acts =
        !!def.mapgen ||
        (def.effects?.length ?? 0) > 0 ||
        !!def.startImpatience ||
        Object.keys(def.startStock ?? {}).length > 0
      expect(acts, def.id).toBe(true)
    }
  })

  it('is mostly trade-offs rather than free boons', () => {
    const mixed = RUN_MODIFIER_LIST.filter((d) => d.tone === 'mixed').length
    expect(mixed).toBeGreaterThan(RUN_MODIFIER_LIST.length / 2)
  })

  it('names only real terrain, deposits and glade kinds in its map hooks', () => {
    const glades: GladeKind[] = ['settlement', 'small', 'dangerous', 'forbidden']
    for (const def of RUN_MODIFIER_LIST) {
      const h = def.mapgen
      if (!h) continue
      for (const [terrain, w] of Object.entries(h.themeWeights ?? {})) {
        expect(TERRAIN[terrain as TerrainId], `${def.id} terrain ${terrain}`).toBeDefined()
        expect(w, def.id).toBeGreaterThan(0)
      }
      for (const [kind, scale] of Object.entries(h.depositScale ?? {})) {
        expect(DEPOSIT_RADIUS[kind as DepositId], `${def.id} deposit ${kind}`).toBeDefined()
        expect(scale, def.id).toBeGreaterThan(0)
        // A scale of exactly 1 would be a no-op hook.
        expect(scale, def.id).not.toBe(1)
      }
      for (const [kind, scale] of Object.entries(h.rewardScale ?? {})) {
        expect(glades, `${def.id} glade kind ${kind}`).toContain(kind)
        expect(scale, def.id).toBeGreaterThan(0)
      }
      if (h.smallGladeOdds !== undefined) {
        expect(h.smallGladeOdds).toBeGreaterThanOrEqual(0)
        expect(h.smallGladeOdds).toBeLessThanOrEqual(1 / 0.45)
      }
    }
  })

  it('every run-long effect folds into the modifiers', () => {
    const neutral = JSON.stringify(emptyModifiers())
    for (const def of RUN_MODIFIER_LIST) {
      for (const effect of def.effects ?? []) {
        const state = runWith([])
        state.ongoing.push({ id: 'probe', name: 'probe', icon: '?', description: '', effects: [effect] })
        expect(JSON.stringify(computeModifiers(state)), `${def.id} ${effect.kind}`).not.toBe(neutral)
      }
    }
  })

  it('declares exclusions that are real and symmetric', () => {
    for (const def of RUN_MODIFIER_LIST) {
      for (const other of def.excludes ?? []) {
        expect(RUN_MODIFIERS[other], `${def.id} excludes ${other}`).toBeDefined()
        expect(RUN_MODIFIERS[other].excludes ?? [], `${other} excludes ${def.id}`).toContain(def.id)
      }
    }
  })

  it('keeps the opening stockpile within the starting storage', () => {
    for (const def of RUN_MODIFIER_LIST) {
      const state = createRun({ seed: SEED, species: [...TRIO], modifiers: [def.id] })
      expect(storageUsed(state), def.id).toBeLessThanOrEqual(state.storageCap)
      expect(state.impatience, def.id).toBeLessThan(state.maxImpatience)
    }
  })
})

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

describe('drawing run modifiers', () => {
  it('is deterministic from the seed and matches the run it creates', () => {
    for (const seed of [1, 7, 42, 4242, SEED, 0xffffffff]) {
      expect(drawRunModifiers(seed)).toEqual(drawRunModifiers(seed))
      expect(createRun({ seed, species: [...TRIO] }).runModifiers).toEqual(drawRunModifiers(seed))
    }
  })

  it('draws one or two known, compatible modifiers', () => {
    for (let seed = 0; seed < 300; seed++) {
      const ids = drawRunModifiers(seed)
      expect(ids.length).toBeGreaterThanOrEqual(MIN_RUN_MODIFIERS)
      expect(ids.length).toBeLessThanOrEqual(MAX_RUN_MODIFIERS)
      expect(new Set(ids).size).toBe(ids.length)
      const defs = ids.map((id) => RUN_MODIFIERS[id])
      defs.forEach((d) => expect(d).toBeDefined())
      if (defs.length === 2) expect(modifiersClash(defs[0], defs[1])).toBe(false)
    }
  })

  it('spreads across the whole pool, including for small neighbouring seeds', () => {
    const seen = new Map<string, number>()
    let pairs = 0
    for (let seed = 0; seed < 600; seed++) {
      const ids = drawRunModifiers(seed)
      if (ids.length === 2) pairs++
      for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1)
    }
    for (const def of RUN_MODIFIER_LIST) expect(seen.get(def.id) ?? 0, def.id).toBeGreaterThan(20)
    expect(pairs).toBeGreaterThan(200)
    expect(pairs).toBeLessThan(400)
    // Regression: a salt passed as a huge RNG cursor swallowed the seed's low
    // bits, so every small seed drew the same land.
    const small = [1, 7, 13, 42, 99, 123].map((s) => drawRunModifiers(s).join(','))
    expect(new Set(small).size).toBeGreaterThan(3)
  })

  it('does not disturb the map of a modifier that has no map hooks', () => {
    const plain = createRun({ seed: SEED, species: [...TRIO], modifiers: [] })
    const traders = createRun({ seed: SEED, species: [...TRIO], modifiers: ['wanderingTraders'] })
    expect(traders.deposits).toEqual(plain.deposits)
    expect(traders.glades).toEqual(plain.glades)
  })
})

// ---------------------------------------------------------------------------
// Map generation hooks
// ---------------------------------------------------------------------------

describe('map generation hooks', () => {
  const kinds: DepositId[] = ['trees', 'stoneVein', 'clayPatch', 'orePatch', 'vegetation', 'game', 'fertileSoil']

  it('scales deposit counts as declared, leaving other kinds and the opening glade alone', () => {
    for (const seed of [SEED, 4242, 777]) {
      const base = generateMap(makeRng(seed, 0))
      const scale = { stoneVein: 1.5, orePatch: 2, game: 0.5, trees: 0.75 } as const
      const hooked = generateMap(makeRng(seed, 0), { depositScale: scale })
      for (const kind of kinds) {
        const before = countDeposits(base.deposits, kind)
        const after = countDeposits(hooked.deposits, kind)
        const factor = (scale as Partial<Record<DepositId, number>>)[kind] ?? 1
        expect(after, `${seed} ${kind}`).toBe(Math.round(before * factor))
        expect(countDeposits(hooked.deposits, kind, 'settlement')).toBe(
          countDeposits(base.deposits, kind, 'settlement'),
        )
      }
      // Glades and obstacles are generated before the hook runs: unchanged.
      expect(hooked.glades).toEqual(base.glades)
      expect(hooked.obstacles).toEqual(base.obstacles)
    }
  })

  it('places added deposits inside a glade that already carries the kind, clear of everything', () => {
    const base = generateMap(makeRng(SEED, 0))
    const hooked = generateMap(makeRng(SEED, 0), { depositScale: { stoneVein: 2 } })
    const hosts = new Set(
      Object.values(base.deposits).filter((d) => d.kind === 'stoneVein').map((d) => d.gladeId),
    )
    const added = Object.values(hooked.deposits).filter((d) => !base.deposits[d.id])
    expect(added.length).toBeGreaterThan(0)
    for (const d of added) {
      expect(d.kind).toBe('stoneVein')
      expect(hosts.has(d.gladeId)).toBe(true)
      for (const other of Object.values(hooked.deposits)) {
        if (other.id === d.id) continue
        const gap = Math.hypot(other.pos.x - d.pos.x, other.pos.y - d.pos.y)
        expect(gap).toBeGreaterThanOrEqual(other.radius + d.radius - 1e-9)
      }
    }
  })

  it('thins out small glades and scales glade loot without reshaping the map', () => {
    const base = generateMap(makeRng(SEED, 0))
    const ruined = generateMap(makeRng(SEED, 0), {
      smallGladeOdds: 0,
      rewardScale: { dangerous: 2 },
    })
    const small = (m: typeof base) => Object.values(m.glades).filter((g) => g.kind === 'small').length
    expect(small(base)).toBeGreaterThan(0)
    expect(small(ruined)).toBe(0)
    // Same skeleton: the RNG is consumed exactly as before.
    expect(Object.keys(ruined.glades)).toEqual(Object.keys(base.glades))
    for (const glade of Object.values(ruined.glades)) {
      expect(glade.polygon).toEqual(base.glades[glade.id].polygon)
      if (glade.kind === 'dangerous' && base.glades[glade.id].kind === 'dangerous') {
        for (const [id, amount] of Object.entries(base.glades[glade.id].reward)) {
          expect(glade.reward[id as keyof typeof glade.reward]).toBe(Math.round((amount ?? 0) * 2))
        }
      }
    }
  })

  it('weights glade themes by terrain', () => {
    let marshBase = 0
    let marshHooked = 0
    for (let seed = 1; seed <= 12; seed++) {
      const terrains = (m: ReturnType<typeof generateMap>) =>
        Object.values(m.glades).filter((g) => g.terrain === 'marsh').length
      marshBase += terrains(generateMap(makeRng(seed, 0)))
      marshHooked += terrains(generateMap(makeRng(seed, 0), { themeWeights: { marsh: 6 } }))
    }
    expect(marshHooked).toBeGreaterThan(marshBase * 2)
  })

  it('combines the hooks of every drawn modifier', () => {
    const hooks = mapgenHooksFor(['richVeins', 'sparseGame', 'ancientRuins', 'unknownOldId'])
    expect(hooks.depositScale).toEqual({ stoneVein: 1.5, orePatch: 2, game: 0.5 })
    expect(hooks.smallGladeOdds).toBe(0.5)
    expect(hooks.rewardScale).toEqual({ dangerous: 1.5, forbidden: 1.5 })
    expect(mapgenHooksFor([])).toEqual({})
  })

  it('a run drawn with Rich Veins really has more stone than without', () => {
    const plain = createRun({ seed: SEED, species: [...TRIO], modifiers: [] })
    const rich = createRun({ seed: SEED, species: [...TRIO], modifiers: ['richVeins'] })
    expect(countDeposits(rich.deposits, 'stoneVein')).toBeGreaterThan(
      countDeposits(plain.deposits, 'stoneVein'),
    )
  })
})

// ---------------------------------------------------------------------------
// Run-long effects
// ---------------------------------------------------------------------------

describe('run modifier effects', () => {
  it('records effects as ongoing entries that fold into the modifiers', () => {
    const state = runWith(['restlessForest', 'longStorms'])
    expect(state.runModifiers).toEqual(['restlessForest', 'longStorms'])
    expect(state.ongoing.map((o) => o.id)).toEqual(
      expect.arrayContaining([modifierOngoingId('restlessForest'), modifierOngoingId('longStorms')]),
    )
    const mods = computeModifiers(state)
    expect(mods.hostilityRate).toBeCloseTo(1.2)
    expect(mods.gladeLoot).toBeCloseTo(1.3)
    expect(mods.seasonLength.storm).toBeCloseTo(1.25)
    expect(mods.seasonProduction.clearance).toBeCloseTo(0.2)
  })

  it('a map-only modifier adds no ongoing entry', () => {
    const state = runWith(['richVeins'])
    expect(state.ongoing).toEqual([])
    expect(state.runModifiers).toEqual(['richVeins'])
  })

  it('Long Storms lengthens every Storm, and Clearance works faster', () => {
    const state = runWith(['longStorms'])
    state.season = { year: 2, season: 'clearance', elapsed: 0, length: SEASON_LENGTH.clearance }
    const mods = computeModifiers(state)
    expect(seasonMultiplier('lumberMill', 'clearance', mods)).toBeCloseTo(1.2)
    expect(seasonMultiplier('lumberMill', 'drizzle', mods)).toBe(1)
    state.season.elapsed = SEASON_LENGTH.clearance - 0.1
    tick(state, 0.125)
    expect(state.season.season).toBe('storm')
    expect(state.season.length).toBeCloseTo(SEASON_LENGTH.storm * 1.25)
  })

  it('Early Frost brings the first Storm sooner, then the seasons settle', () => {
    const plain = runWith([])
    const frost = runWith(['earlyFrost'])
    expect(frost.stock.wood).toBe((plain.stock.wood ?? 0) + 10)
    expect(frost.season.length).toBeLessThan(plain.season.length)
    expect(secondsUntilStorm(frost)!).toBeLessThan(secondsUntilStorm(plain)! * 0.75)
    // Year 2 is a normal year.
    frost.season = { year: 1, season: 'storm', elapsed: SEASON_LENGTH.storm - 0.05, length: SEASON_LENGTH.storm }
    frost.stock.wood = 50
    tick(frost, 0.125)
    expect(frost.season).toMatchObject({ year: 2, season: 'drizzle', length: SEASON_LENGTH.drizzle })
  })

  it('Ill Omens starts the Queen impatient, and orders pay an extra point', () => {
    const state = runWith(['illOmens'])
    expect(state.impatience).toBe(2)
    state.orders = [{ id: 'probe', defId: 'stock_plank_30', progress: 0, complete: false }]
    state.stock.plank = 30
    const before = state.reputation
    stepOrders(state)
    expect(state.reputation - before).toBe(2)
  })

  it('Wandering Traders brings caravans without a Trading Post, less often', () => {
    const state = runWith(['wanderingTraders'])
    expect(hasTradingPost(state)).toBe(false)
    expect(caravanAvailable(state)).toBe(true)
    state.caravan.timer = 1
    stepCaravan(state, 2)
    expect(state.caravan.here).toBe(true)
    state.caravan.timer = 0.5
    stepCaravan(state, 1)
    expect(state.caravan.here).toBe(false)
    expect(state.caravan.timer).toBeCloseTo(CARAVAN_INTERVAL * 1.4)
    expect(caravanAvailable(runWith([]))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The new effect kinds, as cornerstones use them
// ---------------------------------------------------------------------------

describe('rule-bending cornerstones for braziers, terrain, adjacency, decrees and seasons', () => {
  const withCornerstone = (id: string) => {
    expect(CORNERSTONES[id], id).toBeDefined()
    const state = runWith([])
    // Only this cornerstone: the opening pick would muddy the comparison.
    state.cornerstones = [id]
    return state
  }

  it('Everburning Braziers keep braziers lit without wood', () => {
    const plain = runWith([])
    const lit = withCornerstone('everburningBraziers')
    for (const state of [plain, lit]) {
      stand(state, 'brazier', { x: 3, y: 0 })
      state.season = { year: 1, season: 'storm', elapsed: 0, length: SEASON_LENGTH.storm }
      state.stock.wood = 30
    }
    expect(hearthForecast(plain, computeModifiers(plain)).stormRate).toBeGreaterThan(
      HEARTH_FUEL_PER_SECOND,
    )
    const litMods = computeModifiers(lit)
    expect(hearthForecast(lit, litMods).stormRate).toBeCloseTo(HEARTH_FUEL_PER_SECOND * litMods.hearthFuel)
    tick(plain, 1)
    tick(lit, 1)
    expect(lit.stock.wood ?? 0).toBeGreaterThan(plain.stock.wood ?? 0)
    expect(Object.values(lit.buildings).find((b) => b.defId === 'brazier')!.unlit).toBe(false)
  })

  it('Stilt Foundations and the Geomancers blunt bad ground; the Surveyor sharpens good ground', () => {
    const mods = (id: string) => computeModifiers(withCornerstone(id))
    const neutral = emptyModifiers()
    // Marsh slows construction by 20%.
    expect(terrainBuildMultiplier('cabin', 'marsh', neutral)).toBeCloseTo(0.8)
    expect(terrainBuildMultiplier('cabin', 'marsh', mods('stiltFoundations'))).toBeCloseTo(0.9)
    expect(terrainBuildMultiplier('cabin', 'marsh', mods('geomancersCompact'))).toBeCloseTo(1)
    // Fertile ground speeds farms by 25%.
    expect(terrainWorkMultiplier('smallFarm', 'fertile', mods('surveyorsEye'))).toBeCloseTo(1.375)
    expect(terrainWorkMultiplier('smallFarm', 'fertile', mods('stiltFoundations'))).toBeCloseTo(1.25)
  })

  it('Guild Quarters strengthen adjacency work-speed bonuses', () => {
    const state = runWith([])
    const camp = stand(state, 'woodcuttersCamp', { x: 4, y: 0 })
    const mill = stand(state, 'lumberMill', { x: 5.5, y: 0 })
    expect(camp.built && mill.built).toBe(true)
    const base = adjacencyMultiplier(state, mill, computeModifiers(state))
    expect(base).toBeGreaterThan(1)
    state.cornerstones.push('guildQuarters')
    const boosted = adjacencyMultiplier(state, mill, computeModifiers(state))
    expect(boosted - 1).toBeCloseTo((base - 1) * 1.5)
  })

  it('Royal Couriers lengthen decrees and soften a miss; the Crown’s Seal pays more', () => {
    const state = withCornerstone('royalCouriers')
    expect(issueDecree(state)).toBe(true)
    const def = DECREES[state.decree!.defId]
    expect(state.decree!.timeLimit).toBe(Math.round(def.timeLimit * 1.3))
    state.decree!.timeLeft = 0.1
    const before = state.impatience + state.impatienceProgress
    stepDecree(state, 1)
    expect(state.impatience + state.impatienceProgress - before).toBeCloseTo(DECREE_MISS_IMPATIENCE / 2)

    const sealed = withCornerstone('crownSeal')
    sealed.decree = {
      id: 'probe',
      defId: 'decree_glade',
      progress: 0,
      complete: false,
      timeLeft: 100,
      timeLimit: 100,
      baseline: sealed.stats.gladesCleared - 1,
    }
    const rep = sealed.reputation
    stepDecree(sealed, 0.125)
    expect(sealed.reputation - rep).toBe(DECREES.decree_glade.reputationReward + 1)
  })

  it('the Almanac of Clear Skies stretches Clearance and shortens the Storm', () => {
    const mods = computeModifiers(withCornerstone('clearSkiesAlmanac'))
    expect(mods.seasonLength.clearance).toBeCloseTo(1.25)
    expect(mods.seasonLength.storm).toBeCloseTo(0.9)
  })
})

// ---------------------------------------------------------------------------
// Persistence and history
// ---------------------------------------------------------------------------

describe('run modifiers across saves and the ledger', () => {
  it('survives a save/load round trip and evolves identically', () => {
    const original = runWith(['earlyFrost', 'sparseGame'])
    simulate(original, 90)
    const restored = JSON.parse(JSON.stringify(original)) as RunState
    expect(restored.runModifiers).toEqual(['earlyFrost', 'sparseGame'])
    simulate(original, 120)
    simulate(restored, 120)
    expect(restored.season).toEqual(original.season)
    expect(restored.stock).toEqual(original.stock)
    expect(restored.rngCursor).toBe(original.rngCursor)
    expect(computeModifiers(restored)).toEqual(computeModifiers(original))
  })

  it('old saves load with an empty list', () => {
    const legacy = JSON.parse(JSON.stringify(runWith([]))) as Partial<RunState>
    delete legacy.runModifiers
    const store = new Map<string, string>([['emberwatch.run.v1', JSON.stringify(legacy)]])
    const original = globalThis.localStorage
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage
    try {
      const loaded = loadRun()!
      expect(loaded.runModifiers).toEqual([])
      tick(loaded, 0.125)
      expect(loaded.phase).toBe('playing')
    } finally {
      globalThis.localStorage = original
    }
  })

  it('records the drawn modifiers in run history, and migration keeps them', () => {
    const state = runWith(['richVeins', 'illOmens'])
    state.phase = 'won'
    const meta = bankRun(defaultMeta(), state, 1000)
    expect(meta.history[0].modifiers).toEqual(['richVeins', 'illOmens'])
    const migrated = migrateMeta(JSON.parse(JSON.stringify(meta)))
    expect(migrated.history[0].modifiers).toEqual(['richVeins', 'illOmens'])
    // Entries from before modifiers stay without the field.
    const old = migrateMeta({ ...meta, history: [{ seed: 5, won: true, years: 2, reputation: 3, at: 1 }] })
    expect(old.history[0].modifiers).toBeUndefined()
  })

  it('leaves the starting stock alone unless a modifier grants some', () => {
    expect(createRun({ seed: SEED, species: [...TRIO], modifiers: ['richVeins'] }).stock).toEqual(
      STARTING_STOCK,
    )
  })
})

describe('the first royal decree on modified land', () => {
  it('still arrives as Year 2 opens when Year 1 is longer or shorter', () => {
    for (const modifiers of [['longStorms'], ['earlyFrost'], []]) {
      const state = runWith(modifiers)
      // A decree cornerstone shapes the decree itself, not when it comes.
      state.cornerstones = ['royalCouriers']
      while (state.season.year === 1) {
        tick(state, 0.125)
        state.pendingChoices = []
        if (state.season.year === 1) expect(state.decree, `${modifiers} Y1 ${state.clock}`).toBeNull()
      }
      for (let i = 0; i < 4 && !state.decree; i++) tick(state, 0.125)
      expect(state.decree, `${modifiers}`).not.toBeNull()
      expect(state.season).toMatchObject({ year: 2, season: 'drizzle' })
      const def = DECREES[state.decree!.defId]
      expect(state.decree!.timeLimit).toBe(Math.round(def.timeLimit * 1.3))
    }
  })
})
