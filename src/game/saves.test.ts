import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultMeta } from './content/meta'
import { createRun } from './engine/createRun'
import { tick } from './engine/tick'
import { loadRun } from './persistence'
import {
  MAX_SAVE_FILE_BYTES,
  SAVE_FILE_FORMAT,
  SAVE_FILE_VERSION,
  buildSaveFile,
  parseSaveFile,
  parseUntrustedJson,
  saveFileText,
} from './saveFile'
import {
  SLOT_IDS,
  SLOT_INDEX_KEY,
  deleteSlot,
  freeSlot,
  latestSlot,
  listSlots,
  loadSlot,
  saveToSlot,
  slotKey,
} from './saveSlots'
import { useGameStore } from './store'
import type { RunState } from './types'

/**
 * An in-memory localStorage for the node environment. `quotaBytes` makes
 * `setItem` throw the way a full browser store does.
 */
function stubStorage(opts: { quotaBytes?: number } = {}) {
  const data = new Map<string, string>()
  const used = () => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0)
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const value = String(v)
      if (
        opts.quotaBytes !== undefined &&
        used() - (data.get(k)?.length ?? 0) + value.length > opts.quotaBytes
      ) {
        const error = new Error('The quota has been exceeded.')
        error.name = 'QuotaExceededError'
        throw error
      }
      data.set(k, value)
    },
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  }
  vi.stubGlobal('localStorage', storage)
  return { data, storage, opts }
}

function newRun(seed = 4242): RunState {
  return createRun({ seed, meta: defaultMeta() })
}

/** A run that has been played a little, so it is not just a fresh map. */
function playedRun(seed = 4242): RunState {
  const run = newRun(seed)
  run.pendingChoices = []
  for (let i = 0; i < 400; i++) tick(run, 0.125)
  return run
}

/** A well-formed save file, as a plain object to tamper with. */
const valid = () => buildSaveFile(newRun(21)) as unknown as Record<string, unknown>

function resetStore() {
  useGameStore.setState({
    screen: 'menu',
    run: null,
    activeSlot: null,
    speed: 0,
    notice: null,
    meta: defaultMeta(),
  })
}

let storage: ReturnType<typeof stubStorage>
beforeEach(() => {
  storage = stubStorage()
  resetStore()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('save slot index', () => {
  it('starts with four empty slots, autosave first', () => {
    const slots = listSlots()
    expect(slots.map((s) => s.id)).toEqual(['auto', '1', '2', '3'])
    expect(slots.every((s) => s.meta === null)).toBe(true)
    expect(freeSlot()).toBe('auto')
    expect(latestSlot()).toBeNull()
  })

  it('records what the load screen shows for each slot', () => {
    const run = playedRun()
    run.reputation = 7
    run.impatience = 3
    run.edict = 2
    expect(saveToSlot('2', run, 1_000)).toEqual({ ok: true })
    expect(storage.data.has(slotKey('2'))).toBe(true)
    const meta = listSlots().find((s) => s.id === '2')!.meta!
    expect(meta).toMatchObject({
      seed: run.seed,
      species: run.speciesPool,
      edict: 2,
      year: run.season.year,
      season: run.season.season,
      phase: 'playing',
      reputation: 7,
      maxReputation: run.maxReputation,
      impatience: 3,
      maxImpatience: run.maxImpatience,
      runModifiers: run.runModifiers,
      savedAt: 1_000,
    })
    // The index is small: listing never needs the 50 KB save itself.
    expect(storage.data.get(SLOT_INDEX_KEY)!.length).toBeLessThan(2_000)
    expect(freeSlot()).toBe('auto')
  })

  it('continues the most recently played slot', () => {
    saveToSlot('auto', newRun(1), 100)
    saveToSlot('3', newRun(3), 300)
    saveToSlot('1', newRun(2), 200)
    expect(latestSlot()).toBe('3')
    expect(loadSlot('3')!.seed).toBe(3)
    saveToSlot('auto', newRun(1), 400)
    expect(latestSlot()).toBe('auto')
  })

  it('deletes one slot and leaves the others', () => {
    saveToSlot('auto', newRun(1), 1)
    saveToSlot('1', newRun(2), 2)
    deleteSlot('auto')
    expect(storage.data.has(slotKey('auto'))).toBe(false)
    expect(listSlots().map((s) => s.meta?.seed ?? null)).toEqual([null, 2, null, null])
    expect(freeSlot()).toBe('auto')
  })

  it('rebuilds a corrupt, stale or tampered index from the slots themselves', () => {
    saveToSlot('1', newRun(9), 50)
    // Garbage where the index should be.
    storage.data.set(SLOT_INDEX_KEY, '{not json')
    expect(listSlots().find((s) => s.id === '1')!.meta!.seed).toBe(9)
    // An entry for a slot whose data is gone is dropped.
    const index = JSON.parse(storage.data.get(SLOT_INDEX_KEY)!)
    index.slots['2'] = { ...index.slots['1'] }
    storage.data.set(SLOT_INDEX_KEY, JSON.stringify(index))
    expect(listSlots().find((s) => s.id === '2')!.meta).toBeNull()
    // Wrongly typed metadata is replaced with what the save really says.
    index.slots['1'] = { seed: 'nine', species: ['dragon'] }
    storage.data.set(SLOT_INDEX_KEY, JSON.stringify(index))
    expect(listSlots().find((s) => s.id === '1')!.meta!.seed).toBe(9)
  })

  it('survives storage that is missing altogether', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    })
    expect(listSlots().every((s) => s.meta === null)).toBe(true)
    expect(saveToSlot('auto', newRun())).toMatchObject({
      ok: false,
      reason: 'unavailable',
    })
  })
})

