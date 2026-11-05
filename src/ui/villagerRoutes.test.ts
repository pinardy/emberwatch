import { describe, expect, it } from 'vitest'
import { createRun } from '../game/engine/createRun'
import { resolveGladeEvent, takeChoice } from '../game/engine/events'
import { TICK_SECONDS } from '../game/engine/balance'
import { buildRoadNetwork, placeRoad } from '../game/engine/roads'
import { tick } from '../game/engine/tick'
import type { BuildingInstance, RunState, Vec2 } from '../game/types'
import {
  WALK_SPEED,
  advanceViewClock,
  assignHomes,
  deriveVillagerRoutes,
  poseAt,
  skirtBuildings,
  walkPath,
  type Pose,
  type VillagerRoute,
} from './villagerRoutes'

/**
 * The walking villagers are derived, not simulated: a pure function of the
 * run (assignments, buildings, roads) and the clock. These tests pin that
 * down — the routes, the road-following, the playback, and that deriving
 * them leaves the run untouched.
 */

function openRun(): RunState {
  const run = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'] })
  let guard = 0
  while (run.pendingChoices.length > 0 && guard++ < 20) {
    const choice = run.pendingChoices[0]
    if (choice.kind === 'gladeEvent') resolveGladeEvent(run, choice.options.length - 1)
    else takeChoice(run, choice.options[0])
  }
  for (const glade of Object.values(run.glades)) glade.cleared = true
  run.deposits = {}
  run.obstacles = []
  run.stock.wood = 500
  return run
}

let serial = 0
function addBuilding(run: RunState, defId: string, pos: Vec2, built = true): BuildingInstance {
  const b: BuildingInstance = {
    id: `v-${defId}-${serial++}`,
    defId,
    pos,
    gladeId: 'glade0',
    built,
    buildProgress: 0,
    workers: [],
    activeRecipeId: '',
    recipeProgress: 0,
    paused: false,
    depositsInRange: {},
    tier: 0,
  }
  run.buildings[b.id] = b
  if (built) run.stats.buildingsBuilt++
  return b
}

function assign(run: RunState, villagerId: string, building: BuildingInstance): void {
  run.villagers[villagerId].assignment = building.id
  building.workers.push(villagerId)
}

/** Samples a route at `n` evenly spaced times across one period. */
function sample(route: VillagerRoute, n = 400): Pose[] {
  const out: Pose[] = []
  for (let i = 0; i <= n; i++) {
    out.push({ ...poseAt(route, (i / n) * route.period - route.phase, { x: 0, y: 0, moving: false }) })
  }
  return out
}

const near = (a: Vec2, b: Vec2, d: number) => Math.hypot(a.x - b.x, a.y - b.y) <= d

