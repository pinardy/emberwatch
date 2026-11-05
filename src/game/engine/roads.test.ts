import { describe, expect, it } from 'vitest'
import { loadRun, saveRun } from '../persistence'
import type { BuildingInstance, RunState, Vec2 } from '../types'
import { placeBuilding } from './actions'
import { ROAD_WORK_BONUS, TICK_SECONDS } from './balance'
import { createRun } from './createRun'
import { resolveGladeEvent, takeChoice } from './events'
import { computeModifiers } from './modifiers'
import { describePlacement } from './placement'
import { workRate } from './production'
import {
  buildRoadNetwork,
  canPlaceRoad,
  canStartRoad,
  describeRoadTool,
  placeRoad,
  removeRoad,
  roadBonusPercent,
  roadCost,
  roadLinkOf,
  roadMultiplier,
  roadNetwork,
  roadStats,
  snapRoadPoint,
} from './roads'
import { tick } from './tick'

/**
 * Roads: the derived connectivity graph and the work bonus it grants, the
 * rules for laying a road, the cache that keeps per-tick cost flat, and saves
 * from before roads existed.
 */

function drain(run: RunState): void {
  let guard = 0
  while (run.pendingChoices.length > 0 && guard++ < 20) {
    const choice = run.pendingChoices[0]
    if (choice.kind === 'gladeEvent') resolveGladeEvent(run, choice.options.length - 1)
    else takeChoice(run, choice.options[0])
  }
}

/** A run on open ground: every glade cleared, nothing in the way. */
function openRun(): RunState {
  const run = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'] })
  drain(run)
  for (const glade of Object.values(run.glades)) glade.cleared = true
  run.deposits = {}
  run.obstacles = []
  run.stock.wood = 200
  run.storageCap = 1000
  return run
}

let serial = 0
function addBuilding(run: RunState, defId: string, pos: Vec2, patch: Partial<BuildingInstance> = {}): BuildingInstance {
  const b: BuildingInstance = {
    id: `t-${defId}-${serial++}`,
    defId,
    pos,
    gladeId: 'glade0',
    built: true,
    buildProgress: 0,
    workers: [],
    activeRecipeId: '',
    recipeProgress: 0,
    paused: false,
    depositsInRange: {},
    tier: 0,
    ...patch,
  }
  run.buildings[b.id] = b
  // Fixtures add buildings behind the actions' backs; count them as built so
  // the cached graph notices, as a finished construction would.
  if (b.built) run.stats.buildingsBuilt++
  return b
}

function staff(run: RunState, b: BuildingInstance, n = 1): void {
  for (const v of Object.values(run.villagers).slice(0, n)) {
    v.assignment = b.id
    b.workers.push(v.id)
  }
}

const HEARTH: Vec2 = { x: 0, y: 0 }

