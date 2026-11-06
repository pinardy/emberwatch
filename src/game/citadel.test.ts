import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CORNERSTONES, CORNERSTONE_LIST } from './content/cornerstones'
import { GLADE_EVENT_LIST } from './content/gladeEvents'
import {
  CITADEL_EVENT_OPTIONS,
  EDICTS,
  MAX_EDICT,
  META_UPGRADES,
  META_UPGRADE_LIST,
  META_VERSION,
  bankRun,
  citadelLoadout,
  defaultMeta,
  migrateMeta,
  purchaseUpgrade,
  supplyBreakdown,
  supplyReward,
} from './content/meta'
import { BUILDINGS } from './content/buildings'
import {
  MAX_IMPATIENCE,
  MAX_REPUTATION,
  OPENING_BLUEPRINT_PICKS,
  REROLL_BASE_COST,
  STARTING_STOCK,
  STARTING_VILLAGERS,
} from './engine/balance'
import { BASE_DRAFT_OPTIONS, cornerstonePool, gladeEventOptions } from './engine/citadel'
import { createRun } from './engine/createRun'
import {
  offerBlueprint,
  optionAffordable,
  offerCornerstone,
  rerollChoice,
  rerollCost,
  resolveGladeEvent,
  takeChoice,
} from './engine/events'
import { computeModifiers } from './engine/modifiers'
import { loadMeta, loadRun, saveMeta, saveRun } from './persistence'
import { useGameStore } from './store'
import type { MetaState, RunState } from './types'

const SEED = 9001
const SPECIES = ['human', 'beaver', 'lizard'] as const

function metaWith(upgrades: string[], extra: Partial<MetaState> = {}): MetaState {
  return { ...defaultMeta(), upgrades, ...extra }
}

/** Owns `id` and everything it transitively requires. */
function withPrereqs(...ids: string[]): string[] {
  const out = new Set<string>()
  const visit = (id: string) => {
    if (out.has(id)) return
    for (const req of META_UPGRADES[id]?.requires ?? []) visit(req)
    out.add(id)
  }
  ids.forEach(visit)
  return [...out]
}

function run(opts: { upgrades?: string[]; edict?: number } = {}): RunState {
  return createRun({
    seed: SEED,
    species: [...SPECIES],
    // Citadel and edict effects are measured against an unmodified land.
    modifiers: [],
    meta: opts.upgrades ? metaWith(opts.upgrades) : undefined,
    edict: opts.edict,
  })
}

/** A minimal in-memory localStorage for the node test environment. */
function stubStorage() {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  })
  return data
}

// ---------------------------------------------------------------------------

describe('citadel content', () => {
  it('keeps the five original upgrade ids so v1 saves stay valid', () => {
    for (const id of ['deeperStores', 'travelRations', 'unlockHarpy', 'unlockFox', 'citadelBlessing']) {
      expect(META_UPGRADES[id]).toBeDefined()
    }
    expect(META_UPGRADE_LIST.length).toBeGreaterThanOrEqual(15)
  })

  it('has prerequisites that exist and never form a cycle', () => {
    const ids = new Set(META_UPGRADE_LIST.map((d) => d.id))
    for (const def of META_UPGRADE_LIST) {
      for (const req of def.requires ?? []) expect(ids.has(req)).toBe(true)
      // withPrereqs would recurse forever on a cycle; a bounded result proves none.
      expect(withPrereqs(def.id).length).toBeLessThanOrEqual(META_UPGRADE_LIST.length)
    }
  })

  it('only references cornerstones, blueprints and event options that exist', () => {
    const all = citadelLoadout(META_UPGRADE_LIST.map((d) => d.id))
    for (const id of [...all.perks.cornerstones, ...all.startCornerstones]) {
      expect(CORNERSTONES[id], id).toBeDefined()
    }
    for (const id of all.perks.cornerstones) expect(CORNERSTONES[id].citadelLocked).toBe(true)
    for (const id of all.startBlueprints) expect(BUILDINGS[id], id).toBeDefined()
    for (const id of all.perks.eventOptions) expect(CITADEL_EVENT_OPTIONS[id], id).toBeDefined()
  })

  it('every Citadel-locked cornerstone can be unlocked by some upgrade', () => {
    const unlockable = citadelLoadout(META_UPGRADE_LIST.map((d) => d.id)).perks.cornerstones
    for (const def of CORNERSTONE_LIST.filter((c) => c.citadelLocked)) {
      expect(unlockable).toContain(def.id)
    }
  })
})

