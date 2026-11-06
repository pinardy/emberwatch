import { memo, useContext, useLayoutEffect, useMemo, useRef } from 'react'
import { BUILDINGS } from '../game/content/buildings'
import { DEPOSIT_ART, GLADE_ART } from '../game/content/art'
import { SPECIES } from '../game/content/species'
import { footprintOf } from '../game/engine/actions'
import { ROAD_HALF_WIDTH } from '../game/engine/balance'
import { warmthSources } from '../game/engine/queries'
import { ROAD_TOOL } from '../game/engine/roads'
import { useGameStore } from '../game/store'
import type { GladeKind, RunState } from '../game/types'
import { IconUse } from './Icon'
import {
  clearedKey,
  depositKey,
  gladePlateKey,
  gladeSurfaceKey,
  roadKey,
  useRunKey,
  villagerRouteKey,
  warmthKey,
} from './map3d/layerKeys'
import {
  DEPOSIT_TINT,
  districtOf,
  GLADE_KIND_STYLE,
  gladeAccessText,
  gladeStakesTitle,
  GLADE_STAKE_ART,
  gladeAccess,
  gladeFill,
  gladeLook,
  gladePlateInfo,
  isWorldRunning,
  useWarmthRingVisible,
  type GladeAccess,
} from './mapShared'
import { obstacleTitle, plateShape } from './map2dArt'
import { S, ViewBusContext, useGhost, useMapInteraction } from './map2dState'
import { MAP_ICON } from './MapBuildings2D'
import { REDUCED_MOTION } from './motion'
import { advanceViewClock, deriveVillagerRoutes, poseAt, type Pose } from './villagerRoutes'

/**
 * The 2D map's layers. Each one subscribes to a key of exactly what it draws
 * (the 3D scene's keys, `map3d/layerKeys.ts`) and is memoised, so a sim step
 * that changes nothing a layer shows costs that layer one string compare.
 * Every layer takes the run as a prop: the object is stable for a whole run,
 * and the key subscription is what re-renders it.
 */

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

