import { defaultVolume, type VolumeSettings } from '../game/persistence'
import type { Season } from '../game/types'
import type { MusicEngine, MusicMood } from './music'

/**
 * Asset-free audio: every cue is synthesised with WebAudio oscillators, the
 * rain ambience is looped filtered noise whose character follows the season,
 * and the ambient score (./music, loaded on demand) is generated live.
 *
 * The graph is a small mixer:
 *
 *   cues ──────────────► effects ──┐
 *   rain ──────────────► ambience ─┼─► master ─► destination
 *   score ─► duck ─────► music ────┘
 *
 * `master` carries the master level and the mute; each bus carries its own
 * slider; `duck` dips the score under event cues. The context is created, and
 * resumed, only from a user gesture (autoplay policy): until `unlockAudio` has
 * run, every call just records what it wants and plays nothing.
 */

export type Cue =
  | 'seasonDrizzle'
  | 'seasonClearance'
  | 'seasonStorm'
  | 'orderComplete'
  | 'draftOpen'
  | 'place'
  | 'placeError'
  | 'buildComplete'
  | 'villagerLeft'
  | 'villagerArrived'
  | 'threat'
  | 'threatStrike'
  | 'gladeCleared'
  | 'storageFull'
  | 'caravan'
  | 'caravanLeaving'
  | 'won'
  | 'lost'

export type { MusicMood }

interface Graph {
  ctx: AudioContext
  master: GainNode
  effects: GainNode
  ambience: GainNode
  music: GainNode
  duck: GainNode
}

let graph: Graph | null = null
let gestured = false
let rainSource: AudioBufferSourceNode | null = null
let rainFilter: BiquadFilterNode | null = null
let rainGain: GainNode | null = null
let muted = false
let volume: VolumeSettings = defaultVolume()
let wantedRain: Season | null = null
let musicMood: MusicMood | null = null
let musicHeld = false
let musicEngine: MusicEngine | null = null
let musicLoading: Promise<void> | null = null
/** Set once creating the context has failed: the game then plays on silent. */
let audioUnavailable = false

/**
 * Sound is presentation only. A failure anywhere in it (a browser refusing a
 * context, a node that cannot be scheduled) is logged once and swallowed,
 * because the cues run inside the store's updates, where a throw would abort
 * the sim step or command that triggered them.
 */
let loggedFailure = false
function safely(what: string, fn: () => void): void {
  try {
    fn()
  } catch (error) {
    if (!loggedFailure) {
      loggedFailure = true
      console.warn(`Sound failed (${what}); the game plays on.`, error)
    }
  }
}

/** Slider position (0..1) to gain: squared, so the travel feels even to the ear. */
export function levelToGain(level: number): number {
  const v = Math.min(1, Math.max(0, level))
  return v * v
}

/** How far the score dips under an event cue, and how long it stays down. */
const DUCK_GAIN = 0.3
const DUCK_HOLD_S = 1.4

/** Smoothing time constant for slider and mute changes (no zipper noise). */
const LEVEL_SMOOTH_S = 0.05

/**
 * Has the page seen a user gesture? Our own pointer/key listener says so, and
 * so does the browser's sticky activation where it reports it: the click on
 * "Set out" that mounts the game counts, even though the game's listener was
 * not attached yet.
 */
function hasGesture(): boolean {
  if (gestured) return true
  const activation = (globalThis.navigator as { userActivation?: { hasBeenActive?: boolean } })
    ?.userActivation
  return activation?.hasBeenActive === true
}

function ensureContext(): Graph | null {
  if (!hasGesture() || audioUnavailable) return null
  if (typeof AudioContext === 'undefined') return null
  if (!graph) {
    try {
      graph = createGraph()
    } catch (error) {
      // Some browsers refuse a context (too many open, a locked-down policy).
      audioUnavailable = true
      console.warn('Sound is unavailable here; the game plays on silent.', error)
      return null
    }
  }
  if (graph.ctx.state === 'suspended') {
    try {
      // Resuming is a promise that rejects when the browser says no (no
      // gesture yet); the next gesture tries again.
      void Promise.resolve(graph.ctx.resume()).catch(() => undefined)
    } catch {
      /* the next gesture tries again */
    }
  }
  return graph
}

