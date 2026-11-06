import { BUILDINGS } from '../../game/content/buildings'
import { warmthSources } from '../../game/engine/queries'
import { withRunCache } from '../../game/engine/runCache'
import { frameDerived } from '../../game/frameDerived'
import { useGameStore } from '../../game/store'
import type { BuildingInstance, RunState } from '../../game/types'
import {
  gladeAccess,
  gladeLook,
  gladeProgress,
  isColdHousing,
  isUnlitWarmthSource,
  upgradeFraction,
  type MapBuildingStatus,
} from '../mapShared'

/**
 * The run is one mutable object and the store bumps `version` on every sim
 * tick. Instead of re-rendering the whole scene per tick, each layer of the
 * 3D map subscribes to a *key*: a string of exactly the state it draws. A
 * layer re-renders only when its key changes — glades when one is cleared or
 * discovered, deposits when one is harvested, and so on.
 *
 * Keys are plain strings so the store's default `Object.is` comparison is all
 * the equality we need.
 */

/** Subscribes to `keyOf(run)`; returns it (mostly useful for tests and deps). */
export function useRunKey(keyOf: (run: RunState) => string): string {
  return useGameStore((s) => (s.run ? keyOf(s.run) : ''))
}

/** Glade surfaces: look (hidden/fogged/visible) and, when fogged, access. */
export function gladeSurfaceKey(run: RunState): string {
  let key = ''
  for (const glade of Object.values(run.glades)) {
    const look = gladeLook(glade)
    key += `${glade.id}:${look}`
    if (look === 'fogged') key += `:${gladeAccess(run, glade)}`
    key += ','
  }
  return key
}

/** Name plates: everything on a fogged glade's plate, progress to the percent. */
export function gladePlateKey(run: RunState): string {
  let key = ''
  for (const glade of Object.values(run.glades)) {
    if (gladeLook(glade) !== 'fogged') continue
    key += `${glade.id}:${gladeAccess(run, glade)}:${Math.floor(gladeProgress(glade) * 100)}:${glade.clearers},`
  }
  return key
}

/** Forest cover follows which glades are uncleared and which are discovered. */
export function forestKey(run: RunState): string {
  let key = ''
  for (const glade of Object.values(run.glades)) {
    if (!glade.cleared) key += `${glade.id}${glade.discovered ? 'd' : ''},`
  }
  return key
}

/** Cleared glades: obstacles only stand on cleared ground. */
export function clearedKey(run: RunState): string {
  let key = ''
  for (const glade of Object.values(run.glades)) if (glade.cleared) key += `${glade.id},`
  return key
}

/** Deposits on cleared ground and what is left in them. */
export function depositKey(run: RunState): string {
  let key = ''
  for (const d of Object.values(run.deposits)) {
    if (run.glades[d.gladeId]?.cleared) key += `${d.id}:${d.amount},`
  }
  return key
}

/** Everything a building's node draws, quantised so ticks rarely change it. */
export interface BuildingView {
  building: BuildingInstance
  /** Construction progress in 2% steps (1 once built). */
  progress: number
  workers: number
  status: MapBuildingStatus
  /** A home out in the Storm's cold, or a brazier that has gone out. */
  cold: boolean
  /** Upgrade tier reached (drives the tier mark and the model's trim). */
  tier: number
  /** Upgrade under way: progress in 2% steps; -1 when none is. */
  upgrade: number
}

/**
 * Every building's view. Statuses come from the shared per-step derivations
 * (`frameDerived`), so the maps and the HUD compute them once per version;
 * one run-cache scope around the batch spares each status its own cache check.
 */
export function buildingViews(run: RunState, version: number): BuildingView[] {
  return withRunCache(run, () => views(run, version))
}

function views(run: RunState, version: number): BuildingView[] {
  const derived = frameDerived(run, version)
  const sources = warmthSources(run)
  return Object.values(run.buildings).map((building) => {
    const def = BUILDINGS[building.defId]
    const raw = building.built ? 1 : building.buildProgress / Math.max(1, def?.buildSeconds ?? 1)
    return {
      building,
      progress: Math.min(1, Math.floor(raw * 50) / 50),
      workers: building.workers.length,
      status: derived.status(building).kind,
      cold: isColdHousing(run, building, sources) || isUnlitWarmthSource(building),
      tier: building.tier ?? 0,
      upgrade: quantise(upgradeFraction(building)),
    }
  })
}

