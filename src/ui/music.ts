import type { Season } from '../game/types'

/**
 * The ambient score: slow pads with sparse melodic motifs, generated live from
 * oscillators and shaped by the season. No recorded assets.
 *
 * Two halves, so the music can be tested without an AudioContext:
 *
 * - `Composer` is pure. Each call to `next(mood)` writes one bar: a chord
 *   chosen by a weighted walk that keeps drifting home, a pad voicing of it,
 *   and now and then a short motif (often a variation of the last one, so the
 *   score has a memory). Its randomness is a seeded PRNG, so a run's score is
 *   reproducible and never lurches, yet it does not loop: the walk and the
 *   motifs never line up into the same sequence twice.
 * - `createMusicEngine` plays bars on the audio clock. A timer wakes about
 *   once a second and schedules whatever falls within the next few seconds;
 *   there is no per-frame JavaScript, and nothing runs at all while paused.
 *   Each mood plays into its own layer (filter + gain), so a change of season
 *   is a crossfade: the old layer's notes ring out as it fades, while the new
 *   one swells in.
 *
 * This module is loaded on demand by ./audio the first time the score would
 * be heard, so it must stay free of heavy imports.
 */

export interface MusicMood {
  season: Season
  /** A threat is loose or the Queen's impatience is high. */
  tense: boolean
  /** Seeds the composer: one settlement, one score. */
  seed?: number
}

export interface Palette {
  /** MIDI note of the tonic in the pad register. */
  root: number
  /** Scale as semitones above the root. */
  scale: readonly number[]
  /** Chords as scale-degree triads; index 0 is home. */
  chords: readonly (readonly number[])[]
  /** Seconds per bar: one chord. */
  barSeconds: number
  /** Lowpass cutoff over the whole layer, in Hz. */
  cutoff: number
  padWave: OscillatorType
  padGain: number
  /** Detune of the pad's second oscillator, for slow beating. */
  detuneCents: number
  /** Chance that a bar carries a motif. */
  motifChance: number
  /** Motif register, in semitones above the pad. */
  motifOctave: number
  motifGain: number
  /** A sustained root an octave under the pad. */
  drone: boolean
}

const DORIAN = [0, 2, 3, 5, 7, 9, 10]
const LYDIAN = [0, 2, 4, 6, 7, 9, 11]
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10]

const triads = (degrees: number[]) => degrees.map((d) => [d, d + 2, d + 4])

/**
 * Drizzle is D dorian in the middle register: soft triangle pads, a motif in
 * about half the bars. Clearance lifts to G lydian, brighter (pure sines, an
 * open filter, motifs most bars). The Storm drops to A aeolian an octave and
 * more below, slower bars under a closed filter with a drone, and few motifs.
 */
export const PALETTES: Record<Season, Palette> = {
  drizzle: {
    root: 50, // D3
    scale: DORIAN,
    chords: triads([0, 6, 3, 2, 4]), // Dm C G F Am
    barSeconds: 8,
    cutoff: 1500,
    padWave: 'triangle',
    padGain: 0.07,
    detuneCents: 4,
    motifChance: 0.45,
    motifOctave: 12,
    motifGain: 0.06,
    drone: false,
  },
  clearance: {
    root: 55, // G3
    scale: LYDIAN,
    chords: triads([0, 4, 5, 1, 6]), // G D Em A F#m
    barSeconds: 7,
    cutoff: 2600,
    padWave: 'sine',
    padGain: 0.075,
    detuneCents: 3,
    motifChance: 0.6,
    motifOctave: 12,
    motifGain: 0.055,
    drone: false,
  },
  storm: {
    root: 45, // A2
    scale: AEOLIAN,
    chords: triads([0, 5, 3, 6]), // Am F Dm G
    barSeconds: 10,
    cutoff: 800,
    padWave: 'sawtooth',
    padGain: 0.045,
    detuneCents: 7,
    motifChance: 0.25,
    motifOctave: 12,
    motifGain: 0.05,
    drone: true,
  },
}

/**
 * The season's palette, shaded when tense: a darker filter, wider beating,
 * a drone underneath, fewer motifs and slightly longer bars. Subtle on
 * purpose; the threat bar and the impatience meter carry the information.
 */
export function paletteFor(mood: MusicMood): Palette {
  const base = PALETTES[mood.season]
  if (!mood.tense) return base
  return {
    ...base,
    cutoff: Math.round(base.cutoff * 0.7),
    detuneCents: base.detuneCents + 6,
    motifChance: base.motifChance * 0.6,
    barSeconds: base.barSeconds * 1.15,
    drone: true,
  }
}

export type MusicVoice = 'pad' | 'motif' | 'drone'

