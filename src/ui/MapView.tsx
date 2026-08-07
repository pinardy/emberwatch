import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { BUILDINGS } from '../game/content/buildings'
import { canPlaceBuilding, isReachable } from '../game/engine/actions'
import { HEARTH_WARMTH_RADIUS } from '../game/engine/balance'
import { hexCorners, hexToPixel } from '../game/engine/hex'
import { DEPOSIT_INFO, TERRAIN_COLORS } from '../game/engine/mapgen'
import { useGameStore, useRun } from '../game/store'
import type { RunState, Tile } from '../game/types'

const HEX_SIZE = 30
const MIN_SCALE = 0.45
const MAX_SCALE = 2.4

interface Layout {
  positions: Record<string, { x: number; y: number }>
  width: number
  height: number
  minX: number
  minY: number
}

function computeLayout(tiles: Record<string, Tile>): Layout {
  const positions: Record<string, { x: number; y: number }> = {}
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const tile of Object.values(tiles)) {
    const p = hexToPixel(tile, HEX_SIZE)
    positions[tile.key] = p
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const pad = HEX_SIZE * 1.4
  return {
    positions,
    minX: minX - pad,
    minY: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  }
}

type TileVisibility = 'hidden' | 'fogged' | 'visible'

function visibilityOf(run: RunState, tile: Tile): TileVisibility {
  const glade = run.glades[tile.gladeId]
  if (!glade) return 'hidden'
  if (glade.cleared) return 'visible'
  if (glade.discovered) return 'fogged'
  return 'hidden'
}

