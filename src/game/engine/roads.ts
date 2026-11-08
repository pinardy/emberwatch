import { BUILDINGS } from '../content/buildings'
import { RESOURCES } from '../content/resources'
import type {
  BuildingDef,
  BuildingInstance,
  Glade,
  Obstacle,
  ResourceBag,
  RoadSegment,
  RunState,
  Vec2,
} from '../types'
import {
  FOOTPRINT_RADIUS,
  ROAD_HALF_WIDTH,
  ROAD_MAX_LENGTH,
  ROAD_MIN_LENGTH,
  ROAD_REACH,
  ROAD_SNAP,
  ROAD_WOOD_PER_UNIT,
  ROAD_WORK_BONUS,
} from './balance'
import { closestT, dist, distToSegment, pointInPolygon } from './geometry'
import { gladeAt, insideWorld } from './mapgen'
import { canAfford, grant, spend, storageUsed } from './queries'

/**
 * Roads. The player lays straight stretches between points; the stretches
 * join wherever their ends meet (or an end lands on another stretch) into a
 * graph over road nodes. A workplace the graph joins to a *hub* — the hearth
 * or a warehouse — hauls its goods faster: up to `ROAD_WORK_BONUS` percent,
 * scaled by how direct the road is (straight-line distance ÷ road distance).
 *
 * The graph is derived, never stored: it is built once when the roads or the
 * finished buildings change and cached per run object, so the per-tick cost
 * of the bonus is a map lookup. Saves carry only the segments themselves.
 */

/** Sentinel `buildMode` for the road tool, shared by the store and both maps. */
export const ROAD_TOOL = 'road'

/** Ends closer than this are the same node. */
const NODE_EPS = 0.05

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export function roadLength(road: Pick<RoadSegment, 'a' | 'b'>): number {
  return dist(road.a, road.b)
}

/** Footprint radius of a def (kept here so roads need not import actions). */
function footprintRadius(defId: string): number {
  const def = BUILDINGS[defId]
  return def ? (def.footprint ?? FOOTPRINT_RADIUS[def.category]) : 0.6
}

/** The hearth and warehouses are where hauled goods end up. */
export function isRoadHub(def: BuildingDef | undefined): boolean {
  return !!def && (def.category === 'hearth' || def.tags.includes('storage'))
}

/**
 * Buildings whose work a road speeds up: staffed producers. Services are left
 * out (a faster cycle there only burns goods quicker), as are hubs.
 */
