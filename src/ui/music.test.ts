import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeAudioContext, FakeFilter, FakeGain, asAudioContext } from '../test/fakeAudio'
import type { Season } from '../game/types'
import {
  CROSSFADE_S,
  Composer,
  LOOKAHEAD_S,
  PALETTES,
  SCHEDULER_TICK_MS,
  createMusicEngine,
  midiToHz,
  paletteFor,
  type MusicBar,
  type MusicMood,
  type Palette,
} from './music'

const calm = (season: Season): MusicMood => ({ season, tense: false })

function bars(composer: Composer, mood: MusicMood, count: number): MusicBar[] {
  return Array.from({ length: count }, () => composer.next(mood))
}

/** A bar reduced to what a listener would hear. */
function signature(bar: MusicBar): string {
  return bar.notes.map((n) => `${n.voice}${n.midi}@${n.at.toFixed(2)}`).join(',')
}

function pitchClasses(palette: Palette): Set<number> {
  return new Set(palette.scale.map((s) => (palette.root + s) % 12))
}

/** Midi pitch class of an oscillator's frequency. */
function pitchClassOf(hz: number): number {
  return ((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12
}

describe('seasonal palettes', () => {
  it('is gentle in Drizzle, brighter in Clearance, lower and darker in the Storm', () => {
    const { drizzle, clearance, storm } = PALETTES
    expect(clearance.root).toBeGreaterThan(drizzle.root)
    expect(clearance.cutoff).toBeGreaterThan(drizzle.cutoff)
    expect(clearance.motifChance).toBeGreaterThan(drizzle.motifChance)
    expect(storm.root).toBeLessThan(drizzle.root)
    expect(storm.cutoff).toBeLessThan(drizzle.cutoff)
    expect(storm.barSeconds).toBeGreaterThan(drizzle.barSeconds)
    expect(storm.drone).toBe(true)
  })

  it('shades the season when trouble is loose without changing its key', () => {
    for (const season of ['drizzle', 'clearance', 'storm'] as const) {
      const base = paletteFor(calm(season))
      const tense = paletteFor({ season, tense: true })
      expect(tense.root).toBe(base.root)
      expect(tense.scale).toEqual(base.scale)
      expect(tense.cutoff).toBeLessThan(base.cutoff)
      expect(tense.motifChance).toBeLessThan(base.motifChance)
      expect(tense.drone).toBe(true)
    }
  })
})

describe('composer', () => {
  it('writes the same score for the same seed, and another for another seed', () => {
    const a = bars(new Composer(42), calm('drizzle'), 32).map(signature)
    const b = bars(new Composer(42), calm('drizzle'), 32).map(signature)
    const c = bars(new Composer(43), calm('drizzle'), 32).map(signature)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('stays in the season’s scale, so nothing clashes', () => {
    for (const season of ['drizzle', 'clearance', 'storm'] as const) {
      for (const tense of [false, true]) {
        const palette = paletteFor({ season, tense })
        const allowed = pitchClasses(palette)
        for (const bar of bars(new Composer(9), { season, tense }, 64)) {
          for (const note of bar.notes) expect(allowed.has(note.midi % 12)).toBe(true)
        }
      }
    }
  })

  it('never repeats a chord back to back, and keeps coming home', () => {
    const chords = bars(new Composer(5), calm('clearance'), 200).map((b) => b.chord)
    let away = 0
    for (let i = 1; i < chords.length; i++) {
      expect(chords[i]).not.toBe(chords[i - 1])
      away = chords[i] === 0 ? 0 : away + 1
      expect(away).toBeLessThan(12)
    }
  })

  it('does not loop: no long stretch of the score comes round again', () => {
    const sigs = bars(new Composer(1), calm('drizzle'), 240).map(signature)
    const windows = new Set<string>()
    for (let i = 0; i + 12 <= sigs.length; i++) windows.add(sigs.slice(i, i + 12).join('|'))
    expect(windows.size).toBe(sigs.length - 12 + 1)
  })

  it('keeps motifs sparse and above the pads', () => {
    for (const season of ['drizzle', 'clearance', 'storm'] as const) {
      const written = bars(new Composer(3), calm(season), 200)
      const withMotif = written.filter((b) => b.notes.some((n) => n.voice === 'motif')).length
      expect(withMotif / written.length).toBeGreaterThan(PALETTES[season].motifChance - 0.12)
      expect(withMotif / written.length).toBeLessThan(PALETTES[season].motifChance + 0.12)
      for (const bar of written) {
        const motif = bar.notes.filter((n) => n.voice === 'motif')
        expect(motif.length === 0 || (motif.length >= 2 && motif.length <= 4)).toBe(true)
        for (const note of motif) expect(note.midi).toBeGreaterThan(PALETTES[season].root)
      }
    }
  })
})

describe('music engine', () => {
  let ctx: FakeAudioContext
  let out: FakeGain

  beforeEach(() => {
    vi.useFakeTimers()
    ctx = new FakeAudioContext()
    out = ctx.createGain()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Moves the audio clock and the scheduler's timer together. */
  function advance(seconds: number) {
    for (let t = 0; t < seconds; t++) {
      ctx.currentTime += 1
      vi.advanceTimersByTime(1000)
    }
  }

  function layers(): FakeFilter[] {
    return ctx.nodes.filter((n): n is FakeFilter => n instanceof FakeFilter)
  }

  it('starts paused and plays nothing until resumed', () => {
    const engine = createMusicEngine(asAudioContext(ctx), out as unknown as AudioNode)
    engine.setMood(calm('drizzle'))
    advance(20)
    expect(ctx.oscillators()).toHaveLength(0)
    engine.resume()
    expect(engine.playing).toBe(true)
    expect(ctx.oscillators().length).toBeGreaterThan(0)
    engine.dispose()
  })

  it('schedules ahead on the audio clock, a few seconds at a time', () => {
    const engine = createMusicEngine(asAudioContext(ctx), out as unknown as AudioNode)
    engine.setMood(calm('clearance'))
    engine.resume()
    expect(SCHEDULER_TICK_MS).toBeGreaterThanOrEqual(500)
    for (let i = 0; i < 60; i++) {
      advance(1)
      const horizon = ctx.currentTime + LOOKAHEAD_S + PALETTES.clearance.barSeconds
      for (const osc of ctx.oscillators()) expect(osc.startAt!).toBeLessThan(horizon)
    }
    // A minute of music means notes right through it, not a burst up front.
    const starts = ctx.oscillators().map((o) => o.startAt!)
    expect(Math.max(...starts)).toBeGreaterThan(55)
    engine.dispose()
  })

  it('crossfades into the new season’s palette when the season turns', () => {
    const engine = createMusicEngine(asAudioContext(ctx), out as unknown as AudioNode)
    engine.setMood(calm('drizzle'))
    engine.resume()
    advance(10)
    const [drizzleLayer] = layers()
    const drizzleGain = drizzleLayer.outputs[0] as FakeGain
    expect(drizzleLayer.frequency.value).toBe(PALETTES.drizzle.cutoff)

    const turnedAt = ctx.currentTime
    const before = ctx.oscillators().length
    engine.setMood(calm('storm'))

    // The old layer ramps down over the crossfade while a new one ramps up.
    expect(drizzleGain.gain.calls.at(-1)).toEqual([
      'linearRampToValueAtTime',
      0,
      turnedAt + CROSSFADE_S,
    ])
    const stormLayer = layers().at(-1)!
    expect(stormLayer).not.toBe(drizzleLayer)
    expect(stormLayer.frequency.value).toBe(PALETTES.storm.cutoff)
    const stormGain = stormLayer.outputs[0] as FakeGain
    expect(stormGain.outputs).toEqual([out])
    expect(stormGain.gain.calls).toContainEqual([
      'linearRampToValueAtTime',
      1,
      turnedAt + CROSSFADE_S,
    ])

    // Every note from here on is the Storm's, in the Storm's layer.
    advance(30)
    const fresh = ctx.oscillators().slice(before)
    expect(fresh.length).toBeGreaterThan(0)
    const stormScale = pitchClasses(PALETTES.storm)
    for (const osc of fresh) {
      expect(osc.reaches(stormLayer)).toBe(true)
      expect(osc.reaches(drizzleLayer)).toBe(false)
      expect(stormScale.has(pitchClassOf(osc.frequency.value))).toBe(true)
    }
    // The Storm sits lower: its lowest note is under anything Drizzle played.
    const lowest = (oscs: typeof fresh) => Math.min(...oscs.map((o) => o.frequency.value))
    expect(lowest(fresh)).toBeLessThan(lowest(ctx.oscillators().slice(0, before)))
    expect(lowest(fresh)).toBeCloseTo(midiToHz(PALETTES.storm.root - 12))
    engine.dispose()
  })

  it('leaves the music alone when the mood has not really changed', () => {
    const engine = createMusicEngine(asAudioContext(ctx), out as unknown as AudioNode)
    engine.setMood({ season: 'drizzle', tense: false, seed: 1 })
    engine.resume()
    const count = layers().length
    engine.setMood({ season: 'drizzle', tense: false, seed: 1 })
    expect(layers()).toHaveLength(count)
    engine.setMood({ season: 'drizzle', tense: true, seed: 1 })
    expect(layers()).toHaveLength(count + 1)
    engine.dispose()
  })

  it('stops scheduling entirely while paused, and swells back in on resume', () => {
    const engine = createMusicEngine(asAudioContext(ctx), out as unknown as AudioNode)
    engine.setMood(calm('drizzle'))
    engine.resume()
    advance(5)
    engine.pause()
    expect(engine.playing).toBe(false)
    const [layer] = layers()
    expect((layer.outputs[0] as FakeGain).gain.calls.at(-1)?.[1]).toBe(0)

    const count = ctx.oscillators().length
    advance(60)
    expect(ctx.oscillators()).toHaveLength(count)
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1) // only the old layer's cleanup

    engine.resume()
    expect(ctx.oscillators().length).toBeGreaterThan(count)
    // Starts from now, not from where it left off.
    for (const osc of ctx.oscillators().slice(count)) {
      expect(osc.startAt!).toBeGreaterThanOrEqual(ctx.currentTime)
    }
    engine.dispose()
  })
})
