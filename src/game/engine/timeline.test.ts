import { afterEach, describe, expect, it } from 'vitest'
import { GLADE_EVENTS } from '../content/gladeEvents'
import { loadRun } from '../persistence'
import type { RunState, TimelineSample } from '../types'
import { RESOLVE_LEAVE_THRESHOLD, SEASON_LENGTH, SECONDS_TO_LEAVE } from './balance'
import { createRun } from './createRun'
import { appeaseThreat, resolveGladeEvent, takeChoice } from './events'
import { population } from './queries'
import { tick } from './tick'
import {
  COL,
  TIMELINE_INTERVAL,
  TIMELINE_MAX_EVENTS,
  TIMELINE_MAX_SAMPLES,
  boundSamples,
  describeOutcome,
  recordEvent,
  stepTimeline,
  stormPeriods,
} from './timeline'

const SEED = 20260726

function newRun(): RunState {
  const state = createRun({ seed: SEED, species: ['human', 'beaver', 'lizard'] })
  drain(state)
  return state
}

/** Answers every pending choice with its first option. */
function drain(state: RunState): void {
  let guard = 0
  while (state.pendingChoices.length > 0 && guard++ < 20) {
    const choice = state.pendingChoices[0]
    if (choice.kind === 'gladeEvent') {
      const def = GLADE_EVENTS[choice.options[0]]
      resolveGladeEvent(state, def.options.length - 1)
    } else takeChoice(state, choice.options[0])
  }
}

function run(state: RunState, seconds: number, step = 0.125): void {
  for (let t = 0; t < seconds; t += step) {
    tick(state, step)
    drain(state)
  }
}

const kinds = (s: RunState) => s.timeline.events.map((e) => e.k)

describe('run timeline sampling', () => {
  it('starts empty and samples on a fixed cadence from the first tick', () => {
    const state = newRun()
    expect(state.timeline.samples).toEqual([])
    run(state, 60)
    const clocks = state.timeline.samples.map((smp) => smp[COL.clock])
    // 0.1 (first tick), 12, 24, 36, 48 and 60.
    expect(clocks).toHaveLength(6)
    for (let i = 2; i < clocks.length; i++) {
      expect(clocks[i] - clocks[i - 1]).toBeCloseTo(TIMELINE_INTERVAL, 5)
    }
    const last = state.timeline.samples[state.timeline.samples.length - 1]
    expect(last[COL.population]).toBe(population(state))
    expect(last[COL.year]).toBe(1)
    expect(last).toHaveLength(COL.species + state.speciesPool.length)
    expect(state.timeline.limits).toEqual([
      [expect.any(Number), state.maxReputation, state.maxImpatience],
    ])
  })

  it('takes a final sample on the tick that decides the run', () => {
    const state = newRun()
    run(state, 5)
    const before = state.timeline.samples.length
    state.reputation = state.maxReputation
    tick(state, 0.125)
    expect(state.phase).toBe('won')
    expect(state.timeline.samples).toHaveLength(before + 1)
    const last = state.timeline.samples[state.timeline.samples.length - 1]
    expect(last[COL.reputation]).toBe(state.maxReputation)
  })

  it('never consumes RNG or touches the simulation', () => {
    const state = newRun()
    run(state, 30)
    const without = JSON.parse(JSON.stringify(state)) as RunState
    state.timeline.next = 0
    stepTimeline(state)
    recordEvent(state, 'glade')
    const { timeline: _a, ...rest } = state
    const { timeline: _b, ...restBefore } = without
    expect(rest).toEqual(restBefore)
  })

  it('stays bounded: the older half is thinned, recent samples keep full detail', () => {
    const samples: TimelineSample[] = []
    for (let i = 0; i <= TIMELINE_MAX_SAMPLES; i++) samples.push([i * 12])
    boundSamples(samples)
    expect(samples.length).toBeLessThanOrEqual(TIMELINE_MAX_SAMPLES)
    // The very first sample survives every thinning, and the newest half is untouched.
    expect(samples[0][0]).toBe(0)
    expect(samples[1][0]).toBe(24)
    const tail = samples.slice(-TIMELINE_MAX_SAMPLES / 2).map((s) => s[0])
    expect(tail[tail.length - 1]).toBe(TIMELINE_MAX_SAMPLES * 12)
    for (let i = 1; i < tail.length; i++) expect(tail[i] - tail[i - 1]).toBe(12)
  })

  it('keeps a 40-minute run to a few KB in the save', () => {
    const state = newRun()
    // Sampling only reads the run, so drive the clock directly.
    for (let clock = 0; clock <= 40 * 60; clock += 0.5) {
      state.clock = clock
      stepTimeline(state)
    }
    const { samples } = state.timeline
    expect(samples.length).toBeLessThanOrEqual(TIMELINE_MAX_SAMPLES)
    expect(samples.length).toBeGreaterThan(TIMELINE_MAX_SAMPLES / 2)
    expect(samples[0][COL.clock]).toBe(0)
    expect(samples[samples.length - 1][COL.clock]).toBe(2400)
    // Recent play keeps the base cadence.
    const n = samples.length
    expect(samples[n - 1][COL.clock] - samples[n - 2][COL.clock]).toBe(TIMELINE_INTERVAL)
    for (let i = 0; i < 300; i++) recordEvent(state, i % 2 ? 'left' : 'glade', 'human')
    expect(state.timeline.events.length).toBe(TIMELINE_MAX_EVENTS)
    expect(JSON.stringify(state.timeline).length).toBeLessThan(10_000)
  })
})

