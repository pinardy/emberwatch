import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { IconId } from '../art/icons'
import { BUILDING_ART, DEPOSIT_ART, GLADE_ART } from '../game/content/art'
import { STATUS_BADGE_ART } from '../game/content/artFamilies'
import { BUILDINGS } from '../game/content/buildings'
import { canPlaceBuilding } from '../game/engine/actions'
import { describePlacement } from '../game/engine/placement'
import { ROAD_TOOL, describeRoadTool, type RoadPreview } from '../game/engine/roads'
import { useGameStore } from '../game/store'
import type { RunState, Vec2 } from '../game/types'
import { MAP_KEYS, useCameraFocus, useMapKey, useMapOverlays } from './mapShared'
import { panDirectionOf } from './usePanKeys'
import {
  BuildGhost2D,
  DepositLayer2D,
  GladeLayer2D,
  GladePlateLayer2D,
  ObstacleLayer2D,
  RoadGhost2D,
  RoadLayer2D,
  VillagerCanvas2D,
  WarmthLayer2D,
  WeatherGround2D,
  type ViewBoxRect,
} from './MapLayers2D'
import { BuildingLayer2D } from './MapBuildings2D'
import {
  MapInteractionContext,
  S,
  ViewBusContext,
  setGhost,
  useGhost,
  type MapInteraction,
  type MapView,
  type ViewBus,
} from './map2dState'
import { RoadBanner } from './RoadTool'
import { Icon, IconSymbols } from './Icon'
import './map2d.css'

/** Every icon the 2D map stamps, defined once as `<symbol>`s. */
const MAP_SYMBOLS: IconId[] = [
  ...new Set([
    ...Object.values(DEPOSIT_ART),
    ...Object.values(GLADE_ART),
    ...Object.values(BUILDING_ART).filter((id): id is IconId => id !== undefined),
    ...Object.values(STATUS_BADGE_ART),
    'snowflake',
    'upArrow',
    'crag',
    'marsh',
    'mono/road',
  ] satisfies IconId[]),
]

const PAD = 2 * S
const MIN_SCALE = 0.45
const MAX_SCALE = 2.4

/**
 * 2D fallback renderer: the same continuous world as the 3D view, drawn as
 * SVG polygons and plates, with the villagers on a canvas above. Used where
 * WebGL is missing and in tests.
 *
 * This component renders once per run. It never subscribes to the sim's
 * tick counter: each layer subscribes to exactly what it draws (see
 * `MapLayers2D`), the camera is written to the transform group directly, and
 * the build ghost lives in its own little store.
 */
export function MapView2D() {
  const run = useGameStore((s) => s.run)
  if (!run) return null
  return <MapScene2D run={run} />
}

