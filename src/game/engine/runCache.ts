import type { BuildingInstance, RunState, Villager } from '../types'

/**
 * Remembered derivations for the run being ticked (or rendered).
 *
 * Several settlement-wide numbers are read many times a tick by different
 * systems: every producer's and service's adjacency (each read walks every
 * building, which made the tick quadratic in buildings), the population, the
 * species counts, total housing, storage capacity, whether a Trading Post
 * stands. Inside `withRunCache` each is computed once and reused until what it
 * depends on changes; outside a scope the queries compute fresh, so they stay
 * plain functions of the state for tests and one-off callers.
 *
 * Derived, never serialised. Keyed by the run's `buildings` record (which the
 * season-shifted copies in the forecasts share), so a loaded save starts
 * empty. Every scope begins by comparing the buildings and villagers with a
 * snapshot of the last scope (same objects in the same order; for buildings
 * also def, place, `built` and tier), so anything that changed between ticks,
 * even a test editing a building by hand, drops what depended on it.
 *
 * Within a scope the engine reports its own changes: a finished building
 * moves `stats.buildingsBuilt` (checked on every read), a finished upgrade
 * calls `touchBuildings`, and adding or removing a villager calls
 * `touchVillagers`. New code that adds, removes, finishes, unfinishes or
 * re-tiers a building, or adds or removes a villager, in the middle of a tick
 * must call the matching `touch…`.
 */
/** What the cache saw of one building: the object, and the fields it reads. */
interface SeenBuilding {
  b: BuildingInstance
  defId: string
  x: number
  y: number
  built: boolean
  tier: number | undefined
}

interface RunMemo {
  buildings: RunState['buildings']
  /** The buildings the cache was filled against, in record order. */
  seen: SeenBuilding[]
  /** `stats.buildingsBuilt` at the last check; NaN forces a re-check. */
  built: number
  /** Derivations of the buildings alone, by name. */
  byBuildings: Map<string, unknown>
  /** Per-building derivations of the buildings alone, by name then building. */
  perBuilding: Map<string, Map<BuildingInstance, unknown>>

  villagers: RunState['villagers'] | null
  seenVillagers: Villager[]
  /** False forces a re-check of the villagers. */
  villagersChecked: boolean
  /** Derivations of the villagers alone, by name. */
  byVillagers: Map<string, unknown>
}

const memos = new WeakMap<RunState['buildings'], RunMemo>()
let scope: RunMemo | null = null

function checkBuildings(s: RunState, memo: RunMemo): void {
  memo.built = s.stats.buildingsBuilt
  const seen = memo.seen
  let i = 0
  let same = true
  for (const b of Object.values(s.buildings)) {
    const was = seen[i]
    if (
      was === undefined ||
      was.b !== b ||
      was.defId !== b.defId ||
      was.x !== b.pos.x ||
      was.y !== b.pos.y ||
      was.built !== b.built ||
      was.tier !== b.tier
    ) {
      same = false
      break
    }
    i++
  }
  if (same && i === seen.length) return
  memo.byBuildings.clear()
  memo.perBuilding.clear()
  memo.seen = Object.values(s.buildings).map((b) => ({
    b,
    defId: b.defId,
    x: b.pos.x,
    y: b.pos.y,
    built: b.built,
    tier: b.tier,
  }))
}

function checkVillagers(s: RunState, memo: RunMemo): void {
  memo.villagersChecked = true
  const seen = memo.seenVillagers
  if (memo.villagers === s.villagers) {
    let i = 0
    let same = true
    for (const v of Object.values(s.villagers)) {
      if (seen[i] !== v) {
        same = false
        break
      }
      i++
    }
    if (same && i === seen.length) return
  }
  memo.villagers = s.villagers
  memo.byVillagers.clear()
  seen.length = 0
  for (const v of Object.values(s.villagers)) seen.push(v)
}

/** The scope's memo for `s`, checked against the buildings; null outside one. */
function buildingsMemo(s: RunState): RunMemo | null {
  if (scope === null || scope.buildings !== s.buildings) return null
  if (scope.built !== s.stats.buildingsBuilt) checkBuildings(s, scope)
  return scope
}

/**
 * Runs `fn` with the run's derivations remembered (see above). A nested scope
 * for the same run shares the outer one.
 */
export function withRunCache<T>(s: RunState, fn: () => T): T {
  if (scope !== null && scope.buildings === s.buildings) return fn()
  let memo = memos.get(s.buildings)
  if (!memo) {
    memo = {
      buildings: s.buildings,
      seen: [],
      built: Number.NaN,
      byBuildings: new Map(),
      perBuilding: new Map(),
      villagers: null,
      seenVillagers: [],
      villagersChecked: false,
      byVillagers: new Map(),
    }
    memos.set(s.buildings, memo)
  }
  checkBuildings(s, memo)
  memo.villagersChecked = false
  const outer = scope
  scope = memo
  try {
    return fn()
  } finally {
    scope = outer
  }
}

/** True while a `withRunCache` scope for `s` is open. */
export function inRunCache(s: RunState): boolean {
  return scope !== null && scope.buildings === s.buildings
}

/** A building was finished, unfinished or re-tiered in the middle of a tick. */
export function touchBuildings(s: RunState): void {
  const memo = memos.get(s.buildings)
  if (memo) memo.built = Number.NaN
}

/** A villager arrived or left in the middle of a tick. */
export function touchVillagers(s: RunState): void {
  const memo = memos.get(s.buildings)
  if (memo) memo.villagersChecked = false
}

/** `compute()` once per state of the buildings while a scope is open. */
export function memoByBuildings<T>(s: RunState, key: string, compute: () => T): T {
  const memo = buildingsMemo(s)
  if (!memo) return compute()
  if (memo.byBuildings.has(key)) return memo.byBuildings.get(key) as T
  const value = compute()
  memo.byBuildings.set(key, value)
  return value
}

/** `compute()` once per building per state of the buildings, in a scope. */
export function memoPerBuilding<T>(
  s: RunState,
  key: string,
  b: BuildingInstance,
  compute: () => T,
): T {
  const memo = buildingsMemo(s)
  if (!memo) return compute()
  let slot = memo.perBuilding.get(key)
  if (!slot) {
    slot = new Map()
    memo.perBuilding.set(key, slot)
  }
  if (slot.has(b)) return slot.get(b) as T
  const value = compute()
  slot.set(b, value)
  return value
}

/** `compute()` once per state of the villagers while a scope is open. */
export function memoByVillagers<T>(s: RunState, key: string, compute: () => T): T {
  if (scope === null || scope.buildings !== s.buildings) return compute()
  const memo = scope
  if (!memo.villagersChecked || memo.villagers !== s.villagers) checkVillagers(s, memo)
  if (memo.byVillagers.has(key)) return memo.byVillagers.get(key) as T
  const value = compute()
  memo.byVillagers.set(key, value)
  return value
}