describe('road connectivity', () => {
  it('joins a workplace to the hearth and grants the full bonus for a straight road', () => {
    const run = openRun()
    const mill = addBuilding(run, 'lumberMill', { x: 6, y: 0 })
    expect(roadLinkOf(run, mill).connected).toBe(false)
    expect(placeRoad(run, mill.pos, HEARTH)).toBeNull()
    const link = roadLinkOf(run, mill)
    expect(link.connected).toBe(true)
    expect(link.roadDistance).toBeCloseTo(6)
    expect(link.straight).toBeCloseTo(6)
    expect(link.percent).toBe(ROAD_WORK_BONUS)
    expect(roadMultiplier(run, mill)).toBeCloseTo(1 + ROAD_WORK_BONUS / 100)
  })

  it('scales the bonus by straight-line over road distance for a winding road', () => {
    const run = openRun()
    const mill = addBuilding(run, 'lumberMill', { x: 6, y: 0 })
    // Out and back round three sides of a 6×4 box: 4 + 6 + 4 = 14 by road.
    placeRoad(run, mill.pos, { x: 6, y: 4 })
    placeRoad(run, { x: 6, y: 4 }, { x: 0, y: 4 })
    placeRoad(run, { x: 0, y: 4 }, HEARTH)
    const link = roadLinkOf(run, mill)
    expect(link.connected).toBe(true)
    expect(link.roadDistance).toBeCloseTo(14)
    expect(link.percent).toBe(Math.round((ROAD_WORK_BONUS * 6) / 14))
    // A shortcut takes the better way.
    placeRoad(run, mill.pos, HEARTH)
    expect(roadLinkOf(run, mill).percent).toBe(ROAD_WORK_BONUS)
  })

  it('a road that leads nowhere touches but does not connect', () => {
    const run = openRun()
    const mill = addBuilding(run, 'lumberMill', { x: 6, y: 0 })
    placeRoad(run, mill.pos, { x: 6, y: 5 })
    const link = roadLinkOf(run, mill)
    expect(link.touches).toBe(true)
    expect(link.connected).toBe(false)
    expect(roadBonusPercent(run, mill)).toBe(0)
  })

  it('joins roads where one ends on the side of another (a junction)', () => {
    const run = openRun()
    const mill = addBuilding(run, 'lumberMill', { x: 3, y: 5 })
    // A road east from the hearth, and a spur from the mill down onto its middle.
    placeRoad(run, HEARTH, { x: 6, y: 0 })
    const junction = snapRoadPoint(run, { x: 3.1, y: 0.2 })
    expect(junction.kind).toBe('road')
    expect(junction.pos.y).toBeCloseTo(0)
    placeRoad(run, mill.pos, junction.pos)
    const link = roadLinkOf(run, mill)
    expect(link.connected).toBe(true)
    expect(link.roadDistance).toBeCloseTo(5 + junction.pos.x, 1)
  })

  it('counts a finished warehouse as a hub, but not a site', () => {
    const run = openRun()
    const mill = addBuilding(run, 'lumberMill', { x: 12, y: 0 })
    const store = addBuilding(run, 'warehouse', { x: 9, y: 0 }, { built: false })
    placeRoad(run, mill.pos, store.pos)
    expect(roadLinkOf(run, mill).connected).toBe(false)
    store.built = true
    run.stats.buildingsBuilt++ // what finishing construction does
    const link = roadLinkOf(run, mill)
    expect(link.connected).toBe(true)
    expect(link.hubId).toBe(store.id)
    expect(link.percent).toBe(ROAD_WORK_BONUS)
  })

  it('speeds up producers only — not services, homes or hubs', () => {
    const run = openRun()
    const tavern = addBuilding(run, 'tavern', { x: 4, y: 0 })
    const home = addBuilding(run, 'shelter', { x: -4, y: 0 })
    placeRoad(run, tavern.pos, HEARTH)
    placeRoad(run, home.pos, HEARTH)
    expect(roadLinkOf(run, tavern).connected).toBe(true)
    expect(roadBonusPercent(run, tavern)).toBe(0)
    expect(roadBonusPercent(run, home)).toBe(0)
  })

  it('feeds the bonus into the work rate the tick uses', () => {
    const run = openRun()
    const mill = addBuilding(run, 'lumberMill', { x: 6, y: 0 })
    staff(run, mill, 2)
    const mods = computeModifiers(run)
    const plain = workRate(run, mill, mods)
    placeRoad(run, mill.pos, HEARTH)
    expect(workRate(run, mill, mods)).toBeCloseTo(plain * (1 + ROAD_WORK_BONUS / 100))
  })
})

describe('road network cache', () => {
  it('is built once and reused across ticks, and rebuilt when roads or buildings change', () => {
    const run = openRun()
    const mill = addBuilding(run, 'lumberMill', { x: 6, y: 0 })
    staff(run, mill, 2)
    placeRoad(run, mill.pos, HEARTH)
    const net = roadNetwork(run)
    const built = roadStats.networksBuilt
    for (let i = 0; i < 200; i++) tick(run, TICK_SECONDS)
    expect(run.clock).toBeGreaterThan(20)
    expect(roadNetwork(run)).toBe(net)
    expect(roadStats.networksBuilt).toBe(built)

    placeRoad(run, HEARTH, { x: 0, y: 5 })
    expect(roadNetwork(run)).not.toBe(net)
    const rebuilt = roadStats.networksBuilt
    expect(placeBuilding(run, 'shelter', { x: -5, y: -5 })).toBeNull()
    roadNetwork(run)
    expect(roadStats.networksBuilt).toBe(rebuilt + 1)
  })

  it('costs nothing at all for a run without roads', () => {
    const run = openRun()
    const built = roadStats.networksBuilt
    const mill = addBuilding(run, 'lumberMill', { x: 6, y: 0 })
    expect(roadMultiplier(run, mill)).toBe(1)
    for (let i = 0; i < 40; i++) tick(run, TICK_SECONDS)
    expect(roadStats.networksBuilt).toBe(built)
  })

  it('stays well under a millisecond per tick-sized lookup across a busy settlement', () => {
    const run = openRun()
    run.stock.wood = 1000
    const workplaces: BuildingInstance[] = []
    for (let i = 0; i < 30; i++) {
      const angle = (i / 30) * Math.PI * 2
      const b = addBuilding(run, 'lumberMill', { x: Math.cos(angle) * 8, y: Math.sin(angle) * 8 })
      placeRoad(run, b.pos, HEARTH)
      workplaces.push(b)
    }
    roadNetwork(run)
    const start = performance.now()
    let sum = 0
    for (let n = 0; n < 1000; n++) for (const b of workplaces) sum += roadMultiplier(run, b)
    const perTick = (performance.now() - start) / 1000
    expect(sum).toBeCloseTo(30_000 * (1 + ROAD_WORK_BONUS / 100), 0)
    expect(perTick).toBeLessThan(0.5)
  })
})