describe('migration from the single save', () => {
  it('turns an existing run save into the autosave slot without losing it', () => {
    const run = playedRun(77)
    // Exactly what older builds wrote: the run alone, under the old key, no index.
    storage.data.set('emberwatch.run.v1', JSON.stringify(run))
    expect(storage.data.has(SLOT_INDEX_KEY)).toBe(false)

    const slots = listSlots()
    expect(slots[0]).toMatchObject({ id: 'auto', label: 'Autosave' })
    expect(slots[0].meta).toMatchObject({ seed: 77, year: run.season.year, savedAt: 0 })
    expect(latestSlot()).toBe('auto')
    expect(freeSlot()).toBe('1')
    // The index is written once, and the save itself is untouched.
    expect(JSON.parse(storage.data.get(SLOT_INDEX_KEY)!).slots.auto.seed).toBe(77)
    expect(loadRun()!.clock).toBe(run.clock)

    // "Continue" in the store picks it up.
    useGameStore.getState().resumeSaved()
    expect(useGameStore.getState().run!.seed).toBe(77)
    expect(useGameStore.getState().activeSlot).toBe('auto')
  })

  it('gives an old save the usual defaults on the way in', () => {
    const legacy = JSON.parse(JSON.stringify(newRun(5))) as Partial<RunState>
    delete legacy.runModifiers
    delete legacy.timeline
    delete legacy.conditions
    storage.data.set('emberwatch.run.v1', JSON.stringify(legacy))
    expect(listSlots()[0].meta!.runModifiers).toEqual([])
    const loaded = loadSlot('auto')!
    expect(loaded.conditions).toEqual([])
    expect(loaded.timeline).toBeDefined()
  })
})

