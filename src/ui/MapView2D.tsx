import { useEffect, useRef, useState } from 'react'
import { BUILDINGS } from '../game/content/buildings'
import { footprintOf, isReachable } from '../game/engine/actions'
import { HEARTH_WARMTH_RADIUS } from '../game/engine/balance'
import { DEPOSIT_INFO, TERRAIN_COLORS } from '../game/engine/mapgen'
import { useGameStore, useRun } from '../game/store'
import type { Glade } from '../game/types'
import { panDirectionOf } from './usePanKeys'

/** Pixels per world unit inside the SVG coordinate system. */
const S = 30
const PAD = 2 * S
const MIN_SCALE = 0.45
const MAX_SCALE = 2.4

type GladeLook = 'hidden' | 'fogged' | 'visible'

function lookOf(glade: Glade): GladeLook {
  if (glade.cleared) return 'visible'
  if (glade.discovered) return 'fogged'
  return 'hidden'
}

/**
 * 2D fallback renderer: the same continuous world as the 3D view, drawn as
 * SVG polygons and circles. Used where WebGL is missing and in tests.
 */
export function MapView2D() {
  const run = useRun()
  const buildMode = useGameStore((s) => s.buildMode)
  const selectedBuilding = useGameStore((s) => s.selectedBuilding)
  const selectedDeposit = useGameStore((s) => s.selectedDeposit)
  const selectedGlade = useGameStore((s) => s.selectedGlade)

  const svgRef = useRef<SVGSVGElement>(null)
  const worldRef = useRef<SVGGElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const drag = useRef<{ id: number; x: number; y: number; moved: number } | null>(null)
  const pinch = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchDistance = useRef(0)
  /** Set when a pointer-up ends a pan, so the trailing click is ignored. */
  const suppressClick = useRef(false)

  // Centre the camera whenever a new run is shown.
  useEffect(() => {
    setView({ x: 0, y: 0, scale: 1 })
  }, [run?.seed])

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
      setView((v) => ({
        ...v,
        scale: clamp(v.scale * (e.deltaY < 0 ? 1.12 : 0.89), MIN_SCALE, MAX_SCALE),
      }))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [run?.seed])

  /*
   * WASD / arrow panning. Each keydown nudges the view; holding the key pans
   * via the OS key-repeat. Pressing "right" moves the camera right, so the
   * world slides left. H jumps back home to the hearth.
   */
  useEffect(() => {
    const STEP = 46
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag && ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.code === 'KeyH') {
        setView({ x: 0, y: 0, scale: 1 })
        return
      }
      const direction = panDirectionOf(e)
      if (!direction || direction === 'rotateLeft' || direction === 'rotateRight') return
      if (e.code.startsWith('Arrow')) e.preventDefault()
      setView((v) => ({
        ...v,
        x: v.x + (direction === 'left' ? STEP : direction === 'right' ? -STEP : 0),
        y: v.y + (direction === 'up' ? STEP : direction === 'down' ? -STEP : 0),
      }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Fly-to requests from elsewhere in the UI (threat cards, the minimap).
  const cameraFocus = useGameStore((s) => s.cameraFocus)
  useEffect(() => {
    if (!cameraFocus) return
    setView((v) => ({ ...v, x: -cameraFocus.x * S * v.scale, y: -cameraFocus.y * S * v.scale }))
    useGameStore.setState({ cameraFocus: null })
  }, [cameraFocus])

  const onPointerDown = (e: React.PointerEvent) => {
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current.size === 1) {
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 }
    }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pinch.current.has(e.pointerId)) return
    const prev = pinch.current.get(e.pointerId)!
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // Two fingers down: treat the change in finger distance as a zoom.
    if (pinch.current.size >= 2) {
      const [a, b] = [...pinch.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const last = pinchDistance.current
      pinchDistance.current = distance
      if (last > 0) {
        setView((v) => ({ ...v, scale: clamp(v.scale * (distance / last), MIN_SCALE, MAX_SCALE) }))
      }
      return
    }

    if (drag.current?.id !== e.pointerId) return
    const dx = e.clientX - prev.x
    const dy = e.clientY - prev.y
    drag.current.moved += Math.abs(dx) + Math.abs(dy)
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pinch.current.delete(e.pointerId)
    if (pinch.current.size < 2) pinchDistance.current = 0
    if (drag.current?.id === e.pointerId) {
      suppressClick.current = drag.current.moved > 8
      drag.current = null
    }
  }

  /** Converts a mouse event to world coordinates via the transform group. */
  const toWorld = (e: React.MouseEvent): { x: number; y: number } | null => {
    const world = worldRef.current
    const svg = svgRef.current
    if (!world || !svg) return null
    const ctm = world.getScreenCTM?.()
    if (!ctm) return null // jsdom — tests drive placement through the store
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    return { x: point.x / S, y: point.y / S }
  }

  /** Clicks on open ground: place in build mode, deselect otherwise. */
  const onMapClick = (e: React.MouseEvent) => {
    if (!run) return
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    const state = useGameStore.getState()
    const pos = toWorld(e)
    if (!pos) return
    if (state.buildMode) {
      state.place(pos)
      return
    }
    state.clearSelection()
  }

  if (!run) return null

  const w = run.world.width * S
  const h = run.world.height * S
  const viewBox = `${-w / 2 - PAD} ${-h / 2 - PAD} ${w + PAD * 2} ${h + PAD * 2}`
  const glades = Object.values(run.glades)

  return (
    <div className="map-wrap">
      <svg
        ref={svgRef}
        className="map"
        viewBox={viewBox}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onMapClick}
        role="application"
        aria-label="Settlement map"
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          <g ref={worldRef}>
            {/* The forest beyond the world's edge. */}
            <rect
              x={-w / 2 - PAD}
              y={-h / 2 - PAD}
              width={w + PAD * 2}
              height={h + PAD * 2}
              fill="#0a0e11"
            />

            {glades.map((glade) => {
              const look = lookOf(glade)
              const points = glade.polygon.map((p) => `${p.x * S},${p.y * S}`).join(' ')
              return (
                <polygon
                  key={glade.id}
                  points={points}
                  className={`glade-poly is-${look} ${selectedGlade === glade.id ? 'is-selected' : ''}`}
                  fill={look === 'visible' ? TERRAIN_COLORS[glade.terrain] : look === 'fogged' ? '#131a1a' : '#0c1013'}
                  onClick={(e) => {
                    if (look === 'fogged') {
                      e.stopPropagation()
                      if (!suppressClick.current) {
                        useGameStore.getState().selectGlade(glade.id)
                      } else {
                        suppressClick.current = false
                      }
                    }
                    // Cleared/hidden ground falls through to the map handler.
                  }}
                />
              )
            })}

            {/* Warmth radius while placing housing. */}
            {buildMode && (BUILDINGS[buildMode]?.housing ?? 0) > 0 && (
              <circle cx={0} cy={0} r={HEARTH_WARMTH_RADIUS * S} className="warmth-ring" />
            )}

            {/* Obstacles on cleared ground. */}
            {run.obstacles.map((o) =>
              run.glades[o.gladeId]?.cleared ? (
                <circle
                  key={o.id}
                  cx={o.pos.x * S}
                  cy={o.pos.y * S}
                  r={o.radius * S}
                  className={`obstacle is-${o.kind}`}
                />
              ) : null,
            )}

            {/* Deposits on cleared ground. */}
            {Object.values(run.deposits).map((d) => {
              if (!run.glades[d.gladeId]?.cleared) return null
              const cx = d.pos.x * S
              const cy = d.pos.y * S
              return (
                <g
                  key={d.id}
                  className={`deposit ${selectedDeposit === d.id ? 'is-selected' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (suppressClick.current) {
                      suppressClick.current = false
                      return
                    }
                    useGameStore.getState().selectDeposit(d.id)
                  }}
                >
                  <circle cx={cx} cy={cy} r={d.radius * S} className="deposit-disc" />
                  <text className="hex-icon" x={cx} y={cy + 6}>
                    {DEPOSIT_INFO[d.kind].icon}
                  </text>
                  {d.amount !== null && (
                    <text className="hex-sub" x={cx} y={cy + d.radius * S + 10}>
                      {d.amount}
                    </text>
                  )}
                </g>
              )
            })}

            {/* Buildings. */}
            {Object.values(run.buildings).map((b) => {
              const def = BUILDINGS[b.defId]
              if (!def) return null
              const cx = b.pos.x * S
              const cy = b.pos.y * S
              const r = footprintOf(b.defId) * S
              const progress = b.built
                ? 1
                : b.buildProgress / Math.max(1, def.buildSeconds)
              return (
                <g
                  key={b.id}
                  className={`building ${selectedBuilding === b.id ? 'is-selected' : ''} ${b.built ? '' : 'is-site'}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (suppressClick.current) {
                      suppressClick.current = false
                      return
                    }
                    useGameStore.getState().selectBuilding(b.id)
                  }}
                >
                  <circle cx={cx} cy={cy} r={r} className="building-disc" />
                  <text className="hex-icon" x={cx} y={cy + 6}>
                    {def.icon}
                  </text>
                  {!b.built && (
                    <>
                      <rect x={cx - 16} y={cy + r + 3} width={32} height={4} rx={2} className="build-bar-bg" />
                      <rect
                        x={cx - 16}
                        y={cy + r + 3}
                        width={32 * Math.min(1, progress)}
                        height={4}
                        rx={2}
                        className="build-bar"
                      />
                    </>
                  )}
                  {b.built && def.workerSlots > 0 && (
                    <text className="hex-sub" x={cx} y={cy + r + 12}>
                      {b.workers.length}/{def.workerSlots}
                    </text>
                  )}
                  {b.paused && (
                    <text className="hex-flag" x={cx + r} y={cy - r}>
                      ⏸
                    </text>
                  )}
                </g>
              )
            })}

            {/* Labels over undiscovered-but-known glades. */}
            {glades.map((glade) => {
              if (!glade.discovered || glade.cleared) return null
              const reachable = isReachable(run, glade.id)
              const pct = glade.clearWork > 0 ? glade.clearProgress / glade.clearWork : 0
              const cx = glade.center.x * S
              const cy = glade.center.y * S
              return (
                <g
                  key={glade.id}
                  className={`glade-label ${reachable ? '' : 'is-locked'}`}
                  transform={`translate(${cx} ${cy})`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (suppressClick.current) {
                      suppressClick.current = false
                      return
                    }
                    useGameStore.getState().selectGlade(glade.id)
                  }}
                >
                  <rect x={-52} y={-26} width={104} height={52} rx={8} className="glade-plate" />
                  <text y={-8} className="glade-kind">
                    {glade.kind === 'small' ? '🌿 Small' : glade.kind === 'dangerous' ? '⚠ Dangerous' : '☠ Forbidden'}
                  </text>
                  <text y={7} className="glade-name">
                    {glade.name}
                  </text>
                  {pct > 0 && (
                    <>
                      <rect x={-40} y={13} width={80} height={5} rx={2.5} className="glade-bar-bg" />
                      <rect
                        x={-40}
                        y={13}
                        width={80 * Math.min(1, pct)}
                        height={5}
                        rx={2.5}
                        className="glade-bar"
                      />
                    </>
                  )}
                  {glade.clearers > 0 && (
                    <text y={24} className="glade-crew">
                      ⛏ {glade.clearers}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </g>
      </svg>

      <div className="map-controls">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setView((v) => ({ ...v, scale: clamp(v.scale * 1.2, MIN_SCALE, MAX_SCALE) }))}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setView((v) => ({ ...v, scale: clamp(v.scale / 1.2, MIN_SCALE, MAX_SCALE) }))}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Recentre"
          onClick={() => setView({ x: 0, y: 0, scale: 1 })}
        >
          ⌖
        </button>
      </div>

      {buildMode && <BuildBanner buildMode={buildMode} />}
    </div>
  )
}

/** Shared banner for both renderers while a blueprint is in hand. */
export function BuildBanner({ buildMode }: { buildMode: string }) {
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

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