export function benefitsFromRoad(def: BuildingDef | undefined): boolean {
  return (
    !!def &&
    def.workerSlots > 0 &&
    def.recipes.length > 0 &&
    def.category !== 'service' &&
    !isRoadHub(def)
  )
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

export interface RoadEdge {
  a: number
  b: number
  length: number
  /** The segment this edge is (part of). */
  road: string
}

/** How a spot (a building, or a ghost) sits on the road network. */
export interface RoadLink {
  /** Some road passes within reach. */
  touches: boolean
  /** That road leads to a hub. */
  connected: boolean
  /** Hub reached, if connected. */
  hubId: string | null
  /** Distance to that hub along the road (Infinity when not connected). */
  roadDistance: number
  /** Straight-line distance to that hub. */
  straight: number
  /** Work-speed bonus, whole percent (0 when not connected). */
  percent: number
}

interface Hub {
  id: string
  pos: Vec2
  reach: number
}

/** A hub's foothold on one edge. */
interface HubFoothold {
  edge: number
  t: number
  hop: number
  hub: number
}

export interface RoadNetwork {
  nodes: Vec2[]
  edges: RoadEdge[]
  /** Edge indices touching each node. */
  adjacency: number[][]
  /** Road distance from each node to the nearest hub (Infinity when cut off). */
  hubDistance: number[]
  /** Index into `hubs` of the hub each node reaches. */
  hubOf: number[]
  hubs: Hub[]
  footholds: HubFoothold[]
  /** Link of every building (by id), hubs included as connected at 0. */
  links: Map<string, RoadLink>
}

/** Creation counter: tests assert it stays flat while the sim ticks. */
export const roadStats = { networksBuilt: 0 }

const NO_LINK: RoadLink = {
  touches: false,
  connected: false,
  hubId: null,
  roadDistance: Infinity,
  straight: Infinity,
  percent: 0,
}

/**
 * Builds the road graph for `roads` (the run's own by default) and every
 * building's link to it. Pure; the result is cached by `roadNetwork`.
 */
export function buildRoadNetwork(s: RunState, roads: RoadSegment[] = s.roads ?? []): RoadNetwork {
  roadStats.networksBuilt++
  const nodes: Vec2[] = []
  const nodeOf = (p: Vec2): number => {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.abs(nodes[i].x - p.x) < NODE_EPS && Math.abs(nodes[i].y - p.y) < NODE_EPS) return i
    }
    nodes.push({ x: p.x, y: p.y })
    return nodes.length - 1
  }
  const ends = roads.map((r) => [nodeOf(r.a), nodeOf(r.b)] as const)

  // An end landing on the middle of another stretch is a junction: split it.
  const edges: RoadEdge[] = []
  roads.forEach((road, j) => {
    const [ia, ib] = ends[j]
    const splits: { t: number; node: number }[] = []
    for (let k = 0; k < nodes.length; k++) {
      if (k === ia || k === ib) continue
      if (distToSegment(nodes[k], road.a, road.b) >= NODE_EPS) continue
      const t = closestT(nodes[k], road.a, road.b)
      if (t > 1e-6 && t < 1 - 1e-6) splits.push({ t, node: k })
    }
    splits.sort((x, y) => x.t - y.t)
    let prev = ia
    for (const next of [...splits.map((sp) => sp.node), ib]) {
      if (next !== prev) {
        edges.push({ a: prev, b: next, length: dist(nodes[prev], nodes[next]), road: road.id })
      }
      prev = next
    }
  })
  const adjacency: number[][] = nodes.map(() => [])
  edges.forEach((e, i) => {
    adjacency[e.a].push(i)
    adjacency[e.b].push(i)
  })

  // Hubs: the hearth and every finished warehouse.
  const hubs: Hub[] = []
  for (const b of Object.values(s.buildings)) {
    const def = BUILDINGS[b.defId]
    if (!isRoadHub(def) || (!b.built && def?.category !== 'hearth')) continue
    hubs.push({ id: b.id, pos: b.pos, reach: footprintRadius(b.defId) + ROAD_REACH })
  }

  // Multi-source Dijkstra from wherever a hub touches the road.
  const hubDistance = nodes.map(() => Infinity)
  const hubOf = nodes.map(() => -1)
  const footholds: HubFoothold[] = []
  const seed = (node: number, d: number, hub: number) => {
    if (d < hubDistance[node]) {
      hubDistance[node] = d
      hubOf[node] = hub
    }
  }
  hubs.forEach((hub, h) => {
    edges.forEach((e, i) => {
      const a = nodes[e.a]
      const b = nodes[e.b]
      const hop = distToSegment(hub.pos, a, b)
      if (hop > hub.reach) return
      const t = closestT(hub.pos, a, b)
      footholds.push({ edge: i, t, hop, hub: h })
      seed(e.a, hop + t * e.length, h)
      seed(e.b, hop + (1 - t) * e.length, h)
    })
  })
  const done = nodes.map(() => false)
  for (;;) {
    let u = -1
    for (let i = 0; i < nodes.length; i++) {
      if (!done[i] && hubDistance[i] < Infinity && (u < 0 || hubDistance[i] < hubDistance[u])) u = i
    }
    if (u < 0) break
    done[u] = true
    for (const ei of adjacency[u]) {
      const e = edges[ei]
      const v = e.a === u ? e.b : e.a
      seed(v, hubDistance[u] + e.length, hubOf[u])
    }
  }

  const network: RoadNetwork = {
    nodes,
    edges,
    adjacency,
    hubDistance,
    hubOf,
    hubs,
    footholds,
    links: new Map(),
  }
  for (const b of Object.values(s.buildings)) {
    if (hubs.some((h) => h.id === b.id)) {
      network.links.set(b.id, { ...NO_LINK, touches: true, connected: true, hubId: b.id, roadDistance: 0, straight: 0 })
      continue
    }
    network.links.set(b.id, linkAt(network, b.pos, footprintRadius(b.defId) + ROAD_REACH))
  }
  return network
}

/**
 * How a spot of footprint reach `reach` at `pos` sits on the network: whether
 * a road passes by, whether it leads to a hub, and the bonus that earns.
 */