describe('meta migration', () => {
  const v1 = {
    version: 1,
    citadelSupplies: 17,
    runsWon: 2,
    runsLost: 5,
    unlockedSpecies: ['harpy'],
    upgrades: ['deeperStores', 'unlockHarpy', 'travelRations'],
    history: [
      { seed: 11, won: true, years: 4, reputation: 20, at: 1000 },
      { seed: 12, won: false, years: 3, reputation: 9, at: 900 },
    ],
  }

  it('upgrades a v1 save without losing supplies, upgrades or history', () => {
    const meta = migrateMeta(structuredClone(v1))
    expect(meta.version).toBe(META_VERSION)
    expect(meta.citadelSupplies).toBe(17)
    expect(meta.runsWon).toBe(2)
    expect(meta.runsLost).toBe(5)
    expect(meta.upgrades).toEqual(['deeperStores', 'unlockHarpy', 'travelRations'])
    expect(meta.unlockedSpecies).toEqual(['harpy'])
    expect(meta.history).toHaveLength(2)
    expect(meta.history[0]).toMatchObject({ seed: 11, won: true, years: 4, reputation: 20 })
  })

  it('credits v1 wins with the first edict', () => {
    expect(migrateMeta(structuredClone(v1)).edictUnlocked).toBe(1)
    expect(migrateMeta({ ...v1, runsWon: 0, history: [] }).edictUnlocked).toBe(0)
  })

  it('re-derives charter species and tolerates corrupt fields', () => {
    const meta = migrateMeta({
      version: 1,
      citadelSupplies: 'lots',
      upgrades: ['unlockFox', 42, 'unlockFox'],
      unlockedSpecies: ['dragon'],
      history: [null, { seed: 'x' }, { seed: 5, won: true, years: 2, reputation: 3, at: 1 }],
    })
    expect(meta.citadelSupplies).toBe(0)
    expect(meta.upgrades).toEqual(['unlockFox'])
    expect(meta.unlockedSpecies).toEqual(['fox'])
    expect(meta.history).toHaveLength(1)
  })

  it('falls back to a fresh meta for garbage', () => {
    expect(migrateMeta(null)).toEqual(defaultMeta())
    expect(migrateMeta('nope')).toEqual(defaultMeta())
  })

  it('is idempotent on a current save', () => {
    const current = bankRun(defaultMeta(), wonRun(2), 5)
    expect(migrateMeta(structuredClone(current))).toEqual(current)
  })

  describe('through localStorage', () => {
    beforeEach(() => {
      stubStorage()
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('loads a v1 meta save instead of discarding it', () => {
      localStorage.setItem('emberwatch.meta.v1', JSON.stringify(v1))
      const meta = loadMeta()
      expect(meta.version).toBe(META_VERSION)
      expect(meta.citadelSupplies).toBe(17)
      expect(meta.upgrades).toContain('unlockHarpy')
      saveMeta(meta)
      expect(loadMeta()).toEqual(meta)
    })

    it('loads a run saved before edicts and Citadel perks existed', () => {
      const old = run() as Partial<RunState>
      delete old.edict
      delete old.citadel
      saveRun(old as RunState)
      const loaded = loadRun()
      expect(loaded).not.toBeNull()
      expect(loaded!.edict).toBe(0)
      expect(loaded!.citadel).toEqual({
        blueprintOptions: 0,
        cornerstoneOptions: 0,
        freeRerolls: 0,
        cornerstones: [],
        eventOptions: [],
      })
      expect(rerollCost(loaded!)).toBeGreaterThan(0)
    })
  })
})

describe('buying upgrades', () => {
  it('refuses an upgrade whose prerequisites are missing', () => {
    const meta = metaWith([], { citadelSupplies: 100 })
    const result = purchaseUpgrade(meta, 'broaderArchives')
    expect(result.meta).toBeNull()
    expect(result.error).toMatch(/Surveyor's Notes/)
  })

  it('needs every prerequisite of a multi-parent upgrade', () => {
    const partial = metaWith(withPrereqs('viceroysSignet'), { citadelSupplies: 100 })
    expect(purchaseUpgrade(partial, 'royalArchive').meta).toBeNull()
    const full = metaWith(withPrereqs('viceroysSignet', 'masonsArchive'), {
      citadelSupplies: 100,
    })
    expect(purchaseUpgrade(full, 'royalArchive').meta?.upgrades).toContain('royalArchive')
  })

  it('charges the cost, unlocks species, and never mutates the input', () => {
    const meta = metaWith([], { citadelSupplies: 6 })
    const result = purchaseUpgrade(meta, 'unlockHarpy')
    expect(result.meta?.citadelSupplies).toBe(1)
    expect(result.meta?.unlockedSpecies).toEqual(['harpy'])
    expect(meta.upgrades).toEqual([])
    expect(purchaseUpgrade(result.meta!, 'unlockHarpy').error).toBe('Already unlocked.')
    expect(purchaseUpgrade(metaWith([]), 'unlockHarpy').error).toMatch(/supplies/)
  })

  it('enforces prerequisites through the store', () => {
    stubStorage()
    try {
      useGameStore.setState({ meta: metaWith([], { citadelSupplies: 50 }) })
      useGameStore.getState().buyUpgrade('secondThoughts')
      expect(useGameStore.getState().meta.upgrades).toEqual([])
      expect(useGameStore.getState().notice).toMatch(/Requires/)
      useGameStore.getState().buyUpgrade('surveyorsNotes')
      useGameStore.getState().buyUpgrade('secondThoughts')
      expect(useGameStore.getState().meta.upgrades).toEqual(['surveyorsNotes', 'secondThoughts'])
      expect(useGameStore.getState().meta.citadelSupplies).toBe(50 - 4 - 5)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('Queen’s Edicts in createRun', () => {
  it('records the edict on the run and changes nothing at level 0', () => {
    const base = run()
    expect(base.edict).toBe(0)
    expect(base.stock).toEqual(STARTING_STOCK)
    expect(base.maxImpatience).toBe(MAX_IMPATIENCE)
    expect(base.maxReputation).toBe(MAX_REPUTATION)
    expect(base.ongoing).toEqual([])
    expect(run({ edict: 0 })).toEqual(base)
  })

  it('stacks every edict up to the chosen level', () => {
    const base = run()
    const top = run({ edict: MAX_EDICT })
    expect(top.edict).toBe(MAX_EDICT)
    expect(top.stock.wood).toBeLessThan(base.stock.wood!)
    expect(top.maxImpatience).toBeLessThan(base.maxImpatience)
    expect(top.maxReputation).toBeGreaterThan(base.maxReputation)
    expect(Object.keys(top.villagers).length).toBeLessThan(STARTING_VILLAGERS)

    const mods = computeModifiers(top)
    const baseMods = computeModifiers(base)
    expect(mods.impatienceRate).toBeGreaterThan(baseMods.impatienceRate)
    expect(mods.hostilityRate).toBeGreaterThan(baseMods.hostilityRate)
    expect(mods.hearthFuel).toBeGreaterThan(baseMods.hearthFuel)
    expect(mods.stormResolve).toBeLessThan(baseMods.stormResolve)
    expect(top.ongoing.find((o) => o.id === 'edict')).toBeDefined()
  })

  it('applies only the edicts at or below the level', () => {
    const first = run({ edict: 1 })
    expect(computeModifiers(first).impatienceRate).toBeCloseTo(1.15)
    // Lean Provisions is edict II, so edict I keeps the full stockpile.
    expect(first.stock).toEqual(STARTING_STOCK)
    expect(run({ edict: 2 }).stock.wood).toBe(Math.round(STARTING_STOCK.wood * 0.7))
    expect(EDICTS.map((d) => d.level)).toEqual(EDICTS.map((_, i) => i + 1))
  })

  it('clamps out-of-range levels', () => {
    expect(run({ edict: 99 }).edict).toBe(MAX_EDICT)
    expect(run({ edict: -3 }).edict).toBe(0)
  })

  it('cannot start above the edict the Citadel has earned', async () => {
    stubStorage()
    try {
      useGameStore.setState({ meta: { ...defaultMeta(), edictUnlocked: 2 } })
      await useGameStore.getState().startRun(SEED, [...SPECIES], 5)
      expect(useGameStore.getState().run?.edict).toBe(2)
    } finally {
      useGameStore.setState({ run: null, screen: 'menu' })
      vi.unstubAllGlobals()
    }
  })
})

describe('Citadel upgrades in createRun', () => {
  it('applies the original provisions and blessing', () => {
    const s = run({ upgrades: ['deeperStores', 'travelRations', 'citadelBlessing'] })
    expect(s.stock.wood).toBe(STARTING_STOCK.wood + 20)
    expect(s.stock.biscuit).toBe(15)
    expect(s.cornerstones).toEqual(['campfireTales'])
  })

  it('widens the opening: extra villagers, blueprints, picks and a cornerstone draft', () => {
    const s = run({
      upgrades: withPrereqs('secondWagon', 'merchantCharter', 'surveyorsNotes', 'viceroysSignet'),
    })
    expect(Object.keys(s.villagers)).toHaveLength(STARTING_VILLAGERS + 2)
    expect(s.unlockedBuildings).toContain('tradingPost')
    const kinds = s.pendingChoices.map((c) => c.kind)
    expect(kinds.filter((k) => k === 'blueprint')).toHaveLength(OPENING_BLUEPRINT_PICKS + 1)
    expect(kinds[kinds.length - 1]).toBe('cornerstone')
  })

  it('offers one more option in blueprint and cornerstone drafts', () => {
    const s = run({ upgrades: withPrereqs('broaderArchives', 'royalArchive') })
    expect(s.pendingChoices[0].options).toHaveLength(BASE_DRAFT_OPTIONS + 1)
    s.pendingChoices.length = 0
    offerCornerstone(s)
    expect(s.pendingChoices[0].options).toHaveLength(BASE_DRAFT_OPTIONS + 1)
    s.pendingChoices.length = 0
    offerBlueprint(s)
    expect(s.pendingChoices[0].options).toHaveLength(BASE_DRAFT_OPTIONS + 1)
  })

  it('gives a free reroll that neither costs amber nor steepens the price', () => {
    const s = run({ upgrades: withPrereqs('secondThoughts') })
    const amber = s.stock.amber
    expect(rerollCost(s)).toBe(0)
    expect(rerollChoice(s)).toBeNull()
    expect(s.stock.amber).toBe(amber)
    expect(s.rerollsUsed).toBe(0)
    expect(s.citadel.freeRerolls).toBe(0)
    expect(rerollCost(s)).toBe(REROLL_BASE_COST)
  })
})

describe('cornerstone pool', () => {
  const locked = CORNERSTONE_LIST.filter((c) => c.citadelLocked).map((c) => c.id)

  it('keeps Citadel-locked cornerstones out of a run without the archive', () => {
    expect(locked.length).toBeGreaterThan(0)
    const s = run()
    expect(cornerstonePool(s).some((c) => locked.includes(c.id))).toBe(false)
    // Draw every cornerstone the run can offer: none of them is locked.
    for (let i = 0; i < 200; i++) {
      s.pendingChoices.length = 0
      offerCornerstone(s)
      const choice = s.pendingChoices[0]
      if (!choice) break
      for (const id of choice.options) expect(locked).not.toContain(id)
      takeChoice(s, choice.options[0])
    }
    // Species cornerstones are only offered when that species is present.
    const absent = CORNERSTONE_LIST.filter(
      (c) => !c.citadelLocked && c.species && !s.speciesPool.includes(c.species),
    )
    expect(absent.length).toBeGreaterThan(0)
    expect(s.cornerstones.length).toBe(CORNERSTONE_LIST.length - locked.length - absent.length)
  })

  it('admits exactly the cornerstones the Citadel unlocked', () => {
    const s = run({ upgrades: withPrereqs('masonsArchive') })
    const pool = cornerstonePool(s).map((c) => c.id)
    expect(pool).toContain('citadelMasons')
    expect(pool).toContain('wayfarersLedger')
    expect(pool).not.toContain('royalMandate')
    expect(pool).not.toContain('stormwardens')
  })
})

describe('Citadel glade-event options', () => {
  it('appends options after the originals and resolves them', () => {
    const s = run({ upgrades: withPrereqs('forestLore') })
    const def = GLADE_EVENT_LIST[0]
    const options = gladeEventOptions(s, def)
    expect(options.slice(0, def.options.length)).toEqual(def.options)
    expect(options[options.length - 1]).toBe(CITADEL_EVENT_OPTIONS.studySigns)
    expect(gladeEventOptions(run(), def)).toBe(def.options)

    s.pendingChoices = [{ kind: 'gladeEvent', options: [def.id], gladeId: 'glade0' }]
    const reputation = s.reputation
    const hostility = s.hostility
    resolveGladeEvent(s, options.length - 1)
    expect(s.reputation).toBe(reputation + 1)
    expect(s.hostility).toBe(hostility + 6)
    expect(s.pendingChoices).toHaveLength(0)
  })

  it('gates the paid wardens option on amber like any other option', () => {
    const s = run({ upgrades: ['wardensWrit'] })
    const def = GLADE_EVENT_LIST[0]
    const index = gladeEventOptions(s, def).length - 1
    expect(gladeEventOptions(s, def)[index]).toBe(CITADEL_EVENT_OPTIONS.callWardens)

    s.stock.amber = 10
    expect(optionAffordable(s.stock, CITADEL_EVENT_OPTIONS.callWardens)).toBe(false)
    s.pendingChoices = [{ kind: 'gladeEvent', options: [def.id], gladeId: 'glade0' }]
    resolveGladeEvent(s, index)
    expect(s.pendingChoices).toHaveLength(1)

    s.stock.amber = 30
    s.hostility = 10
    expect(optionAffordable(s.stock, CITADEL_EVENT_OPTIONS.callWardens)).toBe(true)
    resolveGladeEvent(s, index)
    expect(s.pendingChoices).toHaveLength(0)
    expect(s.stock.amber).toBe(5)
    expect(s.hostility).toBe(6)
  })

  it('ignores an extra option the run does not have', () => {
    const s = run()
    const def = GLADE_EVENT_LIST[0]
    s.pendingChoices = [{ kind: 'gladeEvent', options: [def.id], gladeId: 'glade0' }]
    resolveGladeEvent(s, def.options.length)
    expect(s.pendingChoices).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------

function finished(phase: 'won' | 'lost', edict: number, patch: Partial<RunState> = {}) {
  const s = run({ edict })
  s.phase = phase
  Object.assign(s, patch)
  return s
}

function wonRun(edict: number): RunState {
  const s = finished('won', edict, { reputation: 20 })
  s.season.year = 4
  s.stats.gladesCleared = 10
  s.stats.ordersCompleted = 6
  return s
}

describe('supply rewards', () => {
  it('pays a decent loss a meaningful share of a win', () => {
    const loss = finished('lost', 0, { reputation: 12 })
    loss.season.year = 4
    loss.stats.gladesCleared = 8
    loss.stats.ordersCompleted = 4
    const win = wonRun(0)
    expect(supplyReward(loss)).toBeGreaterThanOrEqual(12)
    expect(supplyReward(loss)).toBeGreaterThan(supplyReward(win) / 2)
    expect(supplyReward(win)).toBeGreaterThan(supplyReward(loss))
    expect(supplyReward(finished('lost', 0))).toBeGreaterThan(0)
  })

  it('itemises the payout and scales it with the edict', () => {
    const plain = supplyBreakdown(wonRun(0))
    const hard = supplyBreakdown(wonRun(4))
    expect(plain.lines.reduce((n, l) => n + l.amount, 0)).toBe(plain.subtotal)
    expect(plain.edictBonus).toBe(0)
    expect(hard.subtotal).toBe(plain.subtotal)
    expect(hard.edictBonus).toBe(Math.round(plain.subtotal * 0.25 * 4))
    expect(hard.total).toBe(hard.subtotal + hard.edictBonus)
  })

  it('banks the run, records its edict and species, and unlocks the next rung on a win', () => {
    const meta = { ...defaultMeta(), edictUnlocked: 2 }
    const won = bankRun(meta, wonRun(2), 1234)
    expect(won.edictUnlocked).toBe(3)
    expect(won.runsWon).toBe(1)
    expect(won.citadelSupplies).toBe(supplyReward(wonRun(2)))
    expect(won.history[0]).toMatchObject({
      seed: SEED,
      won: true,
      edict: 2,
      species: [...SPECIES],
      at: 1234,
    })
    // Winning below the top rung, or losing at it, unlocks nothing.
    expect(bankRun(meta, wonRun(1)).edictUnlocked).toBe(2)
    expect(bankRun(meta, finished('lost', 2)).edictUnlocked).toBe(2)
    expect(bankRun({ ...meta, edictUnlocked: MAX_EDICT }, wonRun(MAX_EDICT)).edictUnlocked).toBe(
      MAX_EDICT,
    )
  })
})