/** Glade polygons and the kind borders of fogged glades. */
export const GladeLayer2D = memo(function GladeLayer2D({ run }: { run: RunState }) {
  useRunKey(gladeSurfaceKey)
  const selectedGlade = useGameStore((s) => s.selectedGlade)
  const interaction = useMapInteraction()
  // Glade outlines never move during a run: stringify them once.
  const points = useMemo(() => {
    const out: Record<string, string> = {}
    for (const glade of Object.values(run.glades)) {
      out[glade.id] = glade.polygon.map((p) => `${p.x * S},${p.y * S}`).join(' ')
    }
    return out
  }, [run])
  const glades = Object.values(run.glades)
  return (
    <g className="glades-2d">
      {glades.map((glade) => {
        const look = gladeLook(glade)
        return (
          <polygon
            key={glade.id}
            points={points[glade.id]}
            className={`glade-poly is-${look} ${selectedGlade === glade.id ? 'is-selected' : ''}`}
            fill={gladeFill(glade, '2d')}
            onClick={(e) => {
              if (look !== 'fogged') return // cleared/hidden ground falls through to the map
              e.stopPropagation()
              if (!interaction.consumeSuppressedClick()) useGameStore.getState().selectGlade(glade.id)
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
            points={points[glade.id]}
            kind={glade.kind}
            access={gladeAccess(run, glade)}
          />
        ) : null,
      )}
    </g>
  )
})

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

/**
 * The season's light on the ground: a heavy slate wash in the Storm, a cool
 * film in the Drizzle, a warm one in the Clearance. Drawn over the terrain
 * and roads but under every building, plate and label, so the weather never
 * costs a building its legibility.
 */
export const WeatherGround2D = memo(function WeatherGround2D({
  x,
  y,
  width,
  height,
}: {
  x: number
  y: number
  width: number
  height: number
}) {
  const season = useGameStore((s) => s.run?.season.season ?? null)
  if (!season) return null
  return (
    <g className={`weather-ground is-${season}`} pointerEvents="none" data-season={season}>
      {season === 'storm' && (
        <defs>
          {/* Heavier towards the edges: the Storm closes in on the hearth. */}
          <radialGradient id="weather-storm-wash" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="rgb(14, 20, 34)" stopOpacity={0.36} />
            <stop offset="65%" stopColor="rgb(12, 16, 30)" stopOpacity={0.5} />
            <stop offset="100%" stopColor="rgb(6, 8, 20)" stopOpacity={0.72} />
          </radialGradient>
        </defs>
      )}
      <rect x={x} y={y} width={width} height={height} fill={WASH[season]} />
    </g>
  )
})

const WASH: Record<string, string> = {
  storm: 'url(#weather-storm-wash)',
  drizzle: 'rgba(64, 96, 128, 0.12)',
  clearance: 'rgba(255, 196, 110, 0.07)',
}

/** Every fire's reach, while the warmth overlay is showing. */
export const WarmthLayer2D = memo(function WarmthLayer2D({ run }: { run: RunState }) {
  const show = useWarmthRingVisible()
  useRunKey(warmthKey)
  if (!show) return null
  return (
    <g className="warmth-2d" pointerEvents="none">
      {warmthSources(run).map((w) => (
        <circle
          key={`warmth-${w.id}`}
          cx={w.pos.x * S}
          cy={w.pos.y * S}
          r={w.radius * S}
          className="warmth-ring"
        />
      ))}
    </g>
  )
})

/** Every laid road: a dark kerb, a packed-earth bed and a pale wheel rut. */
export const RoadLayer2D = memo(function RoadLayer2D({ run }: { run: RunState }) {
  useRunKey(roadKey)
  const roads = run.roads ?? []
  if (roads.length === 0) return null
  const width = (ROAD_HALF_WIDTH + 0.03) * 2 * S
  const line = (r: (typeof roads)[number], key: string, className: string, strokeWidth: number) => (
    <line
      key={key}
      x1={r.a.x * S}
      y1={r.a.y * S}
      x2={r.b.x * S}
      y2={r.b.y * S}
      className={className}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
    />
  )
  return (
    <g className="roads-2d" pointerEvents="none">
      {roads.map((r) => line(r, `${r.id}-kerb`, 'road-kerb', width + 5))}
      {roads.map((r) => line(r, r.id, 'road-bed', width))}
      {roads.map((r) => line(r, `${r.id}-mid`, 'road-rut', width * 0.22))}
    </g>
  )
})

/** Crags and mires on cleared ground: unclearable, so say so on hover. */
export const ObstacleLayer2D = memo(function ObstacleLayer2D({ run }: { run: RunState }) {
  useRunKey(clearedKey)
  return (
    <g className="obstacles-2d">
      {run.obstacles.map((o) => {
        if (!run.glades[o.gladeId]?.cleared) return null
        const cx = o.pos.x * S
        const cy = o.pos.y * S
        const r = o.radius * S
        const title = obstacleTitle(o.kind)
        return (
          <g key={o.id} className={`obstacle-2d is-${o.kind}`} data-obstacle={o.kind} aria-label={title}>
            <title>{title}</title>
            <circle cx={cx} cy={cy} r={r} className={`obstacle is-${o.kind}`} />
            <IconUse id={o.kind === 'mire' ? 'marsh' : 'crag'} x={cx} y={cy} size={Math.max(MAP_ICON, r * 1.25)} />
          </g>
        )
      })}
    </g>
  )
})

/** Deposits on cleared ground, with what is left in them. */
export const DepositLayer2D = memo(function DepositLayer2D({ run }: { run: RunState }) {
  useRunKey(depositKey)
  const selectedDeposit = useGameStore((s) => s.selectedDeposit)
  const interaction = useMapInteraction()
  return (
    <g className="deposits-2d">
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
              if (interaction.consumeSuppressedClick()) return
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
            <IconUse id={DEPOSIT_ART[d.kind]} x={cx} y={cy} size={Math.max(MAP_ICON, d.radius * S * 1.1)} />
            {d.amount !== null && (
              <text className="hex-sub deposit-amount" x={cx} y={cy + d.radius * S + 11}>
                {d.amount}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
})

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

/** The build ghost: footprint, plus a camp's reach or a brazier's warmth. */
export function BuildGhost2D() {
  const buildMode = useGameStore((s) => s.buildMode)
  const ghost = useGhost((s) => s.ghost)
  const def = buildMode && buildMode !== ROAD_TOOL ? BUILDINGS[buildMode] : undefined
  if (!def || !ghost) return null
  const cx = ghost.pos.x * S
  const cy = ghost.pos.y * S
  const plate = plateShape(districtOf(def), footprintOf(def.id) * S)
  return (
    <g className="ghost-2d" pointerEvents="none">
      {def.gatherRadius && (
        <circle
          cx={cx}
          cy={cy}
          r={def.gatherRadius * S}
          fill="none"
          stroke="#9fc9a3"
          strokeOpacity={0.5}
          strokeDasharray="4 4"
        />
      )}
      {def.warmth && <circle cx={cx} cy={cy} r={def.warmth.radius * S} className="warmth-ring" />}
      <path
        d={plate.d}
        transform={`translate(${cx} ${cy})`}
        fill={ghost.ok ? 'rgba(111, 191, 114, 0.45)' : 'rgba(192, 80, 80, 0.45)'}
        stroke={ghost.ok ? '#6fbf72' : '#c05050'}
        strokeWidth={2}
      />
    </g>
  )
}

/** The road tool's ghost: the stretch the next click lays, or the one it lifts. */
export function RoadGhost2D({ run }: { run: RunState }) {
  const buildMode = useGameStore((s) => s.buildMode)
  const anchor = useGameStore((s) => s.roadAnchor)
  const preview = useGhost((s) => s.ghost?.road ?? null)
  if (buildMode !== ROAD_TOOL) return null
  const lifting = preview?.removeId ? (run.roads ?? []).find((r) => r.id === preview.removeId) : null
  const color = preview?.ok ? '#6fbf72' : '#c05050'
  return (
    <g className="road-ghost-2d" pointerEvents="none">
      {preview?.from && (
        <line
          x1={preview.from.x * S}
          y1={preview.from.y * S}
          x2={preview.to.x * S}
          y2={preview.to.y * S}
          stroke={color}
          strokeOpacity={0.75}
          strokeWidth={(ROAD_HALF_WIDTH + 0.03) * 2 * S}
          strokeLinecap="round"
        />
      )}
      {lifting && (
        <line
          x1={lifting.a.x * S}
          y1={lifting.a.y * S}
          x2={lifting.b.x * S}
          y2={lifting.b.y * S}
          stroke="#c05050"
          strokeOpacity={0.85}
          strokeWidth={0.5 * S}
          strokeLinecap="round"
        />
      )}
      {anchor && (
        <circle className="road-anchor" cx={anchor.x * S} cy={anchor.y * S} r={6} fill="none" stroke="#d9b46a" strokeWidth={2.5} />
      )}
      {preview && !preview.removeId && <circle cx={preview.to.x * S} cy={preview.to.y * S} r={4} fill={color} />}
    </g>
  )
}

/** Name plates over discovered-but-uncleared glades. */
export const GladePlateLayer2D = memo(function GladePlateLayer2D({ run }: { run: RunState }) {
  useRunKey(gladePlateKey)
  const interaction = useMapInteraction()
  return (
    <g className="glade-plates-2d">
      {Object.values(run.glades).map((glade) => {
        if (!glade.discovered || glade.cleared) return null
        const info = gladePlateInfo(run, glade)
        const { pct } = info
        const reachable = info.access !== 'locked'
        const kindStyle = GLADE_KIND_STYLE[glade.kind]
        return (
          <g
            key={glade.id}
            className={`glade-label is-${glade.kind} is-${info.access} ${reachable ? '' : 'is-locked'}`}
            transform={`translate(${glade.center.x * S} ${glade.center.y * S})`}
            onClick={(e) => {
              e.stopPropagation()
              if (interaction.consumeSuppressedClick()) return
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
            {/* Kind icon and label, centred together as one line. */}
            <IconUse id={GLADE_ART[glade.kind]} x={-kindStyle.label.length * 2.8 - 1} y={-11} size={11} />
            <text x={6} y={-8} className="glade-kind" style={reachable ? { fill: kindStyle.edge } : undefined}>
              {kindStyle.label}
            </text>
            <text y={7} className="glade-name">
              {glade.name}
            </text>
            {pct > 0 && (
              <>
                <rect x={-40} y={13} width={80} height={5} rx={2.5} className="glade-bar-bg" />
                <rect x={-40} y={13} width={80 * Math.min(1, pct)} height={5} rx={2.5} className="glade-bar" />
              </>
            )}
            <text y={28} className="glade-crew" style={reachable ? undefined : { fill: '#6d7a7a' }}>
              {gladeAccessText(info.access, pct, info.clearers)}
            </text>
            {info.stakes.length > 0 && (
              <g className="glade-stakes">
                <title>{gladeStakesTitle(info.stakes)}</title>
                <rect
                  x={-(info.stakes.length * 15 + 6) / 2}
                  y={36}
                  width={info.stakes.length * 15 + 6}
                  height={18}
                  rx={9}
                  className="glade-plate"
                />
                {info.stakes.map((k, i) => (
                  <IconUse
                    key={k}
                    id={GLADE_STAKE_ART[k]}
                    x={-(info.stakes.length - 1) * 7.5 + i * 15}
                    y={45}
                    size={13}
                  />
                ))}
              </g>
            )}
          </g>
        )
      })}
    </g>
  )
})

// ---------------------------------------------------------------------------
// Villagers: a canvas over the SVG
// ---------------------------------------------------------------------------

export interface ViewBoxRect {
  x: number
  y: number
  w: number
  h: number
}

/** jsdom has no canvas backend; asking it for a context only logs an error. */
const NO_CANVAS =
  typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent ?? '')

/**
 * Villagers as species-coloured dots walking their derived routes, drawn on
 * a `<canvas>` laid over the SVG. Moving a dot is then a canvas redraw, not
 * an SVG attribute write: the SVG (hundreds of nodes) is never re-laid-out
 * or repainted for a walking villager.
 *
 * The animation loop runs only while the game is running and the tab is
 * visible; a paused or hidden game draws once (and again on pan/zoom).
 * Building outlines are cut out of the dots, so villagers still step in and
 * out of doors rather than walking over the roofs.
 *
 * The same canvas carries the season's rain (one stroked path of streaks in
 * screen space, heavy in the Storm, light in the Drizzle) and the Storm's
 * lightning. An animated overlay layer would cost a full-map composite per
 * frame where there is no GPU compositing — exactly where the 2D map runs —
 * while a few hundred line segments on a canvas already being redrawn cost
 * next to nothing. Rain holds still while the game is paused; under
 * reduced motion it is drawn still and the lightning is left out.
 */
export const VillagerCanvas2D = memo(function VillagerCanvas2D({
  run,
  viewBox,
}: {
  run: RunState
  viewBox: ViewBoxRect
}) {
  const routeKey = useRunKey(villagerRouteKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const routes = useMemo(() => deriveVillagerRoutes(run), [run, routeKey])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bus = useContext(ViewBusContext)
  const viewClock = useRef(run.clock)
  /** Real seconds the world has been running here: drives rain and lightning. */
  const weatherClock = useRef(0)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || NO_CANVAS) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const colors = routes.map((r) => SPECIES[r.species]?.color ?? '#cccccc')
    const roofs = roofPath(run)
    let cssW = 0
    let cssH = 0
    let dpr = 1
    const pose: Pose = { x: 0, y: 0, moving: false }

    const resize = () => {
      const box = canvas.getBoundingClientRect()
      dpr = Math.min(2, window.devicePixelRatio || 1)
      cssW = box.width
      cssH = box.height
      const w = Math.max(1, Math.round(cssW * dpr))
      const h = Math.max(1, Math.round(cssH * dpr))
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
    }

    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (cssW <= 0 || cssH <= 0) return
      // Same mapping as the SVG: viewBox "meet", then the camera transform.
      const k0 = Math.min(cssW / viewBox.w, cssH / viewBox.h)
      const ox = (cssW - viewBox.w * k0) / 2 - viewBox.x * k0
      const oy = (cssH - viewBox.h * k0) / 2 - viewBox.y * k0
      const view = bus.get()
      const k = k0 * view.scale * dpr
      ctx.setTransform(k, 0, 0, k, (ox + k0 * view.x) * dpr, (oy + k0 * view.y) * dpr)
      ctx.lineWidth = 1.2
      ctx.strokeStyle = 'rgba(9, 13, 16, 0.85)'
      const t = viewClock.current
      for (let i = 0; i < routes.length; i++) {
        const route = routes[i]
        if (REDUCED_MOTION) {
          pose.x = route.rest.x
          pose.y = route.rest.y
        } else poseAt(route, t, pose)
        ctx.beginPath()
        ctx.arc(pose.x * S, pose.y * S, 3.4, 0, Math.PI * 2)
        ctx.fillStyle = colors[i]
        ctx.fill()
        ctx.stroke()
      }
      if (roofs) {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fill(roofs)
        ctx.globalCompositeOperation = 'source-over'
      }
      drawWeather(ctx, run.season.season, weatherClock.current, cssW, cssH, dpr)
    }

    const running = () =>
      isWorldRunning(useGameStore.getState().speed, run) && document.visibilityState !== 'hidden'

    let frame = 0
    let last = 0
    const step = (now: number) => {
      frame = 0
      const dt = Math.max(0, (now - last) / 1000)
      last = now
      const { speed } = useGameStore.getState()
      const live = running()
      viewClock.current = advanceViewClock(viewClock.current, dt, live ? speed : 0, run.clock)
      if (live && !REDUCED_MOTION) weatherClock.current += Math.min(dt, 0.25)
      draw()
      if (running() && !REDUCED_MOTION) frame = requestAnimationFrame(step)
    }
    /** Starts the loop, or queues a single redraw when the game stands still. */
    const wake = () => {
      if (frame) return
      last = performance.now()
      frame = requestAnimationFrame(step)
    }
    const onStore = () => {
      if (!frame && running() && !REDUCED_MOTION) wake()
    }

    resize()
    draw()
    wake()
    const unsubscribeStore = useGameStore.subscribe(onStore)
    const unsubscribeView = bus.subscribe(wake)
    const onVisible = () => wake()
    document.addEventListener('visibilitychange', onVisible)
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            resize()
            wake()
          })
        : null
    observer?.observe(canvas)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      unsubscribeStore()
      unsubscribeView()
      document.removeEventListener('visibilitychange', onVisible)
      observer?.disconnect()
    }
  }, [routes, run, bus, viewBox])

  return (
    <canvas
      ref={canvasRef}
      className="villagers-2d"
      aria-hidden
      data-villagers={routes.length}
      data-on-road={routes.filter((r) => r.onRoad).length}
    />
  )
})

/** Every building's plate outline in SVG units, to cut walkers out under. */
function roofPath(run: RunState): Path2D | null {
  if (typeof Path2D !== 'function' || typeof DOMMatrix !== 'function') return null
  const roofs = new Path2D()
  for (const b of Object.values(run.buildings)) {
    const def = BUILDINGS[b.defId]
    if (!def) continue
    const plate = new Path2D(plateShape(districtOf(def), footprintOf(b.defId) * S).d)
    roofs.addPath(plate, new DOMMatrix([1, 0, 0, 1, b.pos.x * S, b.pos.y * S]))
  }
  return roofs
}

// ---------------------------------------------------------------------------
// Weather on the canvas
// ---------------------------------------------------------------------------

interface RainStyle {
  /** Screen pixels of map per streak. */
  area: number
  /** Fall velocity, px/s (down and a little to the left). */
  vx: number
  vy: number
  /** Streak length in seconds of travel. */
  length: number
  width: number
  color: string
}

const RAIN: Partial<Record<string, RainStyle>> = {
  storm: { area: 2400, vx: -150, vy: 520, length: 0.036, width: 1.3, color: 'rgba(205, 222, 242, 0.5)' },
  drizzle: { area: 14000, vx: -40, vy: 210, length: 0.045, width: 1, color: 'rgba(185, 205, 230, 0.22)' },
}

/** Fixed pseudo-random drop field (normalised 0..1), shared by every map. */
const DROPS: Float32Array = (() => {
  const out = new Float32Array(2048)
  let seed = 0x2f6b
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    out[i] = seed / 0x7fffffff
  }
  return out
})()

