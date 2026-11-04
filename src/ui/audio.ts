import type { Season } from '../game/types'

/**
 * Asset-free audio: every cue is synthesised with WebAudio oscillators, and the
 * rain ambience is looped filtered noise whose character follows the season.
 * The context is created lazily on the first user gesture (autoplay policy).
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

let ctx: AudioContext | null = null
let master: GainNode | null = null
let rainSource: AudioBufferSourceNode | null = null
let rainFilter: BiquadFilterNode | null = null
let rainGain: GainNode | null = null
let muted = false

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = muted ? 0 : 1
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Call from a pointerdown/keydown handler so the context may start. */
export function unlockAudio(): void {
  ensureContext()
}

export function setMuted(value: boolean): void {
  muted = value
  if (master && ctx) {
    master.gain.setTargetAtTime(value ? 0 : 1, ctx.currentTime, 0.05)
  }
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
  const c = ensureContext()
  if (!c || !master || muted) return
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
    gain.connect(master)
    osc.start(now + n.at)
    osc.stop(now + n.at + n.d + 0.05)
  }
}

/** A short burst of filtered noise (knocks, rumbles, stings). */
function noiseBurst(duration: number, frequency: number, gainValue: number): void {
  const c = ensureContext()
  if (!c || !master || muted) return
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
  gain.connect(master)
  source.start(now)
}

export function cue(name: Cue): void {
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
  const c = ensureContext()
  if (!c || !master) return

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
    rainGain.connect(master)
    rainSource.start()
  }

  const target = RAIN[season]
  rainGain!.gain.setTargetAtTime(target.gain, c.currentTime, 1.2)
  rainFilter!.frequency.setTargetAtTime(target.freq, c.currentTime, 1.2)
}
