import { collectWarnings, type Warning } from './engine/diagnostics'
import {
  buildingStatus,
  deadlineForecast,
  foodForecast,
  hearthForecast,
  meterRates,
  storageBlocked,
  stormFoodForecast,
  type BuildingStatus,
  type DeadlineForecast,
  type FoodForecast,
  type HearthForecast,
  type StormFoodForecast,
} from './engine/forecast'
import { computeModifiers, type Modifiers } from './engine/modifiers'
import { secondsUntilDeparture, storageUsed } from './engine/queries'
import { withRunCache } from './engine/runCache'
import { resolveBreakdowns, type ResolveBreakdown } from './engine/society'
import { useGameStore } from './store'
import type { BuildingInstance, RunState, SpeciesId } from './types'

/**
 * Everything the HUD derives from the run, computed at most once per sim step
 * and shared by every component that shows it (the top bar, the stockpile
 * strip, the warnings, the toasts, the sound cues, the maps' status badges).
 * Several of these walk the whole settlement; before this each consumer
 * recomputed its own copy every frame.
 *
 * Get one with `frameDerived(run, version)` (or the store's `useFrameDerived`
 * hook). Fields are lazy: nothing is computed until something reads it, and
 * everything is computed inside one `withRunCache` scope, so adjacency and the
 * settlement counts are shared with the tick. The values are exactly what the
 * engine functions return for the run at this version; only the Storm food
 * forecast inside the warnings is refreshed at most every
 * `STORM_FORECAST_SIM_SECONDS` of sim time (and after every command).
 */
export interface FrameDerived {
  run: RunState
  version: number
  mods: Modifiers
  /** `storageUsed(run)`. */
  storageUsed: number
  /** `storageBlocked(run, mods)`: producers halted at a full stockpile. */
  storageBlocked: BuildingInstance[]
  /** `foodForecast(run, mods)`. */
  food: FoodForecast
  /** `collectWarnings(run)`, in its own order (not sorted or capped). */
  warnings: Warning[]
  /** The top bar's meters and forecasts. */
  topBar: {
    breakdowns: ResolveBreakdown[]
    rates: { impatiencePerMinute: number; hostilityPerMinute: number }
    hearth: HearthForecast
    departures: Partial<Record<SpeciesId, number>>
    deadline: DeadlineForecast
  }
  /**
   * `buildingStatus(run, b, mods, storageUsed)`. The first lookup fills in
   * every building's at once, so a pass over the settlement is linear.
   */
  status(b: BuildingInstance): BuildingStatus
}

/** Sim seconds a Storm food forecast stays good for the warnings strip. */
export const STORM_FORECAST_SIM_SECONDS = 0.5

interface StormMemo {
  buildings: RunState['buildings']
  at: number
  season: string
  year: number
  value: StormFoodForecast
}

let current: FrameDerived | null = null
/** Sim clock when `current` was made. */
let lastClock = Number.NaN
let storm: StormMemo | null = null

/** The Storm food forecast, reused for a moment of sim time (see above). */
function throttledStormForecast(s: RunState, mods: Modifiers): StormFoodForecast {
  if (
    storm &&
    storm.buildings === s.buildings &&
    storm.season === s.season.season &&
    storm.year === s.season.year &&
    s.clock >= storm.at &&
    s.clock - storm.at < STORM_FORECAST_SIM_SECONDS
  ) {
    return storm.value
  }
  const value = stormFoodForecast(s, mods)
  storm = { buildings: s.buildings, at: s.clock, season: s.season.season, year: s.season.year, value }
  return value
}

class Derived implements FrameDerived {
  private cache = new Map<string, unknown>()
  private statuses = new Map<BuildingInstance, BuildingStatus>()

  constructor(
    readonly run: RunState,
    readonly version: number,
  ) {}

  private memo<T>(key: string, compute: () => T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T
    const value = withRunCache(this.run, compute)
    this.cache.set(key, value)
    return value
  }

  get mods(): Modifiers {
    return this.memo('mods', () => computeModifiers(this.run))
  }

  get storageUsed(): number {
    return this.memo('storageUsed', () => storageUsed(this.run))
  }

  get storageBlocked(): BuildingInstance[] {
    return this.memo('storageBlocked', () => storageBlocked(this.run, this.mods))
  }

  get food(): FoodForecast {
    return this.memo('food', () => foodForecast(this.run, this.mods))
  }

  get warnings(): Warning[] {
    return this.memo('warnings', () =>
      collectWarnings(this.run, {
        mods: this.mods,
        blocked: this.storageBlocked,
        stormFood: throttledStormForecast,
      }),
    )
  }

  get topBar(): FrameDerived['topBar'] {
    return this.memo('topBar', () => {
      const run = this.run
      const mods = this.mods
      return {
        breakdowns: resolveBreakdowns(run, mods),
        rates: meterRates(run, mods),
        hearth: hearthForecast(run, mods),
        departures: secondsUntilDeparture(run),
        deadline: deadlineForecast(run, mods),
      }
    })
  }

  /**
   * Every building's status is filled in on the first lookup, inside one
   * run-cache scope: opening a scope checks every building against the
   * cache's snapshot, so a scope per lookup made a map's pass over the
   * settlement quadratic. A building that is not in the run (none should be)
   * gets its own scope.
   */
  status(b: BuildingInstance): BuildingStatus {
    let hit = this.statuses.get(b)
    if (hit) return hit
    const run = this.run
    const mods = this.mods
    const used = this.storageUsed
    if (this.statuses.size === 0) {
      withRunCache(run, () => {
        for (const each of Object.values(run.buildings)) {
          this.statuses.set(each, buildingStatus(run, each, mods, used))
        }
      })
      hit = this.statuses.get(b)
      if (hit) return hit
    }
    hit = withRunCache(run, () => buildingStatus(run, b, mods, used))
    this.statuses.set(b, hit)
    return hit
  }
}

/**
 * The shared derivations for `run` at store `version`. The same object comes
 * back for the same run and version, so every consumer of one sim step shares
 * one computation.
 */
export function frameDerived(run: RunState, version: number): FrameDerived {
  if (current && current.run === run && current.version === version) return current
  // A new version at the same sim time is a command (a placement, a hire...):
  // the Storm forecast should not wait for the clock.
  if (current && current.run === run && run.clock === lastClock) storm = null
  lastClock = run.clock
  current = new Derived(run, version)
  return current
}

/** The shared per-step derivations, on the HUD clock; null without a run. */
export function useFrameDerived(): FrameDerived | null {
  useGameStore((s) => s.hudVersion)
  const run = useGameStore((s) => s.run)
  return run ? frameDerived(run, useGameStore.getState().version) : null
}

/** The shared derivations for the current run and version, outside React. */
export function currentFrameDerived(): FrameDerived | null {
  const { run, version } = useGameStore.getState()
  return run ? frameDerived(run, version) : null
}
