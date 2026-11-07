import { defaultAutoPause, migrateAutoPause, type AutoPauseSettings } from './autoPause'
import { defaultFeats } from './content/achievements'
import { defaultMeta, emptyCitadelPerks, migrateMeta } from './content/meta'
import { migrateOrders } from './engine/orders'
import { defaultDecreeState } from './engine/structure'
import { createTimeline } from './engine/timeline'
import { defaultCaravan } from './engine/trade'
import type { MetaState, RunState } from './types'

/**
 * The original single run save. It is now the autosave slot's key (see
 * `saveSlots.ts`), so a save from before slots is already in place.
 */
export const RUN_KEY = 'emberwatch.run.v1'
const META_KEY = 'emberwatch.meta.v1'
const SETTINGS_KEY = 'emberwatch.settings.v1'

export interface Settings {
  /** Pause when the tab or app is hidden (choices always halt the sim). */
  pauseOnBlur: boolean
  /** Opt-in pauses for in-run moments: a threat, a decree, the Storm... */
  autoPause: AutoPauseSettings
  /** Master switch (mute) for the synthesised cues, rain and music. */
  sound: boolean
  /** Mixer levels, 0..1 each; `sound: false` silences all of them. */
  volume: VolumeSettings
  /** Map renderer. 3D falls back to 2D automatically where WebGL is missing. */
  renderer: '3d' | '2d'
  /** Real-time shadows in the 3D view — the main GPU cost on weak devices. */
  shadows: boolean
  /** A small fps / frame time / draw call readout over the map (off by default). */
  showPerf: boolean
}

export type VolumeChannel = 'master' | 'music' | 'effects' | 'ambience'
export type VolumeSettings = Record<VolumeChannel, number>

/**
 * Master, effects and rain start at full level, so the mix of cues and rain
 * players already know is unchanged. The ambient score starts low rather than
 * off: 30% on the slider, which the squared gain curve makes about -21 dB. It
 * is new and plays for the whole run under the rain and every cue, so a quiet
 * bed that players can turn up beats a loud one they must hunt for a slider to
 * silence; but leaving it on means they discover it exists at all. It waits
 * for the same first gesture as every other sound and is silent while muted.
 */
export function defaultVolume(): VolumeSettings {
  return { master: 1, music: 0.3, effects: 1, ambience: 1 }
}

/** Fills in missing or invalid levels (older saves have none) and clamps to 0..1. */
export function migrateVolume(raw: unknown): VolumeSettings {
  const volume = defaultVolume()
  if (!raw || typeof raw !== 'object') return volume
  for (const channel of Object.keys(volume) as VolumeChannel[]) {
    const value = (raw as Record<string, unknown>)[channel]
    if (typeof value === 'number' && Number.isFinite(value)) {
      volume[channel] = Math.min(1, Math.max(0, value))
    }
  }
  return volume
}

export function defaultSettings(): Settings {
  return {
    pauseOnBlur: true,
    autoPause: defaultAutoPause(),
    sound: true,
    volume: defaultVolume(),
    renderer: '3d',
    // Phones and small screens start without shadows (the main 3D GPU cost
    // there); the menu's Shadows setting turns them back on.
    shadows: !smallOrTouchScreen(),
    showPerf: false,
  }
}

function smallOrTouchScreen(): boolean {
  if (typeof window === 'undefined') return false
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return coarse || Math.min(window.innerWidth, window.innerHeight) < 600
}

export function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    // Corrupt or unavailable storage should never block the game.
    return null
  }
}

function write(key: string, value: unknown): void {
  writeChecked(key, value)
}

/** Why a write did not land: storage is full, or there is no storage at all. */
export type WriteFailure = 'quota' | 'unavailable'

/** True for the many spellings browsers use for "storage is full". */
export function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const e = error as { name?: string; code?: number }
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  )
}

/**
 * Writes JSON and says whether it landed. A failed `setItem` leaves the old
 * value untouched, so a save that does not fit never corrupts the last one.
 */
