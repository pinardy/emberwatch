import { createContext, useContext } from 'react'
import { create } from 'zustand'
import { BUILDINGS } from '../game/content/buildings'
import { footprintOf } from '../game/engine/actions'
import { benefitsFromRoad, roadLinkOf, type RoadPreview } from '../game/engine/roads'
import { displayName, workerSlotsOf } from '../game/engine/upgrades'
import type { RunState, Vec2 } from '../game/types'
import { buildingViews } from './map3d/layerKeys'
import { districtOf, useHudValue, type District, type MapBuildingStatus } from './mapShared'

/**
 * State and subscriptions behind the 2D map's layers.
 *
 * The run is one mutable object and the store bumps `version` on every sim
 * step. The 2D map never subscribes to that: every layer subscribes to a key
 * of exactly what it draws (the same keys the 3D scene uses, see
 * `map3d/layerKeys.ts`) and re-renders only when that key changes. Pan, zoom
 * and the build ghost live outside React state altogether.
 */

/** Pixels per world unit inside the SVG coordinate system. */
export const S = 30

// ---------------------------------------------------------------------------
// Pointer plumbing shared with the layers
// ---------------------------------------------------------------------------

export interface MapInteraction {
  /**
   * True when this click ends a pan-drag and must be ignored. Reading it
   * clears the flag, exactly like the old inline checks did.
   */
  consumeSuppressedClick: () => boolean
  /** A pointer event's position in world units, or null (jsdom). */
  toWorld: (e: { clientX: number; clientY: number }) => Vec2 | null
}

export const MapInteractionContext = createContext<MapInteraction>({
  consumeSuppressedClick: () => false,
  toWorld: () => null,
})

export function useMapInteraction(): MapInteraction {
  return useContext(MapInteractionContext)
}

// ---------------------------------------------------------------------------
// Camera: pan/zoom outside React
// ---------------------------------------------------------------------------

export interface MapView {
  x: number
  y: number
  scale: number
}

/**
 * The 2D camera. Written straight to the transform group's attribute by the
 * map; the villager canvas listens so it can redraw in step. No React state:
 * a pan-drag costs one attribute write per pointer move, not a map render.
 */
export interface ViewBus {
  get: () => MapView
  subscribe: (listener: () => void) => () => void
}

export const ViewBusContext = createContext<ViewBus>({
  get: () => ({ x: 0, y: 0, scale: 1 }),
  subscribe: () => () => undefined,
})

// ---------------------------------------------------------------------------
// The build ghost (its own tiny store, so hovering never renders the map)
// ---------------------------------------------------------------------------

export interface Ghost {
  pos: Vec2
  /** Screen anchor inside the map wrap, for the hint bubble. */
  screen: Vec2
  ok: boolean
  hint: string | null
  /** Road tool: the stretch it would lay or lift. */
  road?: RoadPreview
}

export const useGhost = create<{ ghost: Ghost | null }>(() => ({ ghost: null }))

export function setGhost(ghost: Ghost | null): void {
  if (useGhost.getState().ghost === ghost) return
  useGhost.setState({ ghost })
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/** Everything one building's 2D node draws, as primitives (memo-friendly). */
export interface BuildingView2D {
  id: string
  defId: string
  district: District
  x: number
  y: number
  /** Footprint radius in SVG units. */
  r: number
  name: string
  built: boolean
  /** Construction progress in 2% steps (1 once built). */
  progress: number
  workers: number
  slots: number
  status: MapBuildingStatus
  cold: boolean
  tier: number
  /** Upgrade progress in 2% steps; -1 when none is under way. */
  upgrade: number
  /** Road work bonus percent when linked to a hub; -1 when roads do not apply. */
  road: number
}

export function buildingViews2D(run: RunState, version: number): { key: string; value: BuildingView2D[] } {
  let key = ''
  const value: BuildingView2D[] = []
  const hasRoads = (run.roads?.length ?? 0) > 0
  for (const v of buildingViews(run, version)) {
    const b = v.building
    const def = BUILDINGS[b.defId]
    if (!def) continue
    const link = hasRoads && b.built && benefitsFromRoad(def) ? roadLinkOf(run, b) : null
    const road = link?.connected ? link.percent : -1
    const view: BuildingView2D = {
      id: b.id,
      defId: b.defId,
      district: districtOf(def),
      x: b.pos.x * S,
      y: b.pos.y * S,
      r: footprintOf(b.defId) * S,
      name: displayName(b),
      built: b.built,
      progress: v.progress,
      workers: v.workers,
      slots: workerSlotsOf(b),
      status: v.status,
      cold: v.cold,
      tier: v.tier,
      upgrade: v.upgrade,
      road,
    }
    value.push(view)
    key += `${b.id}:${v.progress}:${v.workers}/${view.slots}:${v.status}:${v.cold ? 1 : 0}:${v.tier}:${v.upgrade}:${road},`
  }
  return { key, value }
}

/** The building layer's views, on the HUD clock (see `useHudValue`). */
export function useBuildingViews2D(): BuildingView2D[] {
  return useHudValue(buildingViews2D) ?? EMPTY
}

const EMPTY: BuildingView2D[] = []