describe('overwrite protection', () => {
  const store = () => useGameStore.getState()

  it('starts each new settlement in a free slot, never over a run in progress', async () => {
    await store().startRun(1)
    expect(store().activeSlot).toBe('auto')
    const first = store().run!
    await store().startRun(2)
    expect(store().activeSlot).toBe('1')
    // The first run was saved and is still in its own slot.
    expect(loadSlot('auto')!.seed).toBe(first.seed)
    await store().startRun(3)
    await store().startRun(4)
    expect(SLOT_IDS.map((id) => loadSlot(id)!.seed)).toEqual([1, 2, 3, 4])

    // Every slot is full: a fifth run is refused rather than overwrite one.
    await store().startRun(5)
    expect(store().run!.seed).toBe(4)
    expect(store().notice).toMatch(/Every save slot holds a settlement/)
    expect(SLOT_IDS.map((id) => loadSlot(id)!.seed)).toEqual([1, 2, 3, 4])

    // Replacing is a deliberate choice of slot, and replaces only that one.
    await store().startRun(6, undefined, undefined, undefined, '2')
    expect(store().activeSlot).toBe('2')
    expect(SLOT_IDS.map((id) => loadSlot(id)!.seed)).toEqual([1, 2, 6, 4])
  })

  it('starts the daily expedition in a free slot, and never over a run in progress', async () => {
    await store().startRun(1)
    await store().startDaily(Date.UTC(2026, 10, 5, 12))
    expect(store().activeSlot).toBe('1')
    expect(store().run!.daily).toBe('2026-11-05')
    expect(loadSlot('auto')!.seed).toBe(1)

    // With every slot full, the daily is refused rather than overwrite a run.
    await store().startRun(3)
    await store().startRun(4)
    const before = SLOT_IDS.map((id) => loadSlot(id)!.seed)
    await store().startDaily(Date.UTC(2026, 10, 6, 12))
    expect(store().screen).toBe('daily')
    expect(store().notice).toMatch(/Every save slot holds a settlement/)
    expect(SLOT_IDS.map((id) => loadSlot(id)!.seed)).toEqual(before)
  })

  it('autosaves to the slot being played, not to the autosave slot', async () => {
    saveToSlot('auto', newRun(1), 1)
    await store().startRun(2)
    expect(store().activeSlot).toBe('1')
    const run = store().run!
    run.pendingChoices = []
    for (let i = 0; i < 40; i++) tick(run, 0.125)
    store().saveNow()
    expect(loadSlot('1')!.clock).toBe(run.clock)
    expect(loadSlot('auto')!.seed).toBe(1)
    expect(loadSlot('auto')!.clock).toBe(0)
  })

  it('loads a chosen slot after saving the run it leaves', async () => {
    await store().startRun(1)
    const first = store().run!
    first.pendingChoices = []
    for (let i = 0; i < 16; i++) tick(first, 0.125)
    saveToSlot('2', newRun(2), 5)
    store().resumeSaved('2')
    expect(store().run!.seed).toBe(2)
    expect(store().activeSlot).toBe('2')
    expect(loadSlot('auto')!.clock).toBe(first.clock)
  })

  it('banks a finished run by freeing only its own slot', async () => {
    saveToSlot('auto', newRun(1), 1)
    await store().startRun(2)
    store().run!.phase = 'won'
    store().finishRun()
    expect(loadSlot('1')).toBeNull()
    expect(loadSlot('auto')!.seed).toBe(1)
  })

  it('copies the current run to another slot and keeps playing in its own', async () => {
    await store().startRun(1)
    store().saveCopy('3')
    expect(loadSlot('3')!.seed).toBe(1)
    expect(store().activeSlot).toBe('auto')
  })

  it('deleting the slot being played drops that run', async () => {
    await store().startRun(1)
    store().deleteSave('auto')
    expect(store().run).toBeNull()
    expect(store().activeSlot).toBeNull()
    expect(loadSlot('auto')).toBeNull()
  })
})

describe('full storage', () => {
  it('keeps the previous save intact when a new one does not fit', () => {
    const run = newRun(1)
    expect(saveToSlot('auto', run, 1).ok).toBe(true)
    const before = storage.data.get(slotKey('auto'))
    storage.opts.quotaBytes = 0
    const later = playedRun(1)
    const result = saveToSlot('auto', later, 2)
    expect(result).toMatchObject({ ok: false, reason: 'quota' })
    if (!result.ok) expect(result.message).toMatch(/storage is full/)
    expect(storage.data.get(slotKey('auto'))).toBe(before)
    expect(listSlots()[0].meta!.savedAt).toBe(1)
  })

  it('tells the player once, not on every autosave, and recovers', async () => {
    await useGameStore.getState().startRun(1)
    storage.opts.quotaBytes = 0
    useGameStore.getState().saveNow()
    expect(useGameStore.getState().notice).toMatch(/storage is full/)
    useGameStore.setState({ notice: null })
    useGameStore.getState().saveNow()
    expect(useGameStore.getState().notice).toBeNull()

    // Space freed: saves land again, and a later failure is reported afresh.
    storage.opts.quotaBytes = undefined
    useGameStore.getState().saveNow()
    expect(loadSlot('auto')).not.toBeNull()
    storage.opts.quotaBytes = 0
    useGameStore.getState().saveNow()
    expect(useGameStore.getState().notice).toMatch(/storage is full/)
  })

  it('fits four timeline-sized saves comfortably in a typical 5 MB store', () => {
    storage.opts.quotaBytes = 5 * 1024 * 1024
    const run = playedRun()
    // Pad the timeline to the size a long run reaches (45–55 KB saves).
    const sample = run.timeline.samples[0] ?? Array(12).fill(1)
    while (JSON.stringify(run).length < 55_000) run.timeline.samples.push([...sample])
    for (const id of SLOT_IDS) expect(saveToSlot(id, run).ok).toBe(true)
  })
})