export function linkAt(net: RoadNetwork, pos: Vec2, reach: number): RoadLink {
  let touches = false
  let best = Infinity
  let hub = -1
  const consider = (d: number, h: number) => {
    if (d < best) {
      best = d
      hub = h
    }
  }
  net.edges.forEach((e, i) => {
    const a = net.nodes[e.a]
    const b = net.nodes[e.b]
    const hop = distToSegment(pos, a, b)
    if (hop > reach) return
    touches = true
    const t = closestT(pos, a, b)
    consider(hop + t * e.length + net.hubDistance[e.a], net.hubOf[e.a])
    consider(hop + (1 - t) * e.length + net.hubDistance[e.b], net.hubOf[e.b])
    // A hub on the same stretch, between the spot and both ends.
    for (const f of net.footholds) {
      if (f.edge === i) consider(hop + Math.abs(t - f.t) * e.length + f.hop, f.hub)
    }
  })
  if (!touches) return NO_LINK
  if (hub < 0 || best === Infinity) return { ...NO_LINK, touches: true }
  const target = net.hubs[hub]
  const straight = dist(pos, target.pos)
  const directness = best <= 1e-6 ? 1 : Math.min(1, straight / best)
  return {
    touches: true,
    connected: true,
    hubId: target.id,
    roadDistance: best,
    straight,
    percent: Math.round(ROAD_WORK_BONUS * directness),
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  net: RoadNetwork
  roadCounter: number
  roads: number
  built: number
}

/**
 * Derived, never serialised. Keyed by the run's buildings record (shared by the
 * season-shifted copies the forecasts make), so a loaded save (a new
 * object) simply rebuilds on first use. Invalidated explicitly when buildings
 * are placed or torn down, and implicitly when roads or the count of finished
 * buildings change — three integer compares per lookup.
 */
const cache = new WeakMap<RunState['buildings'], CacheEntry>()

export function invalidateRoadNetwork(s: RunState): void {
  cache.delete(s.buildings)
}

/** The run's road graph, rebuilt only when roads or buildings changed. */
export function roadNetwork(s: RunState): RoadNetwork {
  const entry = cache.get(s.buildings)
  const roadCounter = s.roadCounter ?? 0
  const roads = s.roads?.length ?? 0
  const built = s.stats.buildingsBuilt
  if (entry && entry.roadCounter === roadCounter && entry.roads === roads && entry.built === built) {
    return entry.net
  }
  const net = buildRoadNetwork(s)
  cache.set(s.buildings, { net, roadCounter, roads, built })
  return net
}

/** A building's link to the road network (none for buildings off it). */
export function roadLinkOf(s: RunState, b: BuildingInstance): RoadLink {
  if (!s.roads || s.roads.length === 0) return NO_LINK
  return roadNetwork(s).links.get(b.id) ?? NO_LINK
}

/** Work-speed bonus percent a building gets from its road (0 off the road). */
export function roadBonusPercent(s: RunState, b: BuildingInstance): number {
  if (!s.roads || s.roads.length === 0) return 0
  if (!benefitsFromRoad(BUILDINGS[b.defId])) return 0
  return roadLinkOf(s, b).percent
}

/** Multiplier on a building's work rate. Exactly 1 for a run without roads. */
export function roadMultiplier(s: RunState, b: BuildingInstance): number {
  return 1 + roadBonusPercent(s, b) / 100
}

/** What a building of `defId` at `pos` would get from the roads as they stand. */
export function roadLinkPreview(s: RunState, defId: string, pos: Vec2): RoadLink | null {
  if (!s.roads || s.roads.length === 0) return null
  if (!benefitsFromRoad(BUILDINGS[defId])) return null
  return linkAt(roadNetwork(s), pos, footprintRadius(defId) + ROAD_REACH)
}

// ---------------------------------------------------------------------------
// Laying and lifting roads
// ---------------------------------------------------------------------------

/** Wood for a stretch: `ROAD_WOOD_PER_UNIT` a pace, rounded, at least 1. */
export function roadCost(length: number): ResourceBag {
  return { wood: Math.max(1, Math.round(length * ROAD_WOOD_PER_UNIT)) }
}

/** Why a road may not start (or bend) at `p`, or null if it may. */
export function canStartRoad(s: RunState, p: Vec2): string | null {
  if (!insideWorld(s.world, p)) return 'Beyond the forest edge.'
  if (!gladeAt(s.glades, p)?.cleared) return 'A road can only run over cleared ground.'
  for (const o of s.obstacles) {
    if (dist(p, o.pos) < o.radius + ROAD_HALF_WIDTH) return 'The ground here will not take a road.'
  }
  for (const d of Object.values(s.deposits)) {
    if (dist(p, d.pos) < d.radius + ROAD_HALF_WIDTH) return 'A deposit is in the way — route around it.'
  }
  return null
}

/** What stops a road at each kind of obstacle. */
const ROAD_BLOCKED: Record<Obstacle['kind'], string> = {
  mire: 'A mire swallows the way.',
  crag: 'A crag blocks the way.',
  water: 'The river runs here — cross at a ford.',
  cliff: 'A cliff edge — cross at a pass.',
}

/** Why the stretch a→b may not be laid, or null if it may. */
export function canPlaceRoad(s: RunState, a: Vec2, b: Vec2): string | null {
  const length = dist(a, b)
  if (length < ROAD_MIN_LENGTH) return 'Too short for a road.'
  if (length > ROAD_MAX_LENGTH) return `Too long — bend it within ${ROAD_MAX_LENGTH} paces.`
  if (!insideWorld(s.world, a) || !insideWorld(s.world, b)) return 'Beyond the forest edge.'
  for (const o of s.obstacles) {
    if (distToSegment(o.pos, a, b) < o.radius + ROAD_HALF_WIDTH) {
      return ROAD_BLOCKED[o.kind]
    }
  }
  for (const d of Object.values(s.deposits)) {
    if (distToSegment(d.pos, a, b) < d.radius + ROAD_HALF_WIDTH) {
      return 'A deposit is in the way — route around it.'
    }
  }
  const same = (p: Vec2, q: Vec2) => dist(p, q) < NODE_EPS
  if ((s.roads ?? []).some((r) => (same(r.a, a) && same(r.b, b)) || (same(r.a, b) && same(r.b, a)))) {
    return 'There is already a road here.'
  }
  // Cleared ground all the way, sampled every quarter pace. Consecutive
  // samples nearly always share a glade, so that one is tested first.
  const steps = Math.ceil(length / 0.25)
  let glade: Glade | undefined
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    if (!glade || !pointInPolygon(p, glade.polygon)) glade = gladeAt(s.glades, p)
    if (!glade?.cleared) return 'A road can only run over cleared ground.'
  }
  if (!canAfford(s.stock, roadCost(length))) return 'Not enough wood.'
  return null
}