describe('run timeline events', () => {
  it('marks the Storm and the new year with their clocks', () => {
    const state = newRun()
    state.season.season = 'clearance'
    state.season.length = SEASON_LENGTH.clearance
    state.season.elapsed = SEASON_LENGTH.clearance - 1
    run(state, 2)
    const storm = state.timeline.events.find((e) => e.k === 'storm')!
    expect(storm.t).toBeGreaterThan(0)
    state.season.elapsed = state.season.length - 1
    run(state, 2)
    expect(kinds(state)).toEqual(['storm', 'year'])
    expect(state.timeline.events[1].d).toBe('2')
    expect(stormPeriods(state.timeline, state.clock)).toEqual([[storm.t, state.timeline.events[1].t]])
  })

  it('records villagers walking out, by species', () => {
    const state = newRun()
    state.resolve.human = RESOLVE_LEAVE_THRESHOLD - 10
    state.despair.human = SECONDS_TO_LEAVE - 0.05
    tick(state, 0.125)
    expect(state.timeline.events).toContainEqual({ t: expect.any(Number), k: 'left', d: 'human' })
  })

  it('records threats unleashed and appeased, and cornerstones taken', () => {
    const state = newRun()
    state.pendingChoices.unshift({ kind: 'gladeEvent', options: ['howlingDen'], gladeId: 'glade1' })
    const loot = GLADE_EVENTS.howlingDen.options.findIndex((o) => o.label === 'Loot the bone-pile')
    resolveGladeEvent(state, loot)
    expect(kinds(state)).toContain('threat')
    state.stock.meat = 50
    expect(appeaseThreat(state, state.threats[0].id)).toBeNull()
    expect(state.timeline.events.at(-1)).toMatchObject({ k: 'appeased', d: 'The Wolf Pack' })

    state.pendingChoices = [{ kind: 'cornerstone', options: ['sturdyScaffolds'] }]
    takeChoice(state, 'sturdyScaffolds')
    expect(state.timeline.events.at(-1)?.k).toBe('cornerstone')
  })

  it('records a decree that lapses unmet', () => {
    const state = newRun()
    state.decreeTimer = 0.1
    run(state, 0.25)
    expect(state.decree).not.toBeNull()
    state.decree!.timeLeft = 0.1
    state.decree!.baseline = 1e9 // unreachable
    run(state, 0.25)
    expect(kinds(state)).toContain('decreeMissed')
  })
})

describe('run timeline persistence', () => {
  const original = globalThis.localStorage
  afterEach(() => {
    globalThis.localStorage = original
  })

  function withSave(json: string) {
    const store = new Map<string, string>([['emberwatch.run.v1', json]])
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage
  }

  it('survives a save/load round trip and keeps recording identically', () => {
    const state = newRun()
    run(state, 90)
    withSave(JSON.stringify(state))
    const restored = loadRun()!
    expect(restored.timeline).toEqual(state.timeline)
    run(state, 60)
    run(restored, 60)
    expect(restored.timeline).toEqual(state.timeline)
    expect(restored.rngCursor).toBe(state.rngCursor)
  })

  it('gives an older save an empty timeline that starts where it resumes', () => {
    const state = newRun()
    run(state, 30)
    const legacy = JSON.parse(JSON.stringify(state)) as Partial<RunState>
    delete legacy.timeline
    withSave(JSON.stringify(legacy))
    const loaded = loadRun()!
    expect(loaded.timeline.samples).toEqual([])
    expect(loaded.timeline.events).toEqual([])
    expect(loaded.timeline.species).toEqual(state.speciesPool)
    run(loaded, 13)
    expect(loaded.timeline.samples[0][COL.clock]).toBeGreaterThanOrEqual(30)
    expect(loaded.timeline.samples.length).toBeGreaterThanOrEqual(2)
  })
})

describe('describeOutcome', () => {
  /** A synthetic lost run: reputation leads, then three foxes leave in the Year-4 Storm. */
  function lostRun(): RunState {
    const state = createRun({ seed: SEED, species: ['human', 'fox', 'harpy'] })
    const tl = state.timeline
    tl.limits = [[0, 20, 20]]
    const year = 420
    for (let t = 0; t <= 4 * year; t += 12) {
      const y = Math.floor(t / year) + 1
      // Reputation runs ahead until the Storm of Year 4, then impatience surges.
      const rep = Math.min(14, t / 100)
      const imp = t < 3.8 * year ? t / 130 : 12 + (t - 3.8 * year) / 8
      tl.samples.push([t, y, rep, Math.min(20, imp), 30, 15, 20, 30, 18, 12, 20, 20])
    }
    tl.events.push({ t: 3 * year + 290, k: 'storm' })
    for (const dt of [10, 30, 50]) tl.events.push({ t: 3 * year + 290 + dt, k: 'left', d: 'fox' })
    state.phase = 'lost'
    state.season.year = 4
    state.impatience = 20
    state.maxImpatience = 20
    state.maxReputation = 20
    return state
  }

  it('names the turning point and what caused it', () => {
    expect(describeOutcome(lostRun())).toMatch(
      /^Impatience overtook your pace in Year 4 after 3 Foxes left during the Storm\./,
    )
  })

  it('explains a win by when reputation took the lead', () => {
    const state = lostRun()
    state.phase = 'won'
    const tl = state.timeline
    tl.samples = tl.samples.slice(0, 40).map((s) => {
      const out = [...s]
      out[COL.reputation] = s[COL.clock] < 300 ? 0 : (s[COL.clock] - 300) / 10
      out[COL.impatience] = s[COL.clock] / 200
      return out
    })
    tl.events = []
    expect(describeOutcome(state)).toMatch(/^Reputation pulled ahead of the Queen's impatience in Year 1/)
  })

  it('falls back gracefully without a timeline', () => {
    const state = newRun()
    state.phase = 'lost'
    expect(describeOutcome(state)).toBe('The settlement fell in Year 1.')
  })
})