const MapScene2D = memo(function MapScene2D({ run }: { run: RunState }) {
  const buildMode = useGameStore((s) => s.buildMode)
  const paused = useGameStore(isStill)
  const svgRef = useRef<SVGSVGElement>(null)
  const viewRef = useRef<SVGGElement>(null)
  const worldRef = useRef<SVGGElement>(null)
  const view = useRef<MapView>({ x: 0, y: 0, scale: 1 })
  const drag = useRef<{ id: number; x: number; y: number; moved: number } | null>(null)
  const pinch = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchDistance = useRef(0)
  /** Set when a pointer-up ends a pan, so the trailing click is ignored. */
  const suppressClick = useRef(false)

  // ---- camera -------------------------------------------------------------
  const listeners = useRef(new Set<() => void>())
  const bus = useMemo<ViewBus>(
    () => ({
      get: () => view.current,
      subscribe: (listener) => {
        listeners.current.add(listener)
        return () => listeners.current.delete(listener)
      },
    }),
    [],
  )
  /** Writes the camera to the transform group: no React render involved. */
  const applyView = (next: MapView) => {
    view.current = next
    viewRef.current?.setAttribute('transform', `translate(${next.x} ${next.y}) scale(${next.scale})`)
    for (const listener of listeners.current) listener()
  }
  const zoomBy = (factor: number) =>
    applyView({ ...view.current, scale: clamp(view.current.scale * factor, MIN_SCALE, MAX_SCALE) })
  const panBy = (dx: number, dy: number) =>
    applyView({ ...view.current, x: view.current.x + dx, y: view.current.y + dy })

  // A new run starts centred, with no ghost in hand.
  useLayoutEffect(() => {
    applyView({ x: 0, y: 0, scale: 1 })
    setGhost(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])

  useEffect(() => {
    if (!buildMode) setGhost(null)
  }, [buildMode])

  /*
   * Wheel zoom has to be a native listener registered with `{ passive: false }`.
   * React attaches its own `wheel` listener at the root as passive, so calling
   * preventDefault from an `onWheel` prop is ignored and logs
   * "Unable to preventDefault inside passive event listener invocation" —
   * leaving the page to scroll behind the map instead of zooming it.
   */
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 1.12 : 0.89)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /*
   * WASD / arrow panning. Each keydown nudges the view; holding the key pans
   * via the OS key-repeat. Pressing "right" moves the camera right, so the
   * world slides left. H jumps back home to the hearth; R toggles warmth.
   */
  useMapKey(MAP_KEYS.home, () => applyView({ x: 0, y: 0, scale: 1 }))
  useMapKey(MAP_KEYS.warmth, () => useMapOverlays.getState().toggleWarmth())
  useEffect(() => {
    const STEP = 46
    const onKey = (e: KeyboardEvent) => {
      const direction = panDirectionOf(e)
      if (!direction || direction === 'rotateLeft' || direction === 'rotateRight') return
      if (e.code.startsWith('Arrow')) e.preventDefault()
      panBy(
        direction === 'left' ? STEP : direction === 'right' ? -STEP : 0,
        direction === 'up' ? STEP : direction === 'down' ? -STEP : 0,
      )
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fly-to requests from elsewhere in the UI (threat cards, the minimap).
  useCameraFocus((p) => {
    const v = view.current
    applyView({ ...v, x: -p.x * S * v.scale, y: -p.y * S * v.scale })
  })

  // ---- pointer ------------------------------------------------------------

  /** Converts a pointer position to world coordinates via the transform group. */
  const toWorld = (e: { clientX: number; clientY: number }): Vec2 | null => {
    const world = worldRef.current
    if (!world) return null
    const ctm = world.getScreenCTM?.()
    if (!ctm) return null // jsdom — tests drive placement through the store
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    return { x: point.x / S, y: point.y / S }
  }

  const interaction = useMemo<MapInteraction>(
    () => ({
      consumeSuppressedClick: () => {
        if (!suppressClick.current) return false
        suppressClick.current = false
        return true
      },
      toWorld: (e) => toWorld(e),
    }),
    [],
  )

  /*
   * Build-mode hover is evaluated at most once per animation frame, from the
   * latest pointer position: placement checks and the road tool's network
   * preview never run more often than the screen can show them.
   */
  const hover = useRef<{ clientX: number; clientY: number } | null>(null)
  const hoverFrame = useRef(0)
  const evaluateHover = () => {
    hoverFrame.current = 0
    const at = hover.current
    const state = useGameStore.getState()
    const current = state.run
    if (!at || !state.buildMode || !current) return
    const pos = toWorld(at)
    const wrap = svgRef.current?.parentElement?.getBoundingClientRect()
    if (!pos || !wrap) return
    const screen = { x: at.clientX - wrap.left, y: at.clientY - wrap.top }
    if (state.buildMode === ROAD_TOOL) {
      const road = cachedRoadPreview(current, state.roadAnchor, pos, state.roadErase)
      setGhost({
        pos: road.to,
        screen,
        ok: road.ok,
        hint: road.reason ?? (road.parts.length > 0 ? road.parts.join(' · ') : null),
        road,
      })
      return
    }
    const reason = canPlaceBuilding(current, state.buildMode, pos)
    const parts = describePlacement(current, state.buildMode, pos).parts
    setGhost({ pos, screen, ok: reason === null, hint: reason ?? (parts.length > 0 ? parts.join(' · ') : null) })
  }
  const queueHover = (e: React.PointerEvent) => {
    hover.current = { clientX: e.clientX, clientY: e.clientY }
    if (hoverFrame.current) return
    if (typeof requestAnimationFrame === 'function') {
      hoverFrame.current = requestAnimationFrame(evaluateHover)
    } else evaluateHover()
  }
  useEffect(
    () => () => {
      if (hoverFrame.current) cancelAnimationFrame(hoverFrame.current)
    },
    [],
  )

  const onPointerDown = (e: React.PointerEvent) => {
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current.size === 1) {
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 }
    }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    // Mouse hover aims the build ghost; touch keeps tap-to-place.
    if (buildMode && e.pointerType !== 'touch' && !drag.current) queueHover(e)
    if (!pinch.current.has(e.pointerId)) return
    const prev = pinch.current.get(e.pointerId)!
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // Two fingers down: treat the change in finger distance as a zoom.
    if (pinch.current.size >= 2) {
      const [a, b] = [...pinch.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const last = pinchDistance.current
      pinchDistance.current = distance
      if (last > 0) zoomBy(distance / last)
      return
    }

    if (drag.current?.id !== e.pointerId) return
    const dx = e.clientX - prev.x
    const dy = e.clientY - prev.y
    drag.current.moved += Math.abs(dx) + Math.abs(dy)
    panBy(dx, dy)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pinch.current.delete(e.pointerId)
    if (pinch.current.size < 2) pinchDistance.current = 0
    if (drag.current?.id === e.pointerId) {
      suppressClick.current = drag.current.moved > 8
      drag.current = null
    }
  }

  /** Clicks on open ground: place in build mode, deselect otherwise. */
  const onMapClick = (e: React.MouseEvent) => {
    if (interaction.consumeSuppressedClick()) return
    const state = useGameStore.getState()
    const pos = toWorld(e)
    if (!pos) return
    if (state.buildMode) {
      state.place(pos)
      // After a road click the anchor moved: redraw the ghost from it.
      if (state.buildMode === ROAD_TOOL && useGhost.getState().ghost) {
        hover.current = { clientX: e.clientX, clientY: e.clientY }
        evaluateHover()
      }
      return
    }
    state.clearSelection()
  }

  // ---- scene --------------------------------------------------------------
  const w = run.world.width * S
  const h = run.world.height * S
  const box = useMemo<ViewBoxRect>(
    () => ({ x: -w / 2 - PAD, y: -h / 2 - PAD, w: w + PAD * 2, h: h + PAD * 2 }),
    [w, h],
  )

  return (
    <div className="map-wrap map-wrap-2d" data-paused={paused ? 'true' : 'false'}>
      <MapInteractionContext.Provider value={interaction}>
        <ViewBusContext.Provider value={bus}>
          <svg
            ref={svgRef}
            className="map map-2d"
            viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => {
              hover.current = null
              setGhost(null)
            }}
            onClick={onMapClick}
            onContextMenu={(e) => {
              // Right-click ends the road being laid, then puts the tool away.
              if (!useGameStore.getState().buildMode) return
              e.preventDefault()
              useGameStore.getState().cancelBuildStep()
              setGhost(null)
            }}
            role="application"
            aria-label="Settlement map"
          >
            <IconSymbols ids={MAP_SYMBOLS} />
            <g ref={viewRef} transform="translate(0 0) scale(1)">
              <g ref={worldRef}>
                {/* The forest beyond the world's edge. */}
                <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="#0a0e11" />
                <GladeLayer2D run={run} />
                {/* The season's wash darkens the ground only: roads, features
                    and buildings stay crisp above it. */}
                <WeatherGround2D x={box.x} y={box.y} width={box.w} height={box.h} />
                <RoadLayer2D run={run} />
                <ObstacleLayer2D run={run} />
                <DepositLayer2D run={run} />
                {/* Every fire's reach: toggled on (R / 🔥), placing housing or
                    a brazier, or inspecting a fire or a home. */}
                <WarmthLayer2D run={run} />
                <BuildingLayer2D />
                <BuildGhost2D />
                <RoadGhost2D run={run} />
                <GladePlateLayer2D run={run} />
              </g>
            </g>
          </svg>
          <VillagerCanvas2D run={run} viewBox={box} />
        </ViewBusContext.Provider>
      </MapInteractionContext.Provider>

      <div className="map-controls">
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
          −
        </button>
        <button type="button" aria-label="Recentre" onClick={() => applyView({ x: 0, y: 0, scale: 1 })}>
          ⌖
        </button>
        <WarmthToggle />
      </div>

      <GhostHint />
      {buildMode && <BuildBanner buildMode={buildMode} />}
    </div>
  )
})

/** The verdict bubble that follows the build ghost. */
function GhostHint() {
  const buildMode = useGameStore((s) => s.buildMode)
  const ghost = useGhost((s) => s.ghost)
  if (!buildMode || !ghost?.hint) return null
  return (
    <div
      className={`ghost-hint ${ghost.ok ? 'is-ok' : 'is-bad'}`}
      style={{
        position: 'absolute',
        left: ghost.screen.x,
        top: ghost.screen.y - 44,
        transform: 'translateX(-50%)',
      }}
    >
      {ghost.hint}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Road tool preview cache
// ---------------------------------------------------------------------------

/**
 * `describeRoadTool` builds a whole road network to say what a stretch would
 * join, which is too much to redo on every mouse move. Previews are cached
 * for the current anchor and road/building state, by the endpoint rounded to
 * a twentieth of a pace (about a pixel and a half at default zoom); anything
 * that could change the verdict — a new anchor, a road laid or lifted, a
 * building finished, the wood running short — starts a fresh cache.
 */
const ROAD_CELL = 0.05
let roadCacheState = ''
const roadCache = new Map<string, RoadPreview>()

function cachedRoadPreview(run: RunState, anchor: Vec2 | null, pos: Vec2, erase: boolean): RoadPreview {
  const state = [
    run.seed,
    run.roadCounter ?? 0,
    run.roads?.length ?? 0,
    run.stats.buildingsBuilt,
    Object.keys(run.buildings).length,
    Math.floor(run.stock.wood ?? 0),
    anchor ? `${anchor.x},${anchor.y}` : '-',
    erase ? 'erase' : 'lay',
  ].join('|')
  if (state !== roadCacheState) {
    roadCacheState = state
    roadCache.clear()
  }
  const cell = `${Math.round(pos.x / ROAD_CELL)},${Math.round(pos.y / ROAD_CELL)}`
  let hit = roadCache.get(cell)
  if (!hit) {
    if (roadCache.size > 400) roadCache.clear()
    hit = describeRoadTool(run, anchor, pos, erase)
    roadCache.set(cell, hit)
  }
  return hit
}

/** Shared banner for both renderers while a blueprint is in hand. */
export function BuildBanner({ buildMode }: { buildMode: string }) {
  if (buildMode === ROAD_TOOL) return <RoadBanner />
  // Touch screens have no Esc key and nothing to click with.
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return (
    <div className="build-banner">
      <span>
        Placing <strong>{BUILDINGS[buildMode]?.name}</strong> —{' '}
        {touch ? 'tap on cleared ground to place' : 'click on cleared ground · Esc cancels'}
      </span>
      <button type="button" onClick={() => useGameStore.getState().setBuildMode(null)}>
        Cancel
      </button>
    </div>
  )
}

/** Map-control button (and R hotkey) for the hearth warmth overlay. */
export function WarmthToggle() {
  const on = useMapOverlays((s) => s.showWarmth)
  return (
    <button
      type="button"
      aria-label="Show warmth radius"
      aria-pressed={on}
      title="Warmth radius (R)"
      className={on ? 'is-active' : ''}
      onClick={() => useMapOverlays.getState().toggleWarmth()}
    >
      <Icon id="settlement" emoji="🔥" />
    </button>
  )
}

/** The world is standing still: paused, over, or waiting on a choice. */
function isStill(s: { speed: number; run: RunState | null }): boolean {
  return s.speed === 0 || s.run?.phase !== 'playing' || (s.run?.pendingChoices.length ?? 0) > 0
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