function createGraph(): Graph {
  const ctx = new AudioContext()
  const master = ctx.createGain()
  master.gain.value = muted ? 0 : levelToGain(volume.master)
  master.connect(ctx.destination)
  const bus = (level: number) => {
    const node = ctx.createGain()
    node.gain.value = levelToGain(level)
    node.connect(master)
    return node
  }
  const effects = bus(volume.effects)
  const ambience = bus(volume.ambience)
  const music = bus(volume.music)
  const duck = ctx.createGain()
  duck.gain.value = 1
  duck.connect(music)
  return { ctx, master, effects, ambience, music, duck }
}

/**
 * Call from a pointerdown/keydown handler: the first call creates the
 * context, later ones resume it if the browser suspended it.
 */
export function unlockAudio(): void {
  gestured = true
  safely('unlock', () => {
    const fresh = graph === null
    if (!ensureContext() || !fresh) return
    // Anything asked for before the gesture starts now.
    applyRain()
    syncMusic()
  })
}

export function setMuted(value: boolean): void {
  muted = value
  safely('mute', () => {
    if (graph) {
      graph.master.gain.setTargetAtTime(
        value ? 0 : levelToGain(volume.master),
        graph.ctx.currentTime,
        LEVEL_SMOOTH_S,
      )
    }
    syncMusic()
  })
}

/** Applies the mixer levels; cheap to call on every settings change. */
export function setVolume(next: VolumeSettings): void {
  volume = { ...next }
  safely('volume', () => {
    if (graph) {
      const t = graph.ctx.currentTime
      graph.master.gain.setTargetAtTime(muted ? 0 : levelToGain(volume.master), t, LEVEL_SMOOTH_S)
      graph.effects.gain.setTargetAtTime(levelToGain(volume.effects), t, LEVEL_SMOOTH_S)
      graph.ambience.gain.setTargetAtTime(levelToGain(volume.ambience), t, LEVEL_SMOOTH_S)
      graph.music.gain.setTargetAtTime(levelToGain(volume.music), t, LEVEL_SMOOTH_S)
    }
    syncMusic()
  })
}

/** True when a channel can be heard at all: not muted, neither slider at 0. */
function audible(level: number): boolean {
  return !muted && volume.master > 0 && level > 0
}

interface Note {
  /** Frequency in Hz. */
  f: number
  /** Start offset in seconds. */
  at: number
  /** Duration in seconds. */
  d: number
  /** Peak gain. */
  g?: number
  type?: OscillatorType
}

function play(notes: Note[]): void {
  const g = ensureContext()
  if (!g || !audible(volume.effects)) return
  const c = g.ctx
  const now = c.currentTime
  for (const n of notes) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = n.type ?? 'sine'
    osc.frequency.value = n.f
    const peak = n.g ?? 0.08
    gain.gain.setValueAtTime(0, now + n.at)
    gain.gain.linearRampToValueAtTime(peak, now + n.at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + n.at + n.d)
    osc.connect(gain)
    gain.connect(g.effects)
    osc.start(now + n.at)
    osc.stop(now + n.at + n.d + 0.05)
  }
}