describe('laying roads', () => {
  it('charges wood by length and hands it all back when lifted', () => {
    const run = openRun()
    run.stock.wood = 20
    expect(roadCost(4.2)).toEqual({ wood: 5 })
    expect(placeRoad(run, { x: 1, y: 0 }, { x: 5.2, y: 0 })).toBeNull()
    expect(run.stock.wood).toBe(15)
    expect(run.roads).toHaveLength(1)
    expect(removeRoad(run, run.roads![0].id)).toBeNull()
    expect(run.stock.wood).toBe(20)
    expect(run.roads).toHaveLength(0)
  })

  it('refuses uncleared ground, obstacles, deposits and the absurd', () => {
    const run = openRun()
    const glade = run.glades.glade0
    run.obstacles.push({ id: 'crag', kind: 'crag', pos: { x: 3, y: 3 }, radius: 0.6, gladeId: glade.id })
    run.deposits.stone = {
      id: 'stone',
      kind: 'stoneVein',
      pos: { x: -3, y: 3 },
      radius: 0.6,
      amount: 10,
      gladeId: glade.id,
    }
    expect(canPlaceRoad(run, { x: 3, y: 1 }, { x: 3, y: 5 })).toMatch(/crag/)
    expect(canPlaceRoad(run, { x: -3, y: 1 }, { x: -3, y: 5 })).toMatch(/deposit/)
    expect(canStartRoad(run, { x: 3, y: 3 })).not.toBeNull()
    expect(canPlaceRoad(run, { x: 1, y: 1 }, { x: 1.1, y: 1 })).toMatch(/short/)
    expect(canPlaceRoad(run, { x: 0, y: 0 }, { x: 11, y: 0 })).toMatch(/long/)
    expect(placeRoad(run, { x: 1, y: -1 }, { x: 4, y: -1 })).toBeNull()
    expect(canPlaceRoad(run, { x: 4, y: -1 }, { x: 1, y: -1 })).toMatch(/already/)
    run.stock.wood = 1
    expect(canPlaceRoad(run, { x: 1, y: -2 }, { x: 4, y: -2 })).toMatch(/wood/)
    run.stock.wood = 50
    glade.cleared = false
    expect(canPlaceRoad(run, { x: 1, y: -2 }, { x: 2, y: -2 })).toMatch(/cleared/)
  })

  it('snaps clicks onto road ends and into buildings so roads join', () => {
    const run = openRun()
    const mill = addBuilding(run, 'lumberMill', { x: 6, y: 0 })
    expect(snapRoadPoint(run, { x: 6.4, y: 0.3 })).toMatchObject({ kind: 'building', pos: mill.pos })
    placeRoad(run, { x: 0, y: 3 }, { x: 4, y: 3 })
    expect(snapRoadPoint(run, { x: 4.3, y: 3.2 })).toMatchObject({ kind: 'node', pos: { x: 4, y: 3 } })
    expect(snapRoadPoint(run, { x: -5, y: -5 }).kind).toBe('free')
  })

  it('says in the ghost what a stretch would cost and join, and in the placement hint what a spot earns', () => {
    const run = openRun()
    const mill = addBuilding(run, 'lumberMill', { x: 6, y: 0 })
    const start = describeRoadTool(run, null, { x: 6.2, y: 0.1 })
    expect(start.ok).toBe(true)
    expect(start.parts.join(' ')).toMatch(/Lumber Mill/)
    const stretch = describeRoadTool(run, mill.pos, { x: 0.2, y: 0.1 })
    expect(stretch.ok).toBe(true)
    expect(stretch.parts.join(' ')).toMatch(/Joins the Lumber Mill: \+15% work/)

    // No roads yet: the placement hint stays quiet about them.
    expect(describePlacement(run, 'lumberMill', { x: -6, y: 0 }).road).toBeNull()
    placeRoad(run, mill.pos, HEARTH)
    placeRoad(run, HEARTH, { x: -6, y: 0 })
    const on = describePlacement(run, 'lumberMill', { x: -6, y: 0 })
    expect(on.road?.percent).toBe(ROAD_WORK_BONUS)
    expect(on.parts.join(' · ')).toMatch(/On the road: \+15% work/)
    const off = describePlacement(run, 'lumberMill', { x: -6, y: 6 })
    expect(off.road?.connected).toBe(false)
    expect(off.parts.join(' · ')).toMatch(/Off the road/)
  })

  it('erase mode names the stretch under the cursor', () => {
    const run = openRun()
    placeRoad(run, { x: 1, y: 0 }, { x: 5, y: 0 })
    const lift = describeRoadTool(run, null, { x: 3, y: 0.1 }, true)
    expect(lift.removeId).toBe(run.roads![0].id)
    expect(describeRoadTool(run, null, { x: 3, y: 3 }, true).ok).toBe(false)
  })
})

