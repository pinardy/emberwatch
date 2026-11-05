import { BUILDINGS } from '../game/content/buildings'
import { FOOTPRINT_RADIUS } from '../game/engine/balance'
import { roadNetwork, type RoadNetwork } from '../game/engine/roads'
import { housingOf, isUpgrading } from '../game/engine/upgrades'
import type { BuildingInstance, RunState, SpeciesId, Vec2 } from '../game/types'

/**
 * Walking villagers — presentation only. Nothing here is simulated: a
 * villager's day is derived from what the sim already knows (who they are,
 * what they are assigned to, which homes and sites stand, which roads are
 * laid) and played back against the clock. Both maps share it.
 *
 * Each villager gets a looping *route*: home → work → the hearth for a meal →
 * home, with a dwell at each stop. Builders (idle villagers while a site is
 * open) walk to a site instead, clearing crews to their glade, and the truly
 * idle loaf between home and the fire. Legs follow the road graph when a road
 * runs that way, and fall back to a straight line when none does.
 *
 * Routes are rebuilt only when their inputs change (see `villagerRouteKey`),
 * and `poseAt` reads one without allocating, so a frame costs a binary search
 * per villager.
 */

/** World units walked per second of sim time (so 2× speed walks twice as fast). */
export const WALK_SPEED = 1.1

/** Seconds spent at each kind of stop. */
const DWELL = { home: 5, work: 16, meal: 3, site: 14, glade: 18, loaf: 9 } as const

/** A leg may detour along the road by at most this factor over the crow's flight. */
const ROAD_DETOUR = 1.6
/** How far a villager will cut across to join a road. */
const ROAD_ENTRY = 2.2

export interface VillagerRoute {
  id: string
  species: SpeciesId
  /**
   * Timed waypoints of one loop: at time `ts[i]` the villager stands at
   * (`xs[i]`, `ys[i]`). `ts[0]` is 0, the last time is `period`, and the last
   * point repeats the first. A dwell is two equal points at different times.
   */
  xs: Float32Array
  ys: Float32Array
  ts: Float32Array
  period: number
  /** Offset into the loop so a crew does not move in lockstep. */
  phase: number
  /** Where a still villager stands (reduced motion): at their work. */
  rest: Vec2
  /** Some leg follows a road. */
  onRoad: boolean
}

/** Reused output of `poseAt`. */
export interface Pose {
  x: number
  y: number
  /** Walking (rather than standing at a stop). */
  moving: boolean
}

/** Stable 0..1 hash of a string and a salt (FNV-1a). */
export function hash01(key: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 13
  h = Math.imul(h, 0x5bd1e995)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

function footprint(b: BuildingInstance): number {
  const def = BUILDINGS[b.defId]
  return def ? (def.footprint ?? FOOTPRINT_RADIUS[def.category]) : 0.6
}

/** A spot just outside a building's footprint, different per villager. */
function doorstep(b: BuildingInstance, villagerId: string, salt: number, spread = 0.12): Vec2 {
  const angle = hash01(villagerId, salt) * Math.PI * 2
  const r = footprint(b) + 0.18 + hash01(villagerId, salt + 1) * spread
  return { x: b.pos.x + Math.cos(angle) * r, y: b.pos.y + Math.sin(angle) * r }
}

/**
 * Which home each villager sleeps in: finished housing fills in build order,
 * the hearth's bedrolls last. Derived, never stored.
 */
export function assignHomes(run: RunState): Map<string, BuildingInstance> {
  const homes = Object.values(run.buildings).filter((b) => b.built && housingOf(b) > 0)
  homes.sort(
    (a, b) =>
      Number(BUILDINGS[a.defId]?.category === 'hearth') -
      Number(BUILDINGS[b.defId]?.category === 'hearth'),
  )
  const out = new Map<string, BuildingInstance>()
  let home = 0
  let used = 0
  for (const v of Object.values(run.villagers)) {
    while (home < homes.length && used >= housingOf(homes[home])) {
      home++
      used = 0
    }
    if (home >= homes.length) break
    out.set(v.id, homes[home])
    used++
  }
  return out
}

/** Shortest paths over the road graph from one node (plain Dijkstra). */
function shortestFrom(net: RoadNetwork, source: number): { d: number[]; prev: number[] } {
  const d = net.nodes.map(() => Infinity)
  const prev = net.nodes.map(() => -1)
  const done = net.nodes.map(() => false)
  d[source] = 0
  for (;;) {
    let u = -1
    for (let i = 0; i < d.length; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i
    if (u < 0) break
    done[u] = true
    for (const ei of net.adjacency[u]) {
      const e = net.edges[ei]
      const v = e.a === u ? e.b : e.a
      if (d[u] + e.length < d[v]) {
        d[v] = d[u] + e.length
        prev[v] = u
      }
    }
  }
  return { d, prev }
}

function nearestNode(net: RoadNetwork, p: Vec2): number {
  let best = -1
  let bestDistance = ROAD_ENTRY
  net.nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - p.x, n.y - p.y)
    if (d <= bestDistance) {
      best = i
      bestDistance = d
    }
  })
  return best
}