describe('export and import', () => {
  it('round-trips a run through a versioned file, to the same future', () => {
    const run = playedRun(31337)
    const text = saveFileText(run, new Date('2026-01-02T03:04:05Z'))
    const file = JSON.parse(text)
    expect(file.format).toBe(SAVE_FILE_FORMAT)
    expect(file.version).toBe(SAVE_FILE_VERSION)
    expect(file.exportedAt).toBe('2026-01-02T03:04:05.000Z')
    expect(file.meta.seed).toBe(31337)

    const result = parseSaveFile(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.parse(JSON.stringify(result.run))).toEqual(
      JSON.parse(JSON.stringify(run)),
    )
    // Same seed and cursor: both copies play out identically.
    for (let i = 0; i < 200; i++) {
      tick(run, 0.125)
      tick(result.run, 0.125)
    }
    expect(JSON.stringify(result.run)).toBe(JSON.stringify(run))
  })

  it('imports into a slot through the store, and refuses nothing it validated', () => {
    const result = parseSaveFile(saveFileText(newRun(8)))
    if (!result.ok) throw new Error(result.error)
    expect(useGameStore.getState().importRun(result.run, '2')).toBeNull()
    expect(loadSlot('2')!.seed).toBe(8)
    useGameStore.getState().resumeSaved('2')
    expect(useGameStore.getState().run!.seed).toBe(8)
  })

  it('migrates an exported run from before newer fields existed', () => {
    const run = JSON.parse(JSON.stringify(newRun(12))) as Partial<RunState>
    delete run.runModifiers
    delete run.conditions
    delete run.timeline
    const result = parseSaveFile(JSON.stringify({ ...buildSaveFile(newRun(12)), run }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.run.runModifiers).toEqual([])
      expect(result.run.conditions).toEqual([])
    }
  })

  const withRun = (patch: (run: Record<string, unknown>) => void) => {
    const file = valid()
    patch(file.run as Record<string, unknown>)
    return JSON.stringify(file)
  }

  it.each([
    ['an empty file', '', /empty/],
    ['plain text', 'hello there', /not valid JSON/],
    ['truncated JSON', saveFileText(newRun()).slice(0, 500), /not valid JSON/],
    ['JSON null', 'null', /not an Emberwatch save/],
    ['a JSON array', '[1,2,3]', /not an Emberwatch save/],
    ['a bare number', '42', /not an Emberwatch save/],
    [
      'another format',
      JSON.stringify({ format: 'something-else', version: 1 }),
      /not an Emberwatch save/,
    ],
    [
      'a missing version',
      JSON.stringify({ ...valid(), version: undefined }),
      /version stamp/,
    ],
    [
      'a fractional version',
      JSON.stringify({ ...valid(), version: 1.5 }),
      /version stamp/,
    ],
    [
      'a newer version',
      JSON.stringify({ ...valid(), version: SAVE_FILE_VERSION + 1 }),
      /newer version/,
    ],
    [
      'no run',
      JSON.stringify({ ...valid(), run: undefined }),
      /damaged: it holds no run/,
    ],
    ['a run that is a string', JSON.stringify({ ...valid(), run: 'run' }), /damaged/],
    ['a missing world', withRun((r) => delete r.world), /world/],
    ['a string seed', withRun((r) => (r.seed = '42')), /seed/],
    ['a NaN-ish clock', withRun((r) => (r.clock = null)), /clock/],
    ['an unknown phase', withRun((r) => (r.phase = 'paused')), /phase/],
    [
      'an unknown season',
      withRun((r) => ((r.season as { season: string }).season = 'winter')),
      /season/,
    ],
    ['no glades', withRun((r) => (r.glades = {})), /no glades/],
    [
      'a broken glade polygon',
      withRun((r) => {
        const glades = r.glades as Record<string, { polygon: unknown }>
        Object.values(glades)[0].polygon = [{ x: 1 }]
      }),
      /glades/,
    ],
    [
      'an unknown building',
      withRun((r) => {
        const buildings = r.buildings as Record<string, { defId: string }>
        Object.values(buildings)[0].defId = 'deathStar'
      }),
      /buildings/,
    ],
    [
      'an unknown species',
      withRun((r) => {
        const villagers = r.villagers as Record<string, { species: string }>
        Object.values(villagers)[0].species = 'dragon'
      }),
      /villagers/,
    ],
    [
      'a foreign resource',
      withRun((r) => ((r.stock as Record<string, unknown>).gold = 5)),
      /stockpile/,
    ],
    [
      'a string amount',
      withRun((r) => ((r.stock as Record<string, unknown>).wood = '5')),
      /stockpile/,
    ],
    [
      'an unknown blueprint',
      withRun((r) => (r.unlockedBuildings = ['deathStar'])),
      /blueprints/,
    ],
    ['an empty species pool', withRun((r) => (r.speciesPool = [])), /species/],
    ['a non-array log', withRun((r) => (r.log = 'log')), /log/],
  ])('rejects %s with a clear message', (_name, text, message) => {
    const result = parseSaveFile(text)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(message)
      expect(result.error).toMatch(/Nothing was changed/)
    }
  })

  it('rejects files far larger than any save before parsing them', () => {
    const result = parseSaveFile(' '.repeat(MAX_SAVE_FILE_BYTES + 1))
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toMatch(/too large/)
  })

  it('never throws, whatever field is mangled', () => {
    const base = valid()
    const run = base.run as Record<string, unknown>
    const junk: unknown[] = [
      null,
      0,
      -1,
      1e308,
      '',
      'x',
      [],
      {},
      [null],
      { a: null },
      true,
    ]
    for (const key of Object.keys(run)) {
      for (const value of junk) {
        const text = JSON.stringify({ ...base, run: { ...run, [key]: value } })
        const label = `${key} = ${JSON.stringify(value)}`
        let accepted: RunState | null = null
        expect(() => {
          const result = parseSaveFile(text)
          if (result.ok) accepted = result.run
        }, label).not.toThrow()
        // Anything accepted must keep running in the simulation.
        if (accepted) expect(() => tick(accepted!, 0.125), label).not.toThrow()
      }
    }
    // Some 800 parses, each with a dry tick: seconds, not milliseconds.
  }, 60_000)
})

