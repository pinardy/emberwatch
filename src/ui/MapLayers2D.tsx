import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { SPECIES } from '../game/content/species'
import { ROAD_HALF_WIDTH } from '../game/engine/balance'
import type { RoadPreview } from '../game/engine/roads'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { REDUCED_MOTION } from './motion'
import { advanceViewClock, deriveVillagerRoutes, poseAt, type Pose } from './villagerRoutes'

/**
 * Road and villager layers of the 2D map. The map re-renders on every sim
 * tick, so each layer here is memoised on a key of exactly what it draws
 * (`roadKey`, `villagerRouteKey`) and skips those renders. Villager dots then
 * move by writing their `cx`/`cy` directly each animation frame — React is
 * not involved per frame.
 */

/** Every laid road, as round-capped strokes under the buildings. */
export const RoadLayer2D = memo(function RoadLayer2D({
  run,
  scale,
}: {
  run: RunState
  scale: number
  /** Re-render trigger: changes only when a road is laid or lifted. */
  roadsKey: string
}) {
  const roads = run.roads ?? []
  if (roads.length === 0) return null
  const width = (ROAD_HALF_WIDTH + 0.03) * 2 * scale
  return (
    <g className="roads-2d" pointerEvents="none">
      {roads.map((r) => (
        <line
          key={r.id}
          x1={r.a.x * scale}
          y1={r.a.y * scale}
          x2={r.b.x * scale}
          y2={r.b.y * scale}
          stroke="#8f7a58"
          strokeWidth={width}
          strokeLinecap="round"
        />
      ))}
      {roads.map((r) => (
        <line
          key={`${r.id}-mid`}
          x1={r.a.x * scale}
          y1={r.a.y * scale}
          x2={r.b.x * scale}
          y2={r.b.y * scale}
          stroke="#b59d74"
          strokeWidth={width * 0.5}
          strokeLinecap="round"
        />
      ))}
    </g>
  )
})

/** The road tool's ghost: the stretch the next click lays, or the one it lifts. */
export function RoadGhost2D({
  run,
  preview,
  scale,
}: {
  run: RunState
  preview: RoadPreview | null
  scale: number
}) {
  const anchor = useGameStore((s) => s.roadAnchor)
  const lifting = preview?.removeId ? (run.roads ?? []).find((r) => r.id === preview.removeId) : null
  const color = preview?.ok ? '#6fbf72' : '#c05050'
  return (
    <g className="road-ghost-2d" pointerEvents="none">
      {preview?.from && (
        <line
          x1={preview.from.x * scale}
          y1={preview.from.y * scale}
          x2={preview.to.x * scale}
          y2={preview.to.y * scale}
          stroke={color}
          strokeOpacity={0.75}
          strokeWidth={(ROAD_HALF_WIDTH + 0.03) * 2 * scale}
          strokeLinecap="round"
        />
      )}
      {lifting && (
        <line
          x1={lifting.a.x * scale}
          y1={lifting.a.y * scale}
          x2={lifting.b.x * scale}
          y2={lifting.b.y * scale}
          stroke="#c05050"
          strokeOpacity={0.85}
          strokeWidth={0.5 * scale}
          strokeLinecap="round"
        />
      )}
      {anchor && (
        <circle className="road-anchor" cx={anchor.x * scale} cy={anchor.y * scale} r={6} fill="none" stroke="#d9b46a" strokeWidth={2.5} />
      )}
      {preview && !preview.removeId && (
        <circle cx={preview.to.x * scale} cy={preview.to.y * scale} r={4} fill={color} />
      )}
    </g>
  )
}

/**
 * Villagers as species-coloured dots walking their derived routes. Placed
 * once on mount (and on every route change) so a still frame — or reduced
 * motion — shows them at their posts; animated by requestAnimationFrame.
 */
export const VillagerDots2D = memo(function VillagerDots2D({
  run,
  scale,
  routeKey,
}: {
  run: RunState
  scale: number
  /** Re-derives routes only when this changes (see `villagerRouteKey`). */
  routeKey: string
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const routes = useMemo(() => deriveVillagerRoutes(run), [run, routeKey])
  const group = useRef<SVGGElement>(null)
  const viewClock = useRef(run.clock)

  useLayoutEffect(() => {
    const g = group.current
    if (!g) return
    const pose: Pose = { x: 0, y: 0, moving: false }
    const draw = (t: number) => {
      const dots = g.children
      for (let i = 0; i < routes.length && i < dots.length; i++) {
        const route = routes[i]
        if (REDUCED_MOTION) {
          pose.x = route.rest.x
          pose.y = route.rest.y
        } else poseAt(route, t, pose)
        dots[i].setAttribute('cx', (pose.x * scale).toFixed(1))
        dots[i].setAttribute('cy', (pose.y * scale).toFixed(1))
      }
    }
    draw(viewClock.current)
    if (REDUCED_MOTION || typeof requestAnimationFrame !== 'function') return
    let frame = 0
    let last = performance.now()
    const step = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const { speed } = useGameStore.getState()
      const running = run.phase === 'playing' && run.pendingChoices.length === 0
      viewClock.current = advanceViewClock(viewClock.current, dt, running ? speed : 0, run.clock)
      draw(viewClock.current)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [routes, run, scale])

  return (
    <g ref={group} className="villagers-2d" pointerEvents="none">
      {routes.map((route) => (
        <circle
          key={route.id}
          className="villager-dot"
          r={3.4}
          fill={SPECIES[route.species].color}
          stroke="rgba(9, 13, 16, 0.85)"
          strokeWidth={1.2}
        />
      ))}
    </g>
  )
})