/** 2% steps, like construction progress; -1 for "no upgrade under way". */
function quantise(fraction: number | null): number {
  return fraction === null ? -1 : Math.floor(fraction * 50) / 50
}

/** The 3D building layer's views (for `useHudValue`), keyed by everything a node draws. */
export function buildingLayer(run: RunState, version: number): { key: string; value: BuildingView[] } {
  const value = buildingViews(run, version)
  let key = ''
  for (const v of value) {
    key += `${v.building.id}:${v.progress}:${v.workers}:${v.status}:${v.cold ? 1 : 0}:${v.tier}:${v.upgrade},`
  }
  return { key, value }
}

/** Worn paths run to every finished building. */
export function pathKey(run: RunState): string {
  let key = ''
  for (const b of Object.values(run.buildings)) if (b.built) key += `${b.id},`
  return key
}

/** Who exists and where they are walking to. */
export function villagerKey(run: RunState): string {
  let key = ''
  for (const v of Object.values(run.villagers)) key += `${v.id}:${v.species}:${v.assignment},`
  return key
}

/** Laid roads. Roads never move, so their ids are all a layer needs. */
export function roadKey(run: RunState): string {
  let key = ''
  for (const r of run.roads ?? []) key += `${r.id},`
  return key
}

/**
 * Everything a walking villager's route is derived from: who exists and what
 * they do, which buildings stand (homes, workplaces) or are going up (sites
 * for idle builders), and the roads. Assignment and construction changes move
 * it; ordinary ticks do not.
 */
export function villagerRouteKey(run: RunState): string {
  let key = villagerKey(run) + '|'
  for (const b of Object.values(run.buildings)) {
    key += `${b.id}${b.built ? '' : '~'}${b.upgradeProgress !== undefined ? '^' : ''}:${b.tier ?? 0},`
  }
  return `${key}|${roadKey(run)}`
}

/** Live warmth sources: the hearth and every lit brazier, with their reach. */
export function warmthKey(run: RunState): string {
  return warmthSources(run)
    .map((w) => `${w.id}:${w.pos.x}:${w.pos.y}:${w.radius}`)
    .join(',')
}

export function threatKey(run: RunState): string {
  return run.threats.map((t) => `${t.id}:${t.gladeId}`).join(',')
}

/** The minimap draws glade looks, building dots and threat markers. */
export function miniMapKey(run: RunState): string {
  let key = ''
  for (const glade of Object.values(run.glades)) key += gladeLook(glade)[0]
  key += ';'
  for (const b of Object.values(run.buildings)) key += `${b.id},`
  return `${key};${threatKey(run)}`
}

/**
 * What the instanced building models show: which buildings stand where, built
 * or going up (in 10% steps), tier, upgrade scaffolding, lit fires, and — via
 * the villager count, since homes fill in build order — whose windows glow.
 * Storm chill follows from these plus the season. Ordinary ticks leave it be.
 */
export function buildingModelKey(run: RunState): string {
  let villagers = 0
  for (const id in run.villagers) if (id) villagers++
  let key = `${run.season.season === 'storm' ? 's' : ''}${villagers}|`
  for (const b of Object.values(run.buildings)) {
    key += b.id
    if (!b.built) {
      const def = BUILDINGS[b.defId]
      key += `~${Math.round((b.buildProgress / Math.max(1, def?.buildSeconds ?? 1)) * 10)}`
    }
    if (b.upgradeProgress !== undefined) key += '^'
    if (b.unlit) key += 'u'
    key += `${b.tier ?? 0},`
  }
  return key
}

/** Which deposits and obstacles stand on cleared ground (their props, not amounts). */
export function propKey(run: RunState): string {
  let key = ''
  for (const d of Object.values(run.deposits)) if (run.glades[d.gladeId]?.cleared) key += `${d.id},`
  return `${key}|${clearedKey(run)}`
}