/** Lays one stretch of road from `a` to `b` (exact points; snap first in the UI). */
export function placeRoad(s: RunState, a: Vec2, b: Vec2): string | null {
  const error = canPlaceRoad(s, a, b)
  if (error) return error
  spend(s.stock, roadCost(dist(a, b)))
  s.roads ??= []
  const counter = s.roadCounter ?? s.roads.length
  s.roads.push({ id: `road${counter}`, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } })
  s.roadCounter = counter + 1
  invalidateRoadNetwork(s)
  return null
}

/** The stretch of road under `pos`, if any. */
export function roadAt(s: RunState, pos: Vec2, tolerance = 0.35): RoadSegment | null {
  let best: RoadSegment | null = null
  let bestDistance = tolerance
  for (const r of s.roads ?? []) {
    const d = distToSegment(pos, r.a, r.b)
    if (d <= bestDistance) {
      best = r
      bestDistance = d
    }
  }
  return best
}

/** Roads are laid in an instant, so lifting one hands back all its wood. */
export function removeRoad(s: RunState, roadId: string): string | null {
  const index = (s.roads ?? []).findIndex((r) => r.id === roadId)
  if (index < 0) return 'No road there.'
  const [road] = s.roads!.splice(index, 1)
  grant(s.stock, roadCost(roadLength(road)), s.storageCap, storageUsed(s))
  invalidateRoadNetwork(s)
  return null
}

/** Where a click for the road tool lands, and what it latched onto. */
export interface RoadSnap {
  pos: Vec2
  kind: 'node' | 'building' | 'road' | 'free'
  buildingId?: string
}

/**
 * Snaps a click so roads actually join: onto a road end, else into a building
 * (its centre — the road runs to its door), else onto the side of a road
 * (making a junction), else where it fell.
 */
export function snapRoadPoint(s: RunState, pos: Vec2): RoadSnap {
  let best: Vec2 | null = null
  let bestDistance = ROAD_SNAP
  for (const r of s.roads ?? []) {
    for (const p of [r.a, r.b]) {
      const d = dist(p, pos)
      if (d <= bestDistance) {
        best = p
        bestDistance = d
      }
    }
  }
  if (best) return { pos: { x: best.x, y: best.y }, kind: 'node' }
  for (const b of Object.values(s.buildings)) {
    if (dist(b.pos, pos) <= footprintRadius(b.defId) + 0.15) {
      return { pos: { x: b.pos.x, y: b.pos.y }, kind: 'building', buildingId: b.id }
    }
  }
  const road = roadAt(s, pos, ROAD_SNAP * 0.8)
  if (road) {
    const t = closestT(pos, road.a, road.b)
    return {
      pos: { x: road.a.x + (road.b.x - road.a.x) * t, y: road.a.y + (road.b.y - road.a.y) * t },
      kind: 'road',
    }
  }
  return { pos: { x: pos.x, y: pos.y }, kind: 'free' }
}