/** A short burst of filtered noise (knocks, rumbles, stings). */
function noiseBurst(duration: number, frequency: number, gainValue: number): void {
  const g = ensureContext()
  if (!g || !audible(volume.effects)) return
  const c = g.ctx
  const length = Math.ceil(c.sampleRate * duration)
  const buffer = c.createBuffer(1, length, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  const source = c.createBufferSource()
  source.buffer = buffer
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = frequency
  filter.Q.value = 1
  const gain = c.createGain()
  const now = c.currentTime
  gain.gain.setValueAtTime(gainValue, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(g.effects)
  source.start(now)
}

/**
 * Cues that announce an event rather than confirm an action: the score dips
 * under these so they read clearly. Placement clicks and refusals are too
 * frequent to duck for; the music would pump.
 */
const DUCKING_CUES: ReadonlySet<Cue> = new Set<Cue>([
  'seasonDrizzle',
  'seasonClearance',
  'seasonStorm',
  'orderComplete',
  'draftOpen',
  'villagerLeft',
  'villagerArrived',
  'threat',
  'threatStrike',
  'gladeCleared',
  'caravan',
  'caravanLeaving',
  'won',
  'lost',
])

/** Dips the score for a moment, then lets it swell back. */
function duckMusic(): void {
  if (!graph || !musicEngine || !audible(volume.effects)) return
  const { duck, ctx } = graph
  const now = ctx.currentTime
  duck.gain.cancelScheduledValues(now)
  duck.gain.setTargetAtTime(DUCK_GAIN, now, 0.06)
  duck.gain.setTargetAtTime(1, now + DUCK_HOLD_S, 0.6)
}

export function cue(name: Cue): void {
  safely(name, () => playCue(name))
}

function playCue(name: Cue): void {
  if (DUCKING_CUES.has(name)) duckMusic()
  switch (name) {
    case 'seasonDrizzle':
      play([
        { f: 392, at: 0, d: 0.35 },
        { f: 494, at: 0.12, d: 0.35 },
        { f: 587, at: 0.24, d: 0.5 },
      ])
      break
    case 'seasonClearance':
      play([
        { f: 523, at: 0, d: 0.3 },
        { f: 659, at: 0.1, d: 0.3 },
        { f: 784, at: 0.2, d: 0.55 },
      ])
      break
    case 'seasonStorm':
      play([
        { f: 98, at: 0, d: 1.2, g: 0.14, type: 'sawtooth' },
        { f: 73.4, at: 0.25, d: 1.4, g: 0.12, type: 'sawtooth' },
      ])
      noiseBurst(1.2, 220, 0.1)
      break
    case 'orderComplete':
      play([
        { f: 587, at: 0, d: 0.2 },
        { f: 880, at: 0.12, d: 0.4, g: 0.1 },
      ])
      break
    case 'draftOpen':
      play([
        { f: 440, at: 0, d: 0.5, g: 0.06, type: 'triangle' },
        { f: 660, at: 0.05, d: 0.6, g: 0.05, type: 'triangle' },
      ])
      break
    case 'place':
      // A soft stake-in-the-ground thunk.
      noiseBurst(0.07, 420, 0.09)
      break
    case 'placeError':
      // A low, brief refusal.
      play([
        { f: 165, at: 0, d: 0.14, g: 0.05, type: 'square' },
        { f: 123, at: 0.07, d: 0.16, g: 0.045, type: 'square' },
      ])
      break
    case 'buildComplete':
      noiseBurst(0.12, 900, 0.12)
      play([{ f: 330, at: 0.08, d: 0.25, g: 0.07, type: 'triangle' }])
      break
    case 'villagerLeft':
      play([
        { f: 440, at: 0, d: 0.3 },
        { f: 349, at: 0.18, d: 0.35 },
        { f: 262, at: 0.38, d: 0.5 },
      ])
      break
    case 'villagerArrived':
      play([
        { f: 523, at: 0, d: 0.18, g: 0.06 },
        { f: 659, at: 0.09, d: 0.3, g: 0.06 },
      ])
      break
    case 'threat':
      play([
        { f: 466, at: 0, d: 0.4, g: 0.1, type: 'square' },
        { f: 440, at: 0.02, d: 0.45, g: 0.1, type: 'square' },
      ])
      break
    case 'threatStrike':
      // The threat's dissonant pair, lower and with a crash behind it.
      noiseBurst(0.35, 260, 0.13)
      play([
        { f: 233, at: 0, d: 0.45, g: 0.09, type: 'square' },
        { f: 220, at: 0.02, d: 0.5, g: 0.09, type: 'square' },
      ])
      break
    case 'gladeCleared':
      // Branches giving way, then an open, rising triad.
      noiseBurst(0.22, 1600, 0.07)
      play([
        { f: 392, at: 0.05, d: 0.25, g: 0.06, type: 'triangle' },
        { f: 494, at: 0.15, d: 0.25, g: 0.06, type: 'triangle' },
        { f: 587, at: 0.25, d: 0.45, g: 0.07, type: 'triangle' },
      ])
      break
    case 'storageFull':
      // Two dull knocks on a crate that will not take any more.
      noiseBurst(0.08, 380, 0.1)
      play([
        { f: 147, at: 0, d: 0.16, g: 0.05, type: 'square' },
        { f: 147, at: 0.2, d: 0.2, g: 0.05, type: 'square' },
      ])
      break
    case 'caravanLeaving':
      // The arrival bells, falling away.
      play([
        { f: 880, at: 0, d: 0.2, g: 0.06, type: 'triangle' },
        { f: 587, at: 0.2, d: 0.15, g: 0.05, type: 'triangle' },
        { f: 440, at: 0.38, d: 0.35, g: 0.04, type: 'triangle' },
      ])
      break
    case 'caravan':
      play([
        { f: 587, at: 0, d: 0.15, g: 0.06, type: 'triangle' },
        { f: 587, at: 0.18, d: 0.15, g: 0.06, type: 'triangle' },
        { f: 880, at: 0.36, d: 0.35, g: 0.07, type: 'triangle' },
      ])
      break
    case 'won':
      play([
        { f: 523, at: 0, d: 0.3 },
        { f: 659, at: 0.15, d: 0.3 },
        { f: 784, at: 0.3, d: 0.3 },
        { f: 1047, at: 0.45, d: 0.8, g: 0.1 },
      ])
      break
    case 'lost':
      play([
        { f: 311, at: 0, d: 0.5, type: 'triangle' },
        { f: 262, at: 0.3, d: 0.6, type: 'triangle' },
        { f: 196, at: 0.6, d: 1.1, g: 0.1, type: 'triangle' },
      ])
      break
  }
}

/** Rain character by season: gain and filter brightness. */
const RAIN: Record<Season, { gain: number; freq: number }> = {
  drizzle: { gain: 0.035, freq: 2600 },
  clearance: { gain: 0.012, freq: 3200 },
  storm: { gain: 0.09, freq: 1200 },
}

/** Starts (or retunes) the rain loop for the given season; null stops it. */
export function setRainSeason(season: Season | null): void {
  wantedRain = season
  safely('rain', applyRain)
}

function applyRain(): void {
  const g = ensureContext()
  if (!g) return
  const c = g.ctx
  const season = wantedRain

  if (season === null) {
    if (rainGain) rainGain.gain.setTargetAtTime(0, c.currentTime, 0.4)
    return
  }

  if (!rainSource) {
    // Two seconds of looped white noise through a bandpass reads as rain.
    const length = c.sampleRate * 2
    const buffer = c.createBuffer(1, length, c.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    rainSource = c.createBufferSource()
    rainSource.buffer = buffer
    rainSource.loop = true
    rainFilter = c.createBiquadFilter()
    rainFilter.type = 'bandpass'
    rainFilter.Q.value = 0.6
    rainGain = c.createGain()
    rainGain.gain.value = 0
    rainSource.connect(rainFilter)
    rainFilter.connect(rainGain)
    rainGain.connect(g.ambience)
    rainSource.start()
  }

  const target = RAIN[season]
  rainGain!.gain.setTargetAtTime(target.gain, c.currentTime, 1.2)
  rainFilter!.frequency.setTargetAtTime(target.freq, c.currentTime, 1.2)
}

// ---------------------------------------------------------------------------
// Ambient score
// ---------------------------------------------------------------------------

/** What the score should play; null when no run is on screen. */
export function setMusicMood(mood: MusicMood | null): void {
  musicMood = mood
  safely('music', syncMusic)
}

/** Holds the score while the game is paused or the tab is hidden. */
export function setMusicHeld(held: boolean): void {
  musicHeld = held
  safely('music', syncMusic)
}

/**
 * Starts, retunes or stops the score to match what is wanted. The engine is
 * its own chunk, fetched the first time the score would actually be heard, so
 * players who keep music at 0 never download it. It schedules notes on the
 * audio clock about once a second and stops scheduling entirely while held,
 * muted or turned down to nothing.
 */
function syncMusic(): void {
  if (musicMood === null || musicHeld || !audible(volume.music)) {
    musicEngine?.pause()
    return
  }
  // Wanting the score is reason enough to open the context, after a gesture.
  const g = ensureContext()
  if (!g) return
  if (!musicEngine) {
    if (!musicLoading) {
      musicLoading = import('./music')
        .then((m) => {
          if (graph === g) musicEngine = m.createMusicEngine(g.ctx, g.duck)
        })
        .catch(() => {
          // Offline before the chunk was cached: the game plays on without a score.
        })
        .finally(() => {
          musicLoading = null
          if (musicEngine) safely('music', syncMusic)
        })
    }
    return
  }
  musicEngine.setMood(musicMood)
  musicEngine.resume()
}

/** Resolves once an in-flight load of the score engine has settled (tests). */
export function musicReady(): Promise<void> {
  return musicLoading ?? Promise.resolve()
}

/** The live graph, for tests that check the wiring. */
export function audioGraphForTests() {
  return { ...graph, rainGain, musicEngine }
}

/** Forgets the context and everything wanted, as on a fresh page (tests). */
export function resetAudioForTests(): void {
  musicEngine?.dispose()
  graph = null
  gestured = false
  audioUnavailable = false
  loggedFailure = false
  rainSource = null
  rainFilter = null
  rainGain = null
  muted = false
  volume = defaultVolume()
  wantedRain = null
  musicMood = null
  musicHeld = false
  musicEngine = null
  musicLoading = null
}