/**
 * The way from `a` to `b`: along the roads when a road runs that way without
 * a long detour, else straight. Returns the points after `a`, ending at `b`.
 * `cache` holds shortest-path trees per entry node for one derivation pass.
 */
export function walkPath(
  net: RoadNetwork,
  a: Vec2,
  b: Vec2,
  cache: Map<number, { d: number[]; prev: number[] }> = new Map(),
): { points: Vec2[]; onRoad: boolean } {
  const straight = Math.hypot(b.x - a.x, b.y - a.y)
  const plain = { points: [b], onRoad: false }
  if (net.edges.length === 0 || straight < 0.5) return plain
  const entry = nearestNode(net, a)
  const exit = nearestNode(net, b)
  if (entry < 0 || exit < 0 || entry === exit) return plain
  let tree = cache.get(entry)
  if (!tree) {
    tree = shortestFrom(net, entry)
    cache.set(entry, tree)
  }
  const along = tree.d[exit]
  if (along === Infinity) return plain
  const into = net.nodes[entry]
  const outOf = net.nodes[exit]
  const total =
    Math.hypot(into.x - a.x, into.y - a.y) + along + Math.hypot(b.x - outOf.x, b.y - outOf.y)
  if (total > straight * ROAD_DETOUR + 1) return plain
  const nodes: number[] = []
  for (let n = exit; n >= 0; n = tree.prev[n]) nodes.push(n)
  nodes.reverse()
  return { points: [...nodes.map((n) => net.nodes[n]), b], onRoad: true }
}

interface Stop {
  pos: Vec2
  dwell: number
}

/** Lays a loop of stops out as timed waypoints. */
function timeline(stops: Stop[], net: RoadNetwork, cache: Map<number, { d: number[]; prev: number[] }>) {
  const xs: number[] = []
  const ys: number[] = []
  const ts: number[] = []
  let t = 0
  let onRoad = false
  const at = (p: Vec2) => {
    xs.push(p.x)
    ys.push(p.y)
    ts.push(t)
  }
  stops.forEach((stop, i) => {
    at(stop.pos)
    t += stop.dwell
    at(stop.pos)
    const next = stops[(i + 1) % stops.length].pos
    const path = walkPath(net, stop.pos, next, cache)
    onRoad ||= path.onRoad
    let from = stop.pos
    const points = path.points
    for (let k = 0; k < points.length; k++) {
      const p = points[k]
      t += Math.hypot(p.x - from.x, p.y - from.y) / WALK_SPEED
      from = p
      // The leg's last point is the next stop, which adds itself (and the
      // loop's closing point repeats the first stop, added below).
      if (k < points.length - 1) at(p)
    }
  })
  xs.push(xs[0])
  ys.push(ys[0])
  ts.push(t)
  return {
    xs: Float32Array.from(xs),
    ys: Float32Array.from(ys),
    ts: Float32Array.from(ts),
    period: Math.max(t, 1e-3),
    onRoad,
  }
}

