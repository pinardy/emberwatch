import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultVolume, migrateVolume } from '../game/persistence'
import { FakeAudioContext, FakeGain } from '../test/fakeAudio'
import {
  audioGraphForTests,
  cue,
  levelToGain,
  musicReady,
  resetAudioForTests,
  setMusicHeld,
  setMusicMood,
  setMuted,
  setRainSeason,
  setVolume,
  unlockAudio,
} from './audio'

/** The graph's nodes, typed as the fakes they are. */
function graph() {
  const g = audioGraphForTests()
  return g as unknown as {
    ctx: FakeAudioContext
    master: FakeGain
    effects: FakeGain
    ambience: FakeGain
    music: FakeGain
    duck: FakeGain
    rainGain: FakeGain | null
    musicEngine: { playing: boolean } | null
  }
}

beforeEach(() => {
  FakeAudioContext.instances = []
  vi.stubGlobal('AudioContext', FakeAudioContext)
  // No sticky activation unless a test says so.
  vi.stubGlobal('navigator', {})
  vi.useFakeTimers()
})

afterEach(() => {
  resetAudioForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('volume settings', () => {
  it('gives older settings without a mixer the defaults', () => {
    expect(migrateVolume(undefined)).toEqual(defaultVolume())
    expect(migrateVolume(null)).toEqual(defaultVolume())
    expect(migrateVolume('loud')).toEqual(defaultVolume())
  })

  it('keeps saved levels, fills the missing ones and clamps the rest', () => {
    expect(migrateVolume({ master: 0.5, music: 2, effects: -1, ambience: 'x' })).toEqual({
      master: 0.5,
      music: 1,
      effects: 0,
      ambience: defaultVolume().ambience,
    })
    expect(migrateVolume({ music: Number.NaN }).music).toBe(defaultVolume().music)
  })

  it('starts the score quiet and leaves the familiar cues and rain at full level', () => {
    const v = defaultVolume()
    expect(v.master).toBe(1)
    expect(v.effects).toBe(1)
    expect(v.ambience).toBe(1)
    expect(v.music).toBeGreaterThan(0)
    expect(v.music).toBeLessThanOrEqual(0.35)
  })

  it('maps slider travel to gain on a squared curve', () => {
    expect(levelToGain(0)).toBe(0)
    expect(levelToGain(1)).toBe(1)
    expect(levelToGain(0.5)).toBeCloseTo(0.25)
    expect(levelToGain(3)).toBe(1)
    expect(levelToGain(-1)).toBe(0)
  })
})

describe('audio graph', () => {
  it('creates no context before a user gesture', () => {
    setRainSeason('drizzle')
    setMusicMood({ season: 'drizzle', tense: false })
    cue('orderComplete')
    expect(FakeAudioContext.instances).toHaveLength(0)

    // The gesture starts what was asked for while waiting.
    unlockAudio()
    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(graph().rainGain).not.toBeNull()
  })

  it('treats the browser’s sticky activation as a gesture', () => {
    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: true } })
    setRainSeason('storm')
    expect(FakeAudioContext.instances).toHaveLength(1)
  })

  it('resumes a suspended context on a later gesture without rebuilding the graph', () => {
    unlockAudio()
    const ctx = graph().ctx
    ctx.state = 'suspended'
    unlockAudio()
    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(ctx.state).toBe('running')
    expect(ctx.resumes).toBe(2)
  })

  it('wires cues, rain and music through their own buses into the master', () => {
    unlockAudio()
    const g = graph()
    expect(g.master.outputs).toEqual([g.ctx.destination])
    for (const bus of [g.effects, g.ambience, g.music]) expect(bus.outputs).toEqual([g.master])
    expect(g.duck.outputs).toEqual([g.music])

    setRainSeason('drizzle')
    expect(graph().rainGain!.reaches(g.ambience)).toBe(true)
    expect(graph().rainGain!.reaches(g.effects)).toBe(false)

    const before = g.ctx.oscillators().length
    cue('orderComplete')
    const fresh = g.ctx.oscillators().slice(before)
    expect(fresh.length).toBeGreaterThan(0)
    for (const osc of fresh) {
      expect(osc.reaches(g.effects)).toBe(true)
      expect(osc.reaches(g.music)).toBe(false)
    }
  })

  it('starts each bus at its saved level', () => {
    setVolume({ master: 0.8, music: 0.5, effects: 0.6, ambience: 0.4 })
    unlockAudio()
    const g = graph()
    expect(g.master.gain.value).toBeCloseTo(0.64)
    expect(g.music.gain.value).toBeCloseTo(0.25)
    expect(g.effects.gain.value).toBeCloseTo(0.36)
    expect(g.ambience.gain.value).toBeCloseTo(0.16)
  })

  it('moves each bus when its slider moves', () => {
    unlockAudio()
    setVolume({ master: 0.5, music: 1, effects: 0.2, ambience: 0 })
    const g = graph()
    expect(g.master.gain.target).toBeCloseTo(0.25)
    expect(g.music.gain.target).toBeCloseTo(1)
    expect(g.effects.gain.target).toBeCloseTo(0.04)
    expect(g.ambience.gain.target).toBe(0)
  })

  it('mutes at the master and plays no cues while muted', () => {
    unlockAudio()
    setVolume({ ...defaultVolume(), master: 0.5 })
    setMuted(true)
    const g = graph()
    expect(g.master.gain.target).toBe(0)
    const before = g.ctx.oscillators().length
    cue('caravan')
    expect(g.ctx.oscillators().length).toBe(before)

    // Unmuting restores the master level, not full volume.
    setMuted(false)
    expect(g.master.gain.target).toBeCloseTo(0.25)
  })

  it('plays no cues with the effects slider at zero', () => {
    unlockAudio()
    setVolume({ ...defaultVolume(), effects: 0 })
    const before = graph().ctx.oscillators().length
    cue('won')
    expect(graph().ctx.oscillators().length).toBe(before)
  })
})