export function MapView() {
  const run = useRun()
  const buildMode = useGameStore((s) => s.buildMode)
  const selectedTile = useGameStore((s) => s.selectedTile)
  const selectedGlade = useGameStore((s) => s.selectedGlade)
  const showGrid = useGameStore((s) => s.settings.showTileGrid)
  const place = useGameStore((s) => s.place)
  const selectTile = useGameStore((s) => s.selectTile)
  const selectGlade = useGameStore((s) => s.selectGlade)

  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const drag = useRef<{ id: number; x: number; y: number; moved: number } | null>(null)
  const pinch = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchDistance = useRef(0)
  /** Set when a pointer-up ends a pan, so the trailing click is ignored. */
  const suppressClick = useRef(false)

  const layout = useMemo(
    () => (run ? computeLayout(run.tiles) : null),
    // Tile positions never change within a run.
    [run?.seed], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Centre the camera on the hearth the first time a run is shown.
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
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const last = pinchDistance.current
      pinchDistance.current = dist
      if (last > 0) {
        setView((v) => ({ ...v, scale: clamp(v.scale * (dist / last), MIN_SCALE, MAX_SCALE) }))
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

  const handleTileClick = (tile: Tile) => {
    if (!run) return
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    const glade = run.glades[tile.gladeId]
    if (!glade.cleared) {
      selectGlade(glade.discovered ? glade.id : null)
      return
    }
    if (buildMode) {
      place(tile.key)
      return
    }
    selectTile(tile.key)
  }

  if (!run || !layout) return null

  const viewBox = `${layout.minX} ${layout.minY} ${layout.width} ${layout.height}`

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
        role="application"
        aria-label="Settlement map"
      >
        <defs>
          <radialGradient id="fogGradient" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="#0b0f12" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#05080a" stopOpacity="0.9" />
          </radialGradient>
        </defs>

        <g
          transform={`translate(${view.x} ${view.y}) scale(${view.scale}) translate(${
            (1 / view.scale - 1) * (layout.minX + layout.width / 2)
          } ${(1 / view.scale - 1) * (layout.minY + layout.height / 2)})`}
        >
          {/* Hearth warmth: homes beyond this ring are cold during the Storm. */}
          {buildMode && (BUILDINGS[buildMode]?.housing ?? 0) > 0 && (
            <circle
              cx={layout.positions['0,0']?.x ?? 0}
              cy={layout.positions['0,0']?.y ?? 0}
              r={(HEARTH_WARMTH_RADIUS + 0.5) * HEX_SIZE * Math.sqrt(3)}
              className="warmth-ring"
            />
          )}
          {Object.values(run.tiles).map((tile) => {
            const pos = layout.positions[tile.key]
            const visibility = visibilityOf(run, tile)
            const building = tile.buildingId ? run.buildings[tile.buildingId] : undefined
            const placement = buildMode ? canPlaceBuilding(run, buildMode, tile.key) : null
            return (
              <HexTile
                key={tile.key}
                tileKey={tile.key}
                x={pos.x}
                y={pos.y}
                terrain={tile.terrain}
                blocked={tile.blocked}
                visibility={visibility}
                showGrid={showGrid}
                depositId={tile.deposit?.id}
                depositAmount={tile.deposit?.amount ?? null}
                buildingIcon={building ? BUILDINGS[building.defId]?.icon : undefined}
                buildingBuilt={building?.built ?? false}
                buildingProgress={
                  building && !building.built
                    ? building.buildProgress /
                      Math.max(1, BUILDINGS[building.defId]?.buildSeconds ?? 1)
                    : 0
                }
                workers={building?.workers.length ?? 0}
                workerSlots={building ? (BUILDINGS[building.defId]?.workerSlots ?? 0) : 0}
                paused={building?.paused ?? false}
                selected={selectedTile === tile.key}
                gladeSelected={selectedGlade === tile.gladeId}
                buildValid={buildMode ? placement === null : undefined}
                onClick={() => handleTileClick(tile)}
              />
            )
          })}

          {/* Glade labels sit above the tiles so they stay readable. */}
          {Object.values(run.glades).map((glade) => {
            if (!glade.discovered || glade.cleared) return null
            const pos = layout.positions[`${glade.center.q},${glade.center.r}`]
            if (!pos) return null
            const reachable = isReachable(run, glade.id)
            const pct = glade.clearWork > 0 ? glade.clearProgress / glade.clearWork : 0
            return (
              <g
                key={glade.id}
                className={`glade-label ${reachable ? '' : 'is-locked'}`}
                transform={`translate(${pos.x} ${pos.y})`}
                onClick={() => selectGlade(glade.id)}
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

      {buildMode && (
        <div className="build-banner">
          <span>
            Placing <strong>{BUILDINGS[buildMode]?.name}</strong> — tap a highlighted tile
          </span>
          <button type="button" onClick={() => useGameStore.getState().setBuildMode(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

interface HexTileProps {
  tileKey: string
  x: number
  y: number
  terrain: keyof typeof TERRAIN_COLORS
  blocked: boolean
  visibility: TileVisibility
  showGrid: boolean
  depositId?: keyof typeof DEPOSIT_INFO
  depositAmount: number | null
  buildingIcon?: string
  buildingBuilt: boolean
  buildingProgress: number
  workers: number
  workerSlots: number
  paused: boolean
  selected: boolean
  gladeSelected: boolean
  buildValid?: boolean
  onClick: () => void
}

/**
 * One hex. Memoised on primitive props so a 200-tile map re-renders cheaply
 * many times a second.
 */
const HexTile = memo(function HexTile(props: HexTileProps) {
  const {
    x,
    y,
    terrain,
    blocked,
    visibility,
    showGrid,
    depositId,
    depositAmount,
    buildingIcon,
    buildingBuilt,
    buildingProgress,
    workers,
    workerSlots,
    paused,
    selected,
    gladeSelected,
    buildValid,
    onClick,
  } = props

  const points = hexCorners(x, y, HEX_SIZE - 1)
  const hidden = visibility === 'hidden'
  const fogged = visibility === 'fogged'

  const classes = ['hex']
  if (hidden) classes.push('is-hidden')
  if (fogged) classes.push('is-fogged')
  if (blocked && !hidden) classes.push('is-blocked')
  if (selected) classes.push('is-selected')
  if (gladeSelected) classes.push('is-glade-selected')
  if (buildValid === true) classes.push('is-build-ok')
  if (buildValid === false) classes.push('is-build-bad')

  return (
    <g className={classes.join(' ')} onClick={onClick}>
      <polygon
        points={points}
        fill={hidden ? '#0a0e11' : TERRAIN_COLORS[terrain]}
        stroke={showGrid ? 'rgba(0,0,0,0.35)' : 'transparent'}
        strokeWidth={1}
      />
      {fogged && <polygon points={points} fill="url(#fogGradient)" />}

      {!hidden && !fogged && depositId && (
        <>
          <text className="hex-icon" x={x} y={y + 6}>
            {DEPOSIT_INFO[depositId].icon}
          </text>
          {depositAmount !== null && (
            <text className="hex-sub" x={x} y={y + 19}>
              {depositAmount}
            </text>
          )}
        </>
      )}

      {!hidden && !fogged && buildingIcon && (
        <>
          <circle cx={x} cy={y} r={HEX_SIZE * 0.62} className="building-disc" />
          <text className="hex-icon" x={x} y={y + 6}>
            {buildingIcon}
          </text>
          {!buildingBuilt && (
            <>
              <rect x={x - 16} y={y + 12} width={32} height={4} rx={2} className="build-bar-bg" />
              <rect
                x={x - 16}
                y={y + 12}
                width={32 * Math.min(1, buildingProgress)}
                height={4}
                rx={2}
                className="build-bar"
              />
            </>
          )}
          {buildingBuilt && workerSlots > 0 && (
            <text className="hex-sub" x={x} y={y + 20}>
              {workers}/{workerSlots}
            </text>
          )}
          {paused && (
            <text className="hex-flag" x={x + 14} y={y - 12}>
              ⏸
            </text>
          )}
        </>
      )}
    </g>
  )
})
