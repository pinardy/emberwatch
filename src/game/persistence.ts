import { META_VERSION, defaultMeta } from './content/meta'
import { defaultDecreeState } from './engine/structure'
import { defaultCaravan } from './engine/trade'
import type { MetaState, RunState } from './types'

const RUN_KEY = 'emberwatch.run.v1'
const META_KEY = 'emberwatch.meta.v1'
const SETTINGS_KEY = 'emberwatch.settings.v1'

export interface Settings {
  /** Auto-pause when a choice appears or the window loses focus. */
  pauseOnBlur: boolean
  /** Master switch for the synthesised cues and rain ambience. */
  sound: boolean
  /** Map renderer. 3D falls back to 2D automatically where WebGL is missing. */
  renderer: '3d' | '2d'
  /** Real-time shadows in the 3D view — the main GPU cost on weak devices. */
  shadows: boolean
}

export function defaultSettings(): Settings {
  return { pauseOnBlur: true, sound: true, renderer: '3d', shadows: true }
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    // Corrupt or unavailable storage should never block the game.
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded / private mode — fail quietly, the run stays in memory.
  }
}

export function loadRun(): RunState | null {
  const run = read<RunState>(RUN_KEY)
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
  run.charter ??= null
  return run
}

export function saveRun(run: RunState | null): void {
  if (!run) {
    try {
      localStorage.removeItem(RUN_KEY)
    } catch {
      /* ignore */
    }
    return
  }
  write(RUN_KEY, run)
}

export function loadMeta(): MetaState {
  const meta = read<MetaState>(META_KEY)
  if (!meta || meta.version !== META_VERSION) return defaultMeta()
  return { ...defaultMeta(), ...meta }
}

export function saveMeta(meta: MetaState): void {
  write(META_KEY, meta)
}

export function loadSettings(): Settings {
  return { ...defaultSettings(), ...(read<Partial<Settings>>(SETTINGS_KEY) ?? {}) }
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings)
}