export interface MusicNote {
  voice: MusicVoice
  /** Seconds from the start of the bar. */
  at: number
  /** Seconds the note sounds, release included. */
  dur: number
  midi: number
  gain: number
}

export interface MusicBar {
  /** Index into the palette's chords. */
  chord: number
  length: number
  notes: MusicNote[]
  palette: Palette
}

/** Small, fast, seedable PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function degreeToMidi(palette: Palette, degree: number): number {
  const n = palette.scale.length
  const octave = Math.floor(degree / n)
  return palette.root + palette.scale[((degree % n) + n) % n] + 12 * octave
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

const DEFAULT_SEED = 0x5eed

export class Composer {
  private rng: () => number
  private chord = 0
  private sinceHome = 0
  /** Scale-step intervals of the last motif, reused as variations. */
  private lastContour: number[] | null = null

  constructor(readonly seed: number = DEFAULT_SEED) {
    this.rng = mulberry32(seed)
  }

  /** Writes the next bar for the mood. */
  next(mood: MusicMood): MusicBar {
    const palette = paletteFor(mood)
    const chord = this.nextChord(palette)
    const length = palette.barSeconds
    const notes: MusicNote[] = []
    const degrees = palette.chords[chord]

    // The pad overlaps the next bar so the harmony never gaps.
    const padDur = length * 1.3
    for (const d of degrees) {
      notes.push({ voice: 'pad', at: 0, dur: padDur, midi: degreeToMidi(palette, d), gain: palette.padGain })
    }
    // The chord's root underneath, quieter.
    notes.push({
      voice: 'pad',
      at: 0,
      dur: padDur,
      midi: degreeToMidi(palette, degrees[0]) - 12,
      gain: palette.padGain * 0.6,
    })
    if (palette.drone) {
      notes.push({ voice: 'drone', at: 0, dur: padDur, midi: palette.root - 12, gain: palette.padGain * 0.7 })
    }

    if (this.rng() < palette.motifChance) notes.push(...this.motif(palette, degrees, length))
    return { chord, length, notes, palette }
  }

  /** A weighted walk that never repeats a chord and leans home the longer it is away. */
  private nextChord(palette: Palette): number {
    const count = palette.chords.length
    const current = this.chord % count
    let total = 0
    const weights = palette.chords.map((_, i) => {
      const w = i === current ? 0 : i === 0 ? 1 + this.sinceHome * 0.75 : 1
      total += w
      return w
    })
    let pick = this.rng() * total
    let chosen = 0
    for (let i = 0; i < count; i++) {
      pick -= weights[i]
      if (pick < 0) {
        chosen = i
        break
      }
    }
    this.chord = chosen
    this.sinceHome = chosen === 0 ? 0 : this.sinceHome + 1
    return chosen
  }

  /** Two to four notes from a chord tone, stepping through the scale. */
  private motif(palette: Palette, degrees: readonly number[], length: number): MusicNote[] {
    const n = palette.scale.length
    let contour: number[]
    if (this.lastContour && this.rng() < 0.4) {
      // A variation: same shape, maybe inverted, from a new chord tone.
      const invert = this.rng() < 0.5 ? -1 : 1
      contour = this.lastContour.map((step) => step * invert)
    } else {
      const size = 2 + Math.floor(this.rng() * 3)
      const steps = [-2, -1, -1, 1, 1, 2]
      contour = []
      for (let i = 1; i < size; i++) contour.push(steps[Math.floor(this.rng() * steps.length)])
    }
    this.lastContour = contour

    const beat = length / 8
    let at = beat * (1 + Math.floor(this.rng() * 3))
    let degree = degrees[Math.floor(this.rng() * degrees.length)] + n * (palette.motifOctave / 12)
    const gaps = [1, 1, 1.5, 2]
    const notes: MusicNote[] = []
    for (let i = 0; i <= contour.length; i++) {
      if (i > 0) degree += contour[i - 1]
      const gap = beat * gaps[Math.floor(this.rng() * gaps.length)]
      notes.push({
        voice: 'motif',
        at,
        dur: Math.max(1.2, gap * 1.8),
        midi: degreeToMidi(palette, degree),
        gain: palette.motifGain * (1 - 0.12 * i),
      })
      at += gap
    }
    return notes
  }
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

/** How far ahead notes are scheduled, and how often the scheduler wakes. */
export const LOOKAHEAD_S = 4
export const SCHEDULER_TICK_MS = 1000
/** A change of season or mood crossfades over this long. */
export const CROSSFADE_S = 4
/** Pausing fades out quickly; resuming swells back in. */
export const PAUSE_FADE_S = 0.6
export const RESUME_FADE_S = 2.5