describe('villager routes', () => {
  it('loop a worker home → work → hearth and back, standing at each stop', () => {
    const run = openRun()
    const villager = Object.values(run.villagers)[0]
    const mill = addBuilding(run, 'lumberMill', { x: 7, y: 2 })
    assign(run, villager.id, mill)
    const route = deriveVillagerRoutes(run).find((r) => r.id === villager.id)!
    expect(route.species).toBe(villager.species)
    // Closed loop, times rising from 0 to the period.
    expect(route.ts[0]).toBe(0)
    expect(route.ts[route.ts.length - 1]).toBeCloseTo(route.period)
    for (let i = 1; i < route.ts.length; i++) expect(route.ts[i]).toBeGreaterThanOrEqual(route.ts[i - 1])
    expect(route.xs[0]).toBe(route.xs[route.xs.length - 1])
    // It visits the mill's doorstep (and rests there under reduced motion).
    expect(near(route.rest, mill.pos, 1.2)).toBe(true)
    const poses = sample(route)
    expect(poses.some((p) => near(p, mill.pos, 1.2))).toBe(true)
    expect(poses.some((p) => near(p, { x: 0, y: 0 }, 3))).toBe(true)
    // Walking speed is honoured: no step jumps further than it allows.
    const dt = route.period / 400
    for (let i = 1; i < poses.length; i++) {
      expect(Math.hypot(poses[i].x - poses[i - 1].x, poses[i].y - poses[i - 1].y)).toBeLessThanOrEqual(
        WALK_SPEED * dt + 1e-3,
      )
    }
    expect(poses.some((p) => p.moving)).toBe(true)
    expect(poses.some((p) => !p.moving)).toBe(true)
  })

  it('send clearing crews to their glade and idle builders to open sites', () => {
    const run = openRun()
    const [crew, idler] = Object.values(run.villagers)
    for (const v of Object.values(run.villagers)) v.assignment = null
    const glade = Object.values(run.glades).find((g) => g.id !== 'glade0')!
    crew.assignment = `clearing:${glade.id}`
    const site = addBuilding(run, 'shelter', { x: -5, y: 3 }, false)
    const routes = deriveVillagerRoutes(run)
    expect(near(routes.find((r) => r.id === crew.id)!.rest, glade.center, 1)).toBe(true)
    expect(near(routes.find((r) => r.id === idler.id)!.rest, site.pos, 1.2)).toBe(true)
  })

  it('house villagers in finished homes first, the hearth last', () => {
    const run = openRun()
    const shelter = addBuilding(run, 'shelter', { x: 3, y: 4 })
    addBuilding(run, 'shelter', { x: -3, y: 4 }, false) // a site sleeps nobody
    const homes = assignHomes(run)
    const ids = Object.keys(run.villagers)
    expect(homes.get(ids[0])?.id).toBe(shelter.id)
    expect(homes.get(ids[5])?.defId).toBe('ancientHearth')
  })

  it('follow the road when one runs that way, and walk straight otherwise', () => {
    const run = openRun()
    const villager = Object.values(run.villagers)[0]
    const mill = addBuilding(run, 'lumberMill', { x: 8, y: 0 })
    assign(run, villager.id, mill)
    // A dog-leg road: a straight walker would never pass (4, 3).
    const bend = { x: 4, y: 3 }
    const straight = deriveVillagerRoutes(run).find((r) => r.id === villager.id)!
    expect(straight.onRoad).toBe(false)
    expect(sample(straight).some((p) => near(p, bend, 0.3))).toBe(false)

    placeRoad(run, mill.pos, bend)
    placeRoad(run, bend, { x: 0, y: 0 })
    const net = buildRoadNetwork(run)
    const path = walkPath(net, { x: 8.9, y: 0 }, { x: 0.2, y: 1.2 })
    expect(path.onRoad).toBe(true)
    expect(path.points.some((p) => near(p, bend, 1e-6))).toBe(true)
    const routed = deriveVillagerRoutes(run, net).find((r) => r.id === villager.id)!
    expect(routed.onRoad).toBe(true)
    expect(sample(routed).some((p) => near(p, bend, 0.3))).toBe(true)
  })

  it('walk round a building a road passes through, not across it', () => {
    const hearth = { pos: { x: 0, y: 0 }, r: 1 }
    // In from the east, out to the north, bending at the hearth's centre.
    const path = skirtBuildings({ x: 5, y: 0 }, [{ x: 0, y: 0 }, { x: 0, y: -5 }], [hearth])
    expect(path[path.length - 1]).toEqual({ x: 0, y: -5 })
    for (const p of path.slice(0, -1)) expect(Math.hypot(p.x, p.y)).toBeCloseTo(1.15)
    expect(path.length).toBeGreaterThan(3)
  })

  it('ignore a road that would be a long detour', () => {
    const run = openRun()
    placeRoad(run, { x: 1, y: 0 }, { x: 1, y: 9 })
    placeRoad(run, { x: 1, y: 9 }, { x: 3, y: 9 })
    placeRoad(run, { x: 3, y: 9 }, { x: 3, y: 0 })
    const path = walkPath(buildRoadNetwork(run), { x: 1, y: -0.5 }, { x: 3, y: -0.5 })
    expect(path.onRoad).toBe(false)
    expect(path.points).toEqual([{ x: 3, y: -0.5 }])
  })

  it('are a pure function of the run: same routes, run untouched, no per-tick state', () => {
    const run = openRun()
    const mill = addBuilding(run, 'lumberMill', { x: 6, y: 0 })
    assign(run, Object.keys(run.villagers)[0], mill)
    placeRoad(run, mill.pos, { x: 0, y: 0 })
    const before = JSON.stringify(run)
    const a = deriveVillagerRoutes(run)
    const b = deriveVillagerRoutes(run)
    expect(JSON.stringify(run)).toBe(before)
    expect(a.map((r) => [r.id, Array.from(r.xs), Array.from(r.ts), r.phase])).toEqual(
      b.map((r) => [r.id, Array.from(r.xs), Array.from(r.ts), r.phase]),
    )
    // Ticking changes the clock, not the routes.
    for (let i = 0; i < 40; i++) tick(run, TICK_SECONDS)
    const c = deriveVillagerRoutes(run)
    expect(c.map((r) => Array.from(r.xs))).toEqual(a.map((r) => Array.from(r.xs)))
  })

  it('play back without allocating, cheaply enough for every villager every frame', () => {
    const run = openRun()
    for (let i = 0; i < 40; i++) {
      const id = `extra${i}`
      run.villagers[id] = { id, species: 'human', name: id, assignment: null }
    }
    const routes = deriveVillagerRoutes(run)
    const pose: Pose = { x: 0, y: 0, moving: false }
    expect(poseAt(routes[0], 3, pose)).toBe(pose)
    const start = performance.now()
    for (let frame = 0; frame < 1000; frame++) {
      for (const route of routes) poseAt(route, frame / 60, pose)
    }
    const perFrame = (performance.now() - start) / 1000
    expect(routes.length).toBeGreaterThanOrEqual(46)
    expect(perFrame).toBeLessThan(0.5)
  })
})

describe('view clock', () => {
  it('follows the game speed between sim ticks and snaps back when far off', () => {
    expect(advanceViewClock(10, 1 / 60, 1, 10)).toBeCloseTo(10 + 1 / 60)
    expect(advanceViewClock(10, 1 / 60, 3, 10)).toBeCloseTo(10.05)
    // Paused: stands still.
    expect(advanceViewClock(10, 1 / 60, 0, 10)).toBe(10)
    // Never runs more than a quarter second ahead of the sim.
    expect(advanceViewClock(10.24, 0.1, 1, 10)).toBe(10.25)
    // A load or a long pause: jump to the sim.
    expect(advanceViewClock(2, 1 / 60, 1, 50)).toBe(50)
  })
})