export function writeChecked(key: string, value: unknown): WriteFailure | null {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
    return null
  } catch (error) {
    // Quota exceeded / private mode — the run stays in memory either way.
    return isQuotaError(error) ? 'quota' : 'unavailable'
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/** Loads the run in the autosave slot (the original single save). */
export function loadRun(key: string = RUN_KEY): RunState | null {
  return migrateRun(read<unknown>(key))
}

/**
 * Brings a parsed save up to the current shape, or returns null when it is
 * not a run at all. Shared by local saves and imported files, so both get the
 * same defaults for anything an older version did not write.
 */
export function migrateRun(raw: unknown): RunState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const run = raw as RunState
  // Saves from the old tile-based world lack `world`/`deposits` and are
  // silently dropped — their layout no longer exists.
  if (!run || typeof run.seed !== 'number' || !run.world || !run.deposits) return null
  // Saves from before threats/caravans/ongoing effects get safe defaults.
  run.threats ??= []
  run.threatCounter ??= 0
  run.ongoing ??= []
  run.caravan ??= defaultCaravan()
  run.rerollsUsed ??= 0
  run.soothesUsed ??= 0
  // Saves from before braziers were a starting blueprint still get one.
  if (Array.isArray(run.unlockedBuildings) && !run.unlockedBuildings.includes('brazier')) {
    run.unlockedBuildings.push('brazier')
  }
  // Saves from before decrees, charters and lingering conditions.
  run.conditions ??= []
  run.conditionCounter ??= 0
  const decreeDefaults = defaultDecreeState()
  run.decree ??= decreeDefaults.decree
  run.decreeTimer ??= decreeDefaults.decreeTimer
  run.charterOffered ??= false
  // Saves from before decree streaks and order choices.
  run.decreeStreak ??= 0
  migrateOrders(run)
  run.charter ??= null
  // Saves from before the Citadel tree and the Queen's Edicts.
  run.edict ??= 0
  run.citadel = { ...emptyCitadelPerks(), ...(run.citadel ?? {}) }
  // Saves from before building upgrades: every building stands at tier 0.
  for (const b of Object.values(run.buildings ?? {})) b.tier ??= 0
  // Saves from before run modifiers: the land had no particular character.
  if (!Array.isArray(run.runModifiers)) run.runModifiers = []
  // Saves from before commissions have none; a mangled one reads as none.
  if (run.commission !== undefined && typeof run.commission !== 'string') delete run.commission
  // Saves from before the run timeline start an empty one where they resume.
  run.timeline ??= createTimeline(run)
  // Saves from before roads have none. With no roads every building works as
  // it always did (the road bonus is purely additive), so nothing weakens.
  if (!Array.isArray(run.roads)) run.roads = []
  run.roadCounter ??= run.roads.length
  // Saves from before achievements: nothing remarkable recorded yet.
  run.feats = { ...defaultFeats(), ...(run.feats ?? {}) }
  return run
}

/** Writes (or with null, clears) the autosave slot's run. */
export function saveRun(run: RunState | null, key: string = RUN_KEY): WriteFailure | null {
  if (!run) {
    removeKey(key)
    return null
  }
  return writeChecked(key, run)
}

export function loadMeta(): MetaState {
  const raw = read<unknown>(META_KEY)
  // Older versions are migrated in place rather than discarded: supplies and
  // upgrades are the player's progress and must survive any format change.
  return raw ? migrateMeta(raw) : defaultMeta()
}

export function saveMeta(meta: MetaState): void {
  write(META_KEY, meta)
}

export function loadSettings(): Settings {
  const saved = read<Partial<Settings>>(SETTINGS_KEY) ?? {}
  // Settings saved before auto-pause or the volume mixer existed (or with a
  // partial set of either) get the defaults for whatever is missing.
  return {
    ...defaultSettings(),
    ...saved,
    autoPause: migrateAutoPause(saved.autoPause),
    volume: migrateVolume(saved.volume),
    // Opt-in only: anything but an explicit `true` (older saves have none) is off.
    showPerf: saved.showPerf === true,
  }
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings)
}