export interface MusicEngine {
  setMood(mood: MusicMood): void
  /** Fades out and stops scheduling; nothing runs until `resume`. */
  pause(): void
  resume(): void
  dispose(): void
  readonly playing: boolean
}

interface Layer {
  mood: MusicMood
  gain: GainNode
  filter: BiquadFilterNode
}

function sameMood(a: MusicMood | null, b: MusicMood): boolean {
  return a !== null && a.season === b.season && a.tense === b.tense
}

/**
 * Plays the score into `out`. The engine starts paused: `setMood` says what
 * to play and `resume` starts it.
 */
export function createMusicEngine(ctx: BaseAudioContext, out: AudioNode): MusicEngine {
  let composer = new Composer()
  let mood: MusicMood | null = null
  let layer: Layer | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let nextBarAt = 0

  function openLayer(m: MusicMood, fadeIn: number): Layer {
    const now = ctx.currentTime
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = paletteFor(m).cutoff
    filter.Q.value = 0.5
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(1, now + fadeIn)
    filter.connect(gain)
    gain.connect(out)
    return { mood: m, gain, filter }
  }

  /** Fades a layer out; its scheduled notes ring on into the fade, then it is cut loose. */
  function closeLayer(old: Layer, fadeOut: number): void {
    const now = ctx.currentTime
    const level = old.gain.gain.value
    old.gain.gain.cancelScheduledValues(now)
    old.gain.gain.setValueAtTime(level, now)
    old.gain.gain.linearRampToValueAtTime(0, now + fadeOut)
    setTimeout(() => old.gain.disconnect(), (fadeOut + LOOKAHEAD_S + 0.5) * 1000)
  }

  function voice(target: AudioNode, note: MusicNote, palette: Palette, start: number): void {
    const end = start + note.dur
    const env = ctx.createGain()
    env.connect(target)
    const freq = midiToHz(note.midi)
    if (note.voice === 'motif') {
      // A soft pluck that rings out.
      env.gain.setValueAtTime(0, start)
      env.gain.linearRampToValueAtTime(note.gain, start + 0.04)
      env.gain.exponentialRampToValueAtTime(0.0001, end)
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = freq
      osc.connect(env)
      osc.start(start)
      osc.stop(end + 0.05)
      return
    }
    // Pads and drones breathe in and out slowly.
    const attack = Math.min(note.dur * 0.35, 3)
    const release = Math.min(note.dur * 0.35, 3)
    env.gain.setValueAtTime(0, start)
    env.gain.linearRampToValueAtTime(note.gain, start + attack)
    env.gain.setValueAtTime(note.gain, end - release)
    env.gain.linearRampToValueAtTime(0, end)
    const waves: [OscillatorType, number][] =
      note.voice === 'drone'
        ? [['sine', 0]]
        : [
            [palette.padWave, 0],
            ['sine', palette.detuneCents],
          ]
    for (const [type, detune] of waves) {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.value = freq
      osc.detune.value = detune
      osc.connect(env)
      osc.start(start)
      osc.stop(end + 0.05)
    }
  }

  function tick(): void {
    if (!layer) return
    const now = ctx.currentTime
    // After a stall (a throttled timer), start fresh rather than catch up.
    if (nextBarAt < now) nextBarAt = now + 0.05
    while (nextBarAt < now + LOOKAHEAD_S) {
      const bar = composer.next(layer.mood)
      for (const note of bar.notes) voice(layer.filter, note, bar.palette, nextBarAt + note.at)
      nextBarAt += bar.length
    }
  }

  function start(fadeIn: number): void {
    if (!mood) return
    layer = openLayer(mood, fadeIn)
    nextBarAt = ctx.currentTime + 0.05
    tick()
  }

  return {
    get playing() {
      return timer !== null
    },

    setMood(next) {
      if (next.seed !== undefined && next.seed !== composer.seed) composer = new Composer(next.seed)
      if (sameMood(mood, next)) {
        mood = next
        return
      }
      mood = next
      if (timer === null || !layer) return
      closeLayer(layer, CROSSFADE_S)
      start(CROSSFADE_S)
    },

    pause() {
      if (timer === null) return
      clearInterval(timer)
      timer = null
      if (layer) closeLayer(layer, PAUSE_FADE_S)
      layer = null
    },

    resume() {
      if (timer !== null || !mood) return
      start(RESUME_FADE_S)
      timer = setInterval(tick, SCHEDULER_TICK_MS)
    },

    dispose() {
      if (timer !== null) clearInterval(timer)
      timer = null
      layer?.gain.disconnect()
      layer = null
    },
  }
}
