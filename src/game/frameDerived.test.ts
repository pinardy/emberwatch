import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectWarnings } from './engine/diagnostics'
import { createRun } from './engine/createRun'
import {
  buildingStatus,
  deadlineForecast,
  foodForecast,
  hearthForecast,
  meterRates,
  storageBlocked,
} from './engine/forecast'
import { computeModifiers } from './engine/modifiers'
import { secondsUntilDeparture, storageUsed } from './engine/queries'
import { resolveBreakdowns } from './engine/society'
import { withRunCache } from './engine/runCache'
import { tick } from './engine/tick'
import { frameDerived } from './frameDerived'
import { HUD_INTERVAL_MS, IDLE_SAVE_TIMEOUT_MS, useGameStore } from './store'
import { loadSlot } from './saveSlots'
import type { RunState } from './types'

// Counts run-cache scopes (passing straight through) for the lookup-cost test.
vi.mock('./engine/runCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./engine/runCache')>()
  return { ...actual, withRunCache: vi.fn(actual.withRunCache) }
})

function playedRun(seconds = 300): RunState {
  const run = createRun({ seed: 5150, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  run.pendingChoices = []
  for (let t = 0; t < seconds; t += 0.125) {
    tick(run, 0.125)
    run.pendingChoices = []
  }
  return run
}

describe('shared per-step derivations', () => {
  it('match what each engine function returns for the same state', () => {
    const run = playedRun()
    const derived = frameDerived(run, 1)
    const mods = computeModifiers(run)
    expect(derived.mods).toEqual(mods)
    expect(derived.storageUsed).toBe(storageUsed(run))
    expect(derived.storageBlocked).toEqual(storageBlocked(run, mods))
    expect(derived.food).toEqual(foodForecast(run, mods))
    expect(derived.warnings).toEqual(collectWarnings(run))
    expect(derived.topBar).toEqual({
      breakdowns: resolveBreakdowns(run, mods),
      rates: meterRates(run, mods),
      hearth: hearthForecast(run, mods),
      departures: secondsUntilDeparture(run),
      deadline: deadlineForecast(run, mods),
    })
    for (const b of Object.values(run.buildings)) {
      expect(derived.status(b)).toEqual(buildingStatus(run, b, mods))
    }
  })

  it('are computed once per version and shared', () => {
    const run = playedRun(30)
    const a = frameDerived(run, 7)
    expect(frameDerived(run, 7)).toBe(a)
    expect(a.topBar).toBe(a.topBar)
    tick(run, 0.125)
    const b = frameDerived(run, 8)
    expect(b).not.toBe(a)
    expect(b.topBar.breakdowns).toEqual(resolveBreakdowns(run, computeModifiers(run)))
  })

  it('look up every building status in one run-cache scope, outside any scope', () => {
    // Opening a scope checks every building, so a scope per lookup made a
    // pass over the settlement quadratic.
    const run = playedRun(120)
    const base = Object.values(run.buildings)
    for (let i = 0; Object.keys(run.buildings).length < 120; i++) {
      const src = base[i % base.length]
      const id = `copy${i}`
      run.buildings[id] = { ...src, id, workers: [...src.workers], pos: { x: src.pos.x + 0.01 * (i + 1), y: src.pos.y } }
    }
    const derived = frameDerived(run, 41)
    void derived.mods
    void derived.storageUsed
    const scopes = vi.mocked(withRunCache)
    scopes.mockClear()
    const all = Object.values(run.buildings)
    const statuses = all.map((b) => derived.status(b))
    expect(scopes).toHaveBeenCalledTimes(1)
    const mods = computeModifiers(run)
    all.forEach((b, i) => expect(statuses[i]).toEqual(buildingStatus(run, b, mods)))
    // Repeated lookups are remembered; a building outside the run still gets one.
    expect(derived.status(all[3])).toBe(statuses[3])
    const stray = { ...all[0], id: 'stray' }
    expect(derived.status(stray)).toEqual(buildingStatus(run, stray, mods))
  })
})

describe('store subscriptions', () => {
  beforeEach(() => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function startPlaying(): RunState {
    const run = playedRun(10)
    useGameStore.setState({ run, activeSlot: '1', screen: 'game', speed: 5 })
    return run
  }

  it('ticks the HUD clock at most every HUD_INTERVAL_MS of loop time', () => {
    startPlaying()
    const store = () => useGameStore.getState()
    let now = 100_000
    store().advance(1 / 60, now)
    const version = store().version
    const hud = store().hudVersion
    // One second of 60 Hz frames at 5x: the sim steps about every other frame,
    // the HUD hears about it about 8 times (plus any season turn, new log
    // line or finished building, which refresh it at once).
    for (let i = 0; i < 60; i++) {
      now += 1000 / 60
      store().advance(1 / 60, now)
    }
    const steps = store().version - version
    const refreshes = store().hudVersion - hud
    expect(steps).toBeGreaterThanOrEqual(30)
    expect(refreshes).toBeGreaterThanOrEqual(Math.floor(1000 / HUD_INTERVAL_MS) - 1)
    expect(refreshes).toBeLessThan(steps / 2)
  })

  it('refreshes the HUD at once for commands, pauses, season turns and outside bumps', () => {
    const run = startPlaying()
    const store = () => useGameStore.getState()
    const now = 200_000
    store().advance(1 / 60, now)
    let hud = store().hudVersion

    // A season about to turn: the step that turns it refreshes the HUD.
    run.season.elapsed = run.season.length - 0.01
    const season = run.season.season
    store().advance(0.1, now + 1)
    expect(run.season.season).not.toBe(season)
    expect(store().hudVersion).toBe(hud + 1)
    hud = store().hudVersion

    store().setSpeed(0)
    expect(store().hudVersion).toBe(hud + 1)
    hud = store().hudVersion

    store().pauseBuilding(Object.keys(run.buildings)[0])
    expect(store().hudVersion).toBe(hud + 1)
    hud = store().hudVersion

    // Code that edits the run and bumps only `version` still refreshes it.
    useGameStore.setState({ version: store().version + 1 })
    expect(store().hudVersion).toBe(hud + 1)

    // Without a frame time (tests, scripts) every step refreshes the HUD.
    store().setSpeed(1)
    hud = store().hudVersion
    store().advance(0.5)
    expect(store().hudVersion).toBe(hud + 1)
  })

  it('autosaves in idle time, and an immediate save covers a pending one', () => {
    vi.useFakeTimers()
    const run = startPlaying()
    const store = () => useGameStore.getState()
    run.clock = 1234.5
    store().saveSoon()
    expect(loadSlot('1')).toBeNull()
    vi.advanceTimersByTime(IDLE_SAVE_TIMEOUT_MS)
    expect(loadSlot('1')?.clock).toBe(1234.5)

    run.clock = 2000
    store().saveSoon()
    store().saveNow()
    expect(loadSlot('1')?.clock).toBe(2000)
    run.clock = 3000
    vi.advanceTimersByTime(IDLE_SAVE_TIMEOUT_MS)
    // The idle save was cancelled by the immediate one.
    expect(loadSlot('1')?.clock).toBe(2000)
  })
})