describe('hostile save files', () => {
  afterEach(() => {
    // Belt and braces: never let one test's pollution leak into another.
    for (const key of ['polluted', 'isAdmin']) {
      delete (Object.prototype as Record<string, unknown>)[key]
    }
  })

  it('strips prototype-reaching keys at every depth while parsing', () => {
    const parsed = parseUntrustedJson(
      '{"a":1,"__proto__":{"polluted":true},"b":{"constructor":{"prototype":{"polluted":true}},"c":[{"__proto__":{"isAdmin":true}}]}}',
    ) as Record<string, unknown>
    expect(parsed).toEqual({ a: 1, b: { c: [{}] } })
    expect(Object.hasOwn(parsed, '__proto__')).toBe(false)
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined()
  })

  it('imports a valid run laced with __proto__ without polluting anything', () => {
    const file = valid()
    const text = JSON.stringify(file)
      // Into the run, its citadel perks (spread by migrateRun), a building and the envelope.
      .replace(
        '"run":{',
        '"__proto__":{"polluted":true},"run":{"__proto__":{"polluted":true},',
      )
      .replace(
        '"citadel":{',
        '"citadel":{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"isAdmin":true}},',
      )
    expect(text).toContain('"citadel":{"__proto__"')
    const result = parseSaveFile(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.getPrototypeOf(result.run)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(result.run.citadel)).toBe(Object.prototype)
    expect(Object.hasOwn(result.run, '__proto__')).toBe(false)
    expect(Object.hasOwn(result.run.citadel, '__proto__')).toBe(false)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined()

    // And through the store, saved, reloaded and played.
    expect(useGameStore.getState().importRun(result.run, '1')).toBeNull()
    useGameStore.getState().resumeSaved('1')
    tick(useGameStore.getState().run!, 0.125)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined()
  })

  it('refuses keys that only look like data, such as a prototype-named building id', () => {
    const text = JSON.stringify(valid()).replace(
      '"buildings":{',
      '"buildings":{"__proto__":{"id":"x","defId":"shelter","pos":{"x":0,"y":0},"workers":[],"activeRecipeId":""},',
    )
    const result = parseSaveFile(text)
    // The key is dropped, never turned into a building or a prototype.
    if (result.ok) {
      expect(Object.keys(result.run.buildings)).not.toContain('__proto__')
      expect(Object.getPrototypeOf(result.run.buildings)).toBe(Object.prototype)
    }
    expect(({} as Record<string, unknown>).defId).toBeUndefined()
  })
})