// ---------------------------------------------------------------------------
// The road tool's hint
// ---------------------------------------------------------------------------

export interface RoadPreview {
  ok: boolean
  reason: string | null
  /** Start of the stretch (the chain's last point), if one is anchored. */
  from: Vec2 | null
  /** Snapped point under the cursor. */
  to: Vec2
  /** Erase mode: the stretch that would be lifted. */
  removeId: string | null
  /** Ready-to-show hint fragments. */
  parts: string[]
}

/** Workplace ids and bonuses that a set of roads newly connects or improves. */
function gains(s: RunState, before: RoadNetwork, after: RoadNetwork): { name: string; percent: number }[] {
  const out: { name: string; percent: number }[] = []
  for (const b of Object.values(s.buildings)) {
    const def = BUILDINGS[b.defId]
    if (!b.built || !benefitsFromRoad(def)) continue
    const was = before.links.get(b.id)?.percent ?? 0
    const now = after.links.get(b.id)?.percent ?? 0
    if (now > was) out.push({ name: def!.name, percent: now })
  }
  return out
}

/** Everything the road tool's ghost says about laying (or lifting) here. */
export function describeRoadTool(
  s: RunState,
  anchor: Vec2 | null,
  pos: Vec2,
  erase = false,
): RoadPreview {
  const wood = RESOURCES.wood.icon
  if (erase) {
    const road = roadAt(s, pos)
    if (!road) return { ok: false, reason: 'No road here.', from: null, to: pos, removeId: null, parts: [] }
    const back = roadCost(roadLength(road)).wood ?? 0
    return {
      ok: true,
      reason: null,
      from: null,
      to: pos,
      removeId: road.id,
      parts: [`Lift this road — ${wood} ${back} back`],
    }
  }
  const snap = snapRoadPoint(s, pos)
  const at = snap.buildingId ? BUILDINGS[s.buildings[snap.buildingId]?.defId ?? '']?.name : null
  if (!anchor) {
    const reason = canStartRoad(s, snap.pos)
    return {
      ok: reason === null,
      reason,
      from: null,
      to: snap.pos,
      removeId: null,
      parts: [at ? `Start the road at the ${at}` : 'Start a road here'],
    }
  }
  const reason = canPlaceRoad(s, anchor, snap.pos)
  const length = dist(anchor, snap.pos)
  const parts = [`Road ${length.toFixed(1)} · ${wood} ${roadCost(length).wood}`]
  if (reason === null) {
    const extra: RoadSegment = { id: 'preview', a: anchor, b: snap.pos }
    const after = buildRoadNetwork(s, [...(s.roads ?? []), extra])
    const better = gains(s, s.roads?.length ? roadNetwork(s) : buildRoadNetwork(s, []), after)
    if (better.length === 1) parts.push(`🛤️ Joins the ${better[0].name}: +${better[0].percent}% work`)
    else if (better.length > 1) {
      parts.push(`🛤️ Joins ${better.length} workplaces: ${better.map((g) => `+${g.percent}%`).join(', ')}`)
    }
    if (at && better.length === 0) parts.push(`to the ${at}`)
  }
  return { ok: reason === null, reason, from: anchor, to: snap.pos, removeId: null, parts }
}

/** "🛤️ On the road: +12% work (road 6.1 vs 5.0 direct)" — Inspector and ghost. */
export function describeRoadLink(link: RoadLink | null): string | null {
  if (!link) return null
  if (link.connected) {
    const winding =
      link.percent < ROAD_WORK_BONUS
        ? ` (road ${link.roadDistance.toFixed(1)} vs ${link.straight.toFixed(1)} direct)`
        : ''
    return `🛤️ On the road: +${link.percent}% work${winding}`
  }
  if (link.touches) return `🛤️ This road leads nowhere — join it to the hearth or a warehouse`
  return `🛤️ Off the road — a road to the hearth adds up to +${ROAD_WORK_BONUS}% work`
}