describe('the score in the mix', () => {
  async function playing() {
    unlockAudio()
    setMusicMood({ season: 'drizzle', tense: false, seed: 7 })
    await musicReady()
    return graph()
  }

  it('loads the engine once it would be heard, and plays into the duck', async () => {
    const g = await playing()
    expect(g.musicEngine?.playing).toBe(true)
    const notes = g.ctx.oscillators().filter((o) => o.reaches(g.duck))
    expect(notes.length).toBeGreaterThan(0)
    for (const osc of notes) expect(osc.reaches(g.effects)).toBe(false)
  })

  it('does not load the engine while music is at zero or sound is muted', async () => {
    unlockAudio()
    setVolume({ ...defaultVolume(), music: 0 })
    setMusicMood({ season: 'storm', tense: false })
    await musicReady()
    expect(graph().musicEngine).toBeNull()

    setMuted(true)
    setVolume(defaultVolume())
    await musicReady()
    expect(graph().musicEngine).toBeNull()
  })

  it('holds while paused or hidden, and stops for mute or a zero slider', async () => {
    const g = await playing()
    setMusicHeld(true)
    expect(g.musicEngine!.playing).toBe(false)
    setMusicHeld(false)
    expect(g.musicEngine!.playing).toBe(true)

    setMuted(true)
    expect(g.musicEngine!.playing).toBe(false)
    setMuted(false)
    expect(g.musicEngine!.playing).toBe(true)

    setVolume({ ...defaultVolume(), music: 0 })
    expect(g.musicEngine!.playing).toBe(false)
    setVolume(defaultVolume())
    expect(g.musicEngine!.playing).toBe(true)

    setMusicMood(null)
    expect(g.musicEngine!.playing).toBe(false)
  })

  it('ducks under event cues but not under placement clicks', async () => {
    const g = await playing()
    g.duck.gain.calls = []
    cue('place')
    expect(g.duck.gain.calls).toHaveLength(0)

    cue('threat')
    const dips = g.duck.gain.calls.filter(([m]) => m === 'setTargetAtTime').map(([, v]) => v)
    expect(dips[0]).toBeLessThan(0.5)
    // ...and swells back afterwards.
    expect(dips.at(-1)).toBe(1)
  })

})