describe('choices waiting in a save', () => {
  const withRun = (patch: (run: Record<string, unknown>) => void) => {
    const file = valid()
    patch(file.run as Record<string, unknown>)
    return JSON.stringify(file)
  }

  it.each([
    ['a draft without options', (r: Record<string, unknown>) => (r.pendingChoices = [{ kind: 'blueprint' }])],
    ['a draft of unknown buildings', (r: Record<string, unknown>) => (r.pendingChoices = [{ kind: 'blueprint', options: ['deathStar'] }])],
    ['an unknown kind of choice', (r: Record<string, unknown>) => (r.pendingChoices = [{ kind: 'riddle', options: ['a'] }])],
    ['an unknown glade event', (r: Record<string, unknown>) => (r.pendingChoices = [{ kind: 'gladeEvent', options: ['nope'], gladeId: 'glade1' }])],
    ['an unknown cornerstone', (r: Record<string, unknown>) => (r.pendingChoices = [{ kind: 'cornerstone', options: [7] }])],
    ['a decree offer with a broken candidate', (r: Record<string, unknown>) => (r.pendingChoices = [{ kind: 'decree', options: ['d1'], decrees: [{ id: 'd1' }] }])],
    ['an order offer without options', (r: Record<string, unknown>) => (r.orderOffers = [{ kind: 'order' }])],
    ['an order offer that is not one', (r: Record<string, unknown>) => (r.orderOffers = [{ kind: 'cornerstone', options: ['sturdyScaffolds'] }])],
    ['an active order with an unknown def', (r: Record<string, unknown>) => (r.orders = [{ id: 'o1', defId: 'nope', progress: 0, complete: false }])],
    ['a broken royal decree', (r: Record<string, unknown>) => (r.decree = { id: 'd', defId: 'decree_planks' })],
  ])('refuses %s', (_name, patch) => {
    const result = parseSaveFile(withRun(patch))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/damaged/)
  })

  it('still accepts the founding picks a fresh run waits on, and a played run', () => {
    expect(newRun(5).pendingChoices.length).toBeGreaterThan(0)
    expect(parseSaveFile(saveFileText(newRun(5))).ok).toBe(true)
    expect(parseSaveFile(saveFileText(playedRun(6))).ok).toBe(true)
  })

  it('refuses a damaged local slot with a message instead of loading it', () => {
    const run = newRun(9)
    expect(saveToSlot('1', run, 50).ok).toBe(true)
    const stored = JSON.parse(storage.data.get(slotKey('1'))!)
    stored.pendingChoices = [{ kind: 'blueprint' }]
    storage.data.set(slotKey('1'), JSON.stringify(stored))
    expect(loadSlot('1')).toBeNull()
    useGameStore.getState().resumeSaved('1')
    expect(useGameStore.getState().run).toBeNull()
    expect(useGameStore.getState().notice).toMatch(/Slot 1 could not be loaded.*damaged/)
  })

  it('lists slots even when storage throws on every read', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
      removeItem: () => {},
    })
    expect(() => listSlots()).not.toThrow()
    expect(listSlots().every((s) => s.meta === null)).toBe(true)
  })
})

