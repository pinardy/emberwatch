import { BUILDINGS } from '../../game/content/buildings'
import { warmthSources } from '../../game/engine/queries'
import { useGameStore } from '../../game/store'
import type { BuildingInstance, RunState } from '../../game/types'
import {
  buildingStatusKind,
  gladeLook,
  gladePlateInfo,
  isColdHousing,
  isUnlitWarmthSource,
  upgradeFraction,
  type MapBuildingStatus,
  type StatusContext,
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
    if (look === 'fogged') key += `:${gladePlateInfo(run, glade).access}`
    key += ','
  }
  return key
}

/** Name plates: everything on a fogged glade's plate, progress to the percent. */
export function gladePlateKey(run: RunState): string {
  let key = ''
  for (const glade of Object.values(run.glades)) {
    if (gladeLook(glade) !== 'fogged') continue
    const info = gladePlateInfo(run, glade)
    key += `${glade.id}:${info.access}:${Math.floor(info.pct * 100)}:${info.clearers},`
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
  /** Warmth sources: whether the fire is burning (drives the brazier model). */
  lit: boolean
  /** Upgrade tier reached (drives the tier mark and the model's trim). */
  tier: number
  /** Upgrade under way: progress in 2% steps; -1 when none is. */
  upgrade: number
}

export function buildingViews(run: RunState): BuildingView[] {
  const ctx: StatusContext = {}
  const sources = warmthSources(run)
  return Object.values(run.buildings).map((building) => {
    const def = BUILDINGS[building.defId]
    const raw = building.built ? 1 : building.buildProgress / Math.max(1, def?.buildSeconds ?? 1)
    return {
      building,
      progress: Math.min(1, Math.floor(raw * 50) / 50),
      workers: building.workers.length,
      status: buildingStatusKind(run, building, ctx),
      cold: isColdHousing(run, building, sources) || isUnlitWarmthSource(building),
      lit: !building.unlit,
      tier: building.tier ?? 0,
      upgrade: quantise(upgradeFraction(building)),
    }
  })
}

/** 2% steps, like construction progress; -1 for "no upgrade under way". */
function quantise(fraction: number | null): number {
  return fraction === null ? -1 : Math.floor(fraction * 50) / 50
}

export function buildingKey(run: RunState): string {
  let key = ''
  for (const v of buildingViews(run)) {
    key += `${v.building.id}:${v.progress}:${v.workers}:${v.status}:${v.cold ? 1 : 0}${v.lit ? 1 : 0}:${v.tier}:${v.upgrade},`
  }
  return key
}

/** Worn paths run to every finished building. */
export function pathKey(run: RunState): string {
  let key = ''
  for (const b of Object.values(run.buildings)) if (b.built) key += `${b.id},`
  return key
}

/** Chimney smoke: the hearth while lit, and production that is really working. */
export function smokeKey(run: RunState): string {
  let key = run.coldHearth ? 'cold;' : 'lit;'
  const ctx: StatusContext = {}
  for (const b of Object.values(run.buildings)) {
    if (BUILDINGS[b.defId]?.category !== 'production') continue
    if (buildingStatusKind(run, b, ctx) === 'working') key += `${b.id},`
  }
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

export function seasonKey(run: RunState): string {
  return run.season.season
}