describe('old saves', () => {
  function withStorage<T>(entries: Record<string, string>, fn: () => T): T {
    const store = new Map(Object.entries(entries))
    const original = globalThis.localStorage
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage
    try {
      return fn()
    } finally {
      globalThis.localStorage = original
    }
  }

  it('load with no roads and play out exactly as before roads existed', () => {
    const run = createRun({ seed: 99, species: ['human', 'fox', 'harpy'] })
    drain(run)
    for (let i = 0; i < 200; i++) tick(run, TICK_SECONDS)
    const legacy = JSON.parse(JSON.stringify(run)) as Partial<RunState>
    delete legacy.roads
    delete legacy.roadCounter
    const loaded = withStorage({ 'emberwatch.run.v1': JSON.stringify(legacy) }, () => loadRun())!
    expect(loaded.roads).toEqual([])
    expect(loaded.roadCounter).toBe(0)

    // A legacy object (no roads field at all) and the migrated one tick to
    // the same state: the road bonus never applies without roads.
    const raw = JSON.parse(JSON.stringify(legacy)) as RunState
    const mods = computeModifiers(raw)
    for (const b of Object.values(raw.buildings)) {
      expect(roadMultiplier(raw, b)).toBe(1)
      expect(workRate(raw, b, mods)).toBe(workRate(loaded, loaded.buildings[b.id], mods))
    }
    for (let i = 0; i < 400; i++) {
      tick(raw, TICK_SECONDS)
      tick(loaded, TICK_SECONDS)
    }
    expect(loaded.stock).toEqual(raw.stock)
    expect(loaded.producedTotals).toEqual(raw.producedTotals)
    expect(loaded.reputation + loaded.reputationProgress).toBe(raw.reputation + raw.reputationProgress)
  })

  it('round-trip roads through a save, rebuilding the graph on load', () => {
    const run = openRun()
    const mill = addBuilding(run, 'lumberMill', { x: 6, y: 0 })
    placeRoad(run, mill.pos, HEARTH)
    const saved = new Map<string, string>()
    const loaded = withStorage({}, () => {
      saveRun(run)
      saved.set('k', localStorage.getItem('emberwatch.run.v1')!)
      return loadRun()!
    })
    expect(saved.get('k')).not.toMatch(/hubDistance|links/)
    expect(loaded.roads).toEqual(run.roads)
    expect(roadLinkOf(loaded, loaded.buildings[mill.id]).percent).toBe(ROAD_WORK_BONUS)
    // A fresh graph for a fresh object, equal in substance.
    expect(roadNetwork(loaded)).not.toBe(roadNetwork(run))
    expect(buildRoadNetwork(loaded).hubDistance).toEqual(roadNetwork(run).hubDistance)
  })
})