describe('a run that is not being saved says so until it is', () => {
  it('keeps the reason up after the notice, and clears it once a save lands', async () => {
    await useGameStore.getState().startRun(1)
    expect(useGameStore.getState().saveError).toBeNull()
    storage.opts.quotaBytes = 0
    useGameStore.getState().saveNow()
    expect(useGameStore.getState().saveError).toMatchObject({ reason: 'quota' })
    // The notice goes; the run is still not being saved, and that stays known.
    useGameStore.setState({ notice: null })
    useGameStore.getState().saveNow()
    expect(useGameStore.getState().saveError).toMatchObject({ reason: 'quota' })
    storage.opts.quotaBytes = undefined
    useGameStore.getState().saveNow()
    expect(useGameStore.getState().saveError).toBeNull()
  })

  it('covers private modes where storage refuses every write', async () => {
    await useGameStore.getState().startRun(1)
    storage.storage.setItem = () => {
      const error = new Error('The operation is insecure.')
      error.name = 'SecurityError'
      throw error
    }
    useGameStore.getState().saveNow()
    expect(useGameStore.getState().saveError).toMatchObject({ reason: 'unavailable' })
    expect(useGameStore.getState().saveError!.message).toMatch(/private mode/)
  })
})

describe('two tabs on one Citadel', () => {
  const META = 'emberwatch.meta.v1'

  it('banks a run on top of what another tab saved to the Citadel since', async () => {
    useGameStore.getState().boot()
    await useGameStore.getState().startRun(1)
    // Meanwhile another tab banks runs of its own.
    storage.data.set(META, JSON.stringify({ ...defaultMeta(), citadelSupplies: 500, runsLost: 5 }))
    const run = useGameStore.getState().run!
    run.phase = 'lost'
    useGameStore.getState().finishRun()
    const stored = JSON.parse(storage.data.get(META)!)
    expect(stored.runsLost).toBe(6)
    expect(stored.citadelSupplies).toBeGreaterThanOrEqual(500)
    expect(useGameStore.getState().meta.runsLost).toBe(6)
  })

  it('buys an upgrade without undoing another tab’s purchase', () => {
    storage.data.set(META, JSON.stringify({ ...defaultMeta(), citadelSupplies: 100 }))
    useGameStore.getState().boot()
    storage.data.set(
      META,
      JSON.stringify({ ...defaultMeta(), citadelSupplies: 97, upgrades: ['deeperStores'] }),
    )
    useGameStore.getState().buyUpgrade('travelRations')
    const stored = JSON.parse(storage.data.get(META)!)
    expect(stored.upgrades).toContain('deeperStores')
    expect(stored.upgrades).toContain('travelRations')
  })

  it('keeps Citadel progress in memory when a full disk refused to store it', async () => {
    useGameStore.getState().boot()
    useGameStore.setState({ meta: { ...defaultMeta(), citadelSupplies: 42 } })
    // Storage unchanged since this tab read it: memory is the newer copy.
    expect(useGameStore.getState().refreshMeta().citadelSupplies).toBe(42)
  })

  it('stops saving over a settlement another tab saved since, until told to', async () => {
    await useGameStore.getState().startRun(1)
    const mine = useGameStore.getState().run!
    // The other tab resumed the same slot and saved it.
    const theirs = JSON.parse(JSON.stringify(mine)) as RunState
    theirs.clock = 999
    expect(saveToSlot('auto', theirs, Date.now() + 10_000).ok).toBe(true)
    useGameStore.getState().saveNow()
    expect(loadSlot('auto')!.clock).toBe(999)
    expect(useGameStore.getState().saveError).toMatchObject({ reason: 'conflict' })
    // Further autosaves stay out of the way.
    useGameStore.getState().saveNow()
    expect(loadSlot('auto')!.clock).toBe(999)
    // The player chooses to keep this tab's run.
    useGameStore.getState().saveOverConflict()
    expect(loadSlot('auto')!.clock).toBe(mine.clock)
    expect(useGameStore.getState().saveError).toBeNull()
    useGameStore.getState().saveNow()
    expect(useGameStore.getState().saveError).toBeNull()
  })
})
