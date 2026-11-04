import { useEffect, useRef, useState } from 'react'
import { BUILDINGS } from '../game/content/buildings'
import { canPlaceBuilding, footprintOf } from '../game/engine/actions'
import { DEPOSIT_INFO } from '../game/engine/mapgen'
import { describePlacement } from '../game/engine/placement'
import { warmthSources } from '../game/engine/queries'
import { displayName, workerSlotsOf } from '../game/engine/upgrades'
import { useGameStore, useRun } from '../game/store'
import type { GladeKind } from '../game/types'
import {
  DEPOSIT_TINT,
  GLADE_KIND_STYLE,
  MAP_KEYS,
  STATUS_BADGE,
  buildingStatusKind,
  gladeAccessText,
  gladeFill,
  gladeKindLabel,
  gladeLook,
  gladePlateInfo,
  isColdHousing,
  isUnlitWarmthSource,
  tierMark,
  upgradeFraction,
  useCameraFocus,
  useMapKey,
  useMapOverlays,
  useWarmthRingVisible,
  type GladeAccess,
  type StatusContext,
} from './mapShared'
import { panDirectionOf } from './usePanKeys'

/** Pixels per world unit inside the SVG coordinate system. */
const S = 30
const PAD = 2 * S
const MIN_SCALE = 0.45
const MAX_SCALE = 2.4

/**
 * 2D fallback renderer: the same continuous world as the 3D view, drawn as
 * SVG polygons and circles. Used where WebGL is missing and in tests.
 */