/**
 * Rain streaks over the whole map in screen space, then the Storm's
 * lightning: two quick white flashes every thirteen seconds of play.
 */
function drawWeather(
  ctx: CanvasRenderingContext2D,
  season: string,
  t: number,
  w: number,
  h: number,
  dpr: number,
): void {
  const rain = RAIN[season]
  if (!rain) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const count = Math.min(DROPS.length / 2, Math.round((w * h) / rain.area))
  const dx = rain.vx * rain.length
  const dy = rain.vy * rain.length
  // Wrap a little beyond the edges so streaks enter and leave smoothly.
  const W = w + 40
  const H = h + 40
  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const speed = 0.8 + DROPS[i * 2 + 1] * 0.4
    let x = (DROPS[i * 2] * W + rain.vx * speed * t) % W
    let y = (DROPS[i * 2 + 1] * 7919 * H + rain.vy * speed * t) % H
    if (x < 0) x += W
    if (y < 0) y += H
    x -= 20
    y -= 20
    ctx.moveTo(x, y)
    ctx.lineTo(x + dx, y + dy)
  }
  ctx.strokeStyle = rain.color
  ctx.lineWidth = rain.width
  ctx.lineCap = 'round'
  ctx.stroke()
  if (season === 'storm' && !REDUCED_MOTION) {
    const flash = lightningAt(t)
    if (flash > 0) {
      ctx.fillStyle = `rgba(222, 232, 255, ${flash})`
      ctx.fillRect(0, 0, w, h)
    }
  }
}

/** Flash strength at `t` seconds: a strike and its echo, every 13 s. */
export function lightningAt(t: number): number {
  const phase = (t % 13) / 13
  if (phase >= 0.61 && phase < 0.622) return 0.2
  if (phase >= 0.636 && phase < 0.646) return 0.12
  return 0
}