/** Every villager's looping route, derived from the run as it stands. */
export function deriveVillagerRoutes(run: RunState, net: RoadNetwork = roadNetwork(run)): VillagerRoute[] {
  const hearth = Object.values(run.buildings).find((b) => BUILDINGS[b.defId]?.category === 'hearth')
  const homes = assignHomes(run)
  const sites = Object.values(run.buildings).filter((b) => !b.built || isUpgrading(b))
  const cache = new Map<number, { d: number[]; prev: number[] }>()
  const fire = (id: string, salt: number): Vec2 => {
    if (hearth) return doorstep(hearth, id, salt, 1.1)
    const angle = hash01(id, salt) * Math.PI * 2
    return { x: Math.cos(angle) * 1.6, y: Math.sin(angle) * 1.6 }
  }

  return Object.values(run.villagers).map((v, index) => {
    const homeBuilding = homes.get(v.id)
    const home = homeBuilding ? doorstep(homeBuilding, v.id, 11) : fire(v.id, 11)
    const meal = fire(v.id, 21)
    let stops: Stop[]
    let rest: Vec2
    const assignment = v.assignment
    if (assignment?.startsWith('clearing:')) {
      const glade = run.glades[assignment.slice('clearing:'.length)]
      const angle = hash01(v.id, 31) * Math.PI * 2
      const spot = glade
        ? { x: glade.center.x + Math.cos(angle) * 0.9, y: glade.center.y + Math.sin(angle) * 0.9 }
        : meal
      stops = [
        { pos: home, dwell: DWELL.home },
        { pos: spot, dwell: DWELL.glade },
        { pos: meal, dwell: DWELL.meal },
      ]
      rest = spot
    } else if (assignment && run.buildings[assignment]) {
      const work = doorstep(run.buildings[assignment], v.id, 41)
      stops = [
        { pos: home, dwell: DWELL.home },
        { pos: work, dwell: DWELL.work },
        { pos: meal, dwell: DWELL.meal },
      ]
      rest = work
    } else if (sites.length > 0) {
      // Idle hands are the builders: each lends a hand at one open site.
      const site = doorstep(sites[index % sites.length], v.id, 51, 0.3)
      stops = [
        { pos: home, dwell: DWELL.home },
        { pos: site, dwell: DWELL.site },
        { pos: meal, dwell: DWELL.meal },
      ]
      rest = site
    } else {
      stops = [
        { pos: home, dwell: DWELL.home },
        { pos: fire(v.id, 61), dwell: DWELL.loaf },
      ]
      rest = stops[1].pos
    }
    const line = timeline(stops, net, cache)
    return {
      id: v.id,
      species: v.species,
      ...line,
      phase: hash01(v.id, 71) * line.period,
      rest,
    }
  })
}

/**
 * Where a villager on `route` stands at sim time `t`. Writes into `out` and
 * returns it — no allocation, so it can run per villager per frame.
 */
export function poseAt(route: VillagerRoute, t: number, out: Pose): Pose {
  const { xs, ys, ts, period } = route
  let u = (t + route.phase) % period
  if (u < 0) u += period
  let lo = 0
  let hi = ts.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (ts[mid] <= u) lo = mid
    else hi = mid
  }
  const span = ts[hi] - ts[lo]
  const f = span > 0 ? (u - ts[lo]) / span : 0
  const dx = xs[hi] - xs[lo]
  const dy = ys[hi] - ys[lo]
  out.x = xs[lo] + dx * f
  out.y = ys[lo] + dy * f
  out.moving = dx !== 0 || dy !== 0
  return out
}

/**
 * A render clock that follows the sim smoothly. The sim advances in 0.125 s
 * steps; walking against that would stutter at 8 Hz, so the view runs its
 * own clock at the game speed and is pulled back if it drifts from the sim
 * (a pause, a load, a choice holding the world still).
 */
export function advanceViewClock(view: number, realDt: number, speed: number, simClock: number): number {
  const t = view + Math.min(realDt, 0.25) * speed
  if (Math.abs(t - simClock) > 1) return simClock
  return Math.min(simClock + 0.25, Math.max(simClock - 0.25, t))
}