export function MapView2D() {
  const run = useRun()
  const buildMode = useGameStore((s) => s.buildMode)
  const showWarmth = useWarmthRingVisible()
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
  /** Build-mode ghost under the mouse: world position, screen anchor, verdict. */
  const [ghost, setGhost] = useState<{
    pos: { x: number; y: number }
    screen: { x: number; y: number }
    ok: boolean
    hint: string | null
  } | null>(null)

  useEffect(() => {
    if (!buildMode) setGhost(null)
  }, [buildMode])

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
   * world slides left. H jumps back home to the hearth; R toggles warmth.
   */
  useMapKey(MAP_KEYS.home, () => setView({ x: 0, y: 0, scale: 1 }))
  useMapKey(MAP_KEYS.warmth, () => useMapOverlays.getState().toggleWarmth())
  useEffect(() => {
    const STEP = 46
    const onKey = (e: KeyboardEvent) => {
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
  useCameraFocus((p) => setView((v) => ({ ...v, x: -p.x * S * v.scale, y: -p.y * S * v.scale })))

  const onPointerDown = (e: React.PointerEvent) => {
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current.size === 1) {
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 }
    }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    // Mouse hover aims the build ghost; touch keeps tap-to-place.
    if (buildMode && run && e.pointerType !== 'touch' && !drag.current) {
      const pos = toWorld(e)
      const wrap = svgRef.current?.parentElement?.getBoundingClientRect()
      if (pos && wrap) {
        const reason = canPlaceBuilding(run, buildMode, pos)
        const parts = describePlacement(run, buildMode, pos).parts
        setGhost({
          pos,
          screen: { x: e.clientX - wrap.left, y: e.clientY - wrap.top },
          ok: reason === null,
          hint: reason ?? (parts.length > 0 ? parts.join(' · ') : null),
        })
      }
    }
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
  const statusContext: StatusContext = {}
  const sources = warmthSources(run)
  const buildDef = buildMode ? BUILDINGS[buildMode] : undefined

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
        onPointerLeave={() => setGhost(null)}
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
              const look = gladeLook(glade)
              const points = glade.polygon.map((p) => `${p.x * S},${p.y * S}`).join(' ')
              return (
                <polygon
                  key={glade.id}
                  points={points}
                  className={`glade-poly is-${look} ${selectedGlade === glade.id ? 'is-selected' : ''}`}
                  fill={gladeFill(glade, '2d')}
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

            {/* Kind borders on fogged glades: solid, dashed or dotted. */}
            {glades.map((glade) =>
              gladeLook(glade) === 'fogged' ? (
                <GladeEdge2D
                  key={`edge-${glade.id}`}
                  id={glade.id}
                  points={glade.polygon.map((p) => `${p.x * S},${p.y * S}`).join(' ')}
                  kind={glade.kind}
                  access={gladePlateInfo(run, glade).access}
                />
              ) : null,
            )}

            {/* Every fire's reach: toggled on (R / 🔥), placing housing or a
                brazier, or inspecting a fire or a home. */}
            {showWarmth &&
              warmthSources(run).map((w) => (
                <circle
                  key={`warmth-${w.id}`}
                  cx={w.pos.x * S}
                  cy={w.pos.y * S}
                  r={w.radius * S}
                  className="warmth-ring"
                />
              ))}

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
                  <circle
                    cx={cx}
                    cy={cy}
                    r={d.radius * S}
                    className="deposit-disc"
                    style={{ stroke: DEPOSIT_TINT[d.kind], strokeOpacity: 0.7 }}
                  />
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
              const status = buildingStatusKind(run, b, statusContext)
              const badge = status === 'none' ? null : STATUS_BADGE[status]
              // A home beyond every fire in the Storm, or a brazier gone out.
              const cold = isColdHousing(run, b, sources) || isUnlitWarmthSource(b)
              const mark = tierMark(b)
              const upgrade = upgradeFraction(b)
              const slots = workerSlotsOf(b)
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
                  {cold && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r + 4}
                      fill="rgba(95, 143, 212, 0.18)"
                      stroke="#5f8fd4"
                      strokeWidth={1.5}
                      pointerEvents="none"
                    />
                  )}
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
                  {b.built && slots > 0 && (
                    <text className="hex-sub" x={cx} y={cy + r + 12}>
                      {b.workers.length}/{slots}
                    </text>
                  )}
                  {mark && (
                    <text
                      className="tier-mark"
                      x={cx + r * 0.85}
                      y={cy + r * 0.85 + 3}
                      aria-label={`${displayName(b)}, tier ${mark.length}`}
                    >
                      <title>{`${displayName(b)} — tier ${mark.length}`}</title>
                      {mark}
                    </text>
                  )}
                  {upgrade !== null && (
                    <g className="upgrade-bar-2d" pointerEvents="none">
                      <title>{`Upgrading — ${Math.floor(upgrade * 100)}%`}</title>
                      <rect x={cx - 16} y={cy - r - 8} width={32} height={4} rx={2} className="build-bar-bg" />
                      <rect
                        x={cx - 16}
                        y={cy - r - 8}
                        width={32 * upgrade}
                        height={4}
                        rx={2}
                        className="upgrade-bar"
                      />
                      <text className="hex-flag" x={cx - 22} y={cy - r - 4}>
                        ⬆
                      </text>
                    </g>
                  )}
                  {badge && (
                    <g className={`status-badge is-${status}`} pointerEvents="none">
                      <title>{badge.label}</title>
                      <circle
                        cx={cx + r * 0.8}
                        cy={cy - r * 0.8}
                        r={status === 'working' ? 3.5 : 7.5}
                        fill={badge.color}
                        stroke="rgba(9, 13, 16, 0.85)"
                        strokeWidth={1.5}
                      />
                      {status !== 'working' && (
                        <text className="hex-flag" x={cx + r * 0.8} y={cy - r * 0.8 + 3.5}>
                          {badge.icon}
                        </text>
                      )}
                    </g>
                  )}
                  {cold && (
                    <text className="hex-flag" x={cx - r * 0.8} y={cy - r * 0.8 + 3.5}>
                      ❄
                    </text>
                  )}
                </g>
              )
            })}

            {/* The build ghost: footprint, plus a camp's reach or a brazier's warmth. */}
            {buildDef && ghost && (
              <g className="ghost-2d" pointerEvents="none">
                {buildDef.gatherRadius && (
                  <circle
                    cx={ghost.pos.x * S}
                    cy={ghost.pos.y * S}
                    r={buildDef.gatherRadius * S}
                    fill="none"
                    stroke="#9fc9a3"
                    strokeOpacity={0.5}
                    strokeDasharray="4 4"
                  />
                )}
                {buildDef.warmth && (
                  <circle
                    cx={ghost.pos.x * S}
                    cy={ghost.pos.y * S}
                    r={buildDef.warmth.radius * S}
                    className="warmth-ring"
                  />
                )}
                <circle
                  cx={ghost.pos.x * S}
                  cy={ghost.pos.y * S}
                  r={footprintOf(buildDef.id) * S}
                  fill={ghost.ok ? 'rgba(111, 191, 114, 0.45)' : 'rgba(192, 80, 80, 0.45)'}
                  stroke={ghost.ok ? '#6fbf72' : '#c05050'}
                />
              </g>
            )}

            {/* Labels over undiscovered-but-known glades. */}
            {glades.map((glade) => {
              if (!glade.discovered || glade.cleared) return null
              const info = gladePlateInfo(run, glade)
              const { reachable, pct } = info
              const kindStyle = GLADE_KIND_STYLE[glade.kind]
              const cx = glade.center.x * S
              const cy = glade.center.y * S
              return (
                <g
                  key={glade.id}
                  className={`glade-label is-${glade.kind} is-${info.access} ${reachable ? '' : 'is-locked'}`}
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
                  <rect
                    x={-52}
                    y={-26}
                    width={104}
                    height={60}
                    rx={8}
                    className="glade-plate"
                    style={reachable ? { stroke: kindStyle.edge, strokeOpacity: 0.85 } : undefined}
                  />
                  <text y={-8} className="glade-kind" style={reachable ? { fill: kindStyle.edge } : undefined}>
                    {gladeKindLabel(glade.kind)}
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
                  <text y={28} className="glade-crew" style={reachable ? undefined : { fill: '#6d7a7a' }}>
                    {gladeAccessText(info)}
                  </text>
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
        <WarmthToggle />
      </div>

      {buildMode && ghost?.hint && (
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
      )}

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
      🔥
    </button>
  )
}

/**
 * A fogged glade's border, drawn inside its own polygon (the stroke is
 * clipped to the cell) so neighbouring borders never overlap. Pattern and
 * colour carry the kind; brightness carries reachability.
 */
function GladeEdge2D({
  id,
  points,
  kind,
  access,
}: {
  id: string
  points: string
  kind: GladeKind
  access: GladeAccess
}) {
  const style = GLADE_KIND_STYLE[kind]
  const clipId = `glade-clip-${id}`
  return (
    <g pointerEvents="none" className={`glade-edge is-${kind} is-${access}`}>
      <clipPath id={clipId}>
        <polygon points={points} />
      </clipPath>
      <polygon
        points={points}
        clipPath={`url(#${clipId})`}
        fill="none"
        stroke={style.edge}
        strokeWidth={access === 'locked' ? 4 : 7}
        strokeOpacity={access === 'locked' ? 0.35 : 0.9}
        strokeDasharray={style.dash ? style.dash.map((d) => d * S).join(' ') : undefined}
        style={
          access === 'clearing'
            ? { animation: 'warmth-breathe 1.2s ease-in-out infinite' }
            : undefined
        }
      />
    </g>
  )
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
