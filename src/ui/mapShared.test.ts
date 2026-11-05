import { describe, expect, it } from 'vitest'
import { addClearer, isReachable } from '../game/engine/actions'
import { HEARTH_WARMTH_RADIUS, TICK_SECONDS } from '../game/engine/balance'
import { createRun } from '../game/engine/createRun'
import { buildingStatus as engineStatus } from '../game/engine/forecast'
import { computeModifiers } from '../game/engine/modifiers'
import { warmthSources } from '../game/engine/queries'
import { resolveGladeEvent, takeChoice } from '../game/engine/events'
import { pointInPolygon } from '../game/engine/geometry'
import { tick } from '../game/engine/tick'
import type { BuildingInstance, RunState } from '../game/types'
import {
  GLADE_KIND_STYLE,
  STATUS_BADGE,
  buildingStatusKind,
  gladeAccessText,
  gladeFill,
  gladeKindLabel,
  gladeLook,
  gladePlateInfo,
  isColdHousing,
  isUnlitWarmthSource,
  shade,
  showsWarmthRing,
  terrainColor,
  tierMark,
  upgradeFraction,
  type MapBuildingStatus,
} from './mapShared'
import {
  buildingKey,
  buildingViews,
  clearedKey,
  depositKey,
  forestKey,
  gladeSurfaceKey,
  miniMapKey,
  pathKey,
  roadKey,
  threatKey,
  villagerKey,
  villagerRouteKey,
  warmthKey,
} from './map3d/layerKeys'
import { assignWorker, findPlacement, placeBuilding } from '../game/engine/actions'
import { placeRoad, roadNetwork, roadStats } from '../game/engine/roads'
import { gladeEdgeGeometry } from './map3d/staticGeometry'

function newRun(): RunState {
  const run = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'] })
  drain(run)
  return run
}

function drain(run: RunState): void {
  let guard = 0
  while (run.pendingChoices.length > 0 && guard++ < 20) {
    const choice = run.pendingChoices[0]
    if (choice.kind === 'gladeEvent') resolveGladeEvent(run, choice.options.length - 1)
    else takeChoice(run, choice.options[0])
  }
}

function addBuilding(run: RunState, defId: string, patch: Partial<BuildingInstance> = {}): BuildingInstance {
  const b: BuildingInstance = {
    id: `test-${defId}-${Object.keys(run.buildings).length}`,
    defId,
    pos: { x: 1.5, y: 1.5 },
    gladeId: Object.values(run.glades).find((g) => g.cleared)!.id,
    built: true,
    buildProgress: 0,
    workers: [],
    activeRecipeId: '',
    recipeProgress: 0,
    paused: false,
    depositsInRange: {},
    ...patch,
  }
  run.buildings[b.id] = b
  return b
}

/** Lays a short road out from the hearth wherever the ground allows. */
function laySomeRoad(run: RunState): void {
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2
    const at = (r: number) => ({ x: Math.cos(angle) * r, y: Math.sin(angle) * r })
    if (placeRoad(run, at(1.2), at(2.6)) === null) return
  }
  throw new Error('no clear ground for a road beside the hearth')
}

describe('glade visual language', () => {
  it('names each kind once, for both renderers and the inspector', () => {
    expect(gladeKindLabel('small')).toBe('🌿 Small')
    expect(gladeKindLabel('dangerous')).toBe('⚠️ Dangerous')
    expect(gladeKindLabel('forbidden')).toBe('☠️ Forbidden')
    expect(GLADE_KIND_STYLE.forbidden.title).toBe('Forbidden glade')
  })

  it('gives fogged glade kinds distinct borders, patterns and tints', () => {
    const kinds = ['small', 'dangerous', 'forbidden'] as const
    for (const key of ['edge', 'fog', 'canopy'] as const) {
      expect(new Set(kinds.map((k) => GLADE_KIND_STYLE[k][key])).size).toBe(3)
    }
    const dashes = kinds.map((k) => JSON.stringify(GLADE_KIND_STYLE[k].dash))
    expect(new Set(dashes).size).toBe(3)
  })

  it('reports locked, reachable and clearing access', () => {
    const run = newRun()
    const fogged = Object.values(run.glades).filter((g) => gladeLook(g) === 'fogged')
    const reachable = fogged.find((g) => isReachable(run, g.id))!
    const locked = Object.values(run.glades).find((g) => !g.cleared && !isReachable(run, g.id))!
    expect(gladePlateInfo(run, locked).access).toBe('locked')
    expect(gladePlateInfo(run, reachable).access).toBe('reachable')
    expect(addClearer(run, reachable.id)).toBeNull()
    const info = gladePlateInfo(run, reachable)
    expect(info.access).toBe('clearing')
    expect(gladeAccessText(info)).toMatch(/⛏ 1 clearing/)
  })

  it('derives the 3D palette from the shared one instead of shadowing it', () => {
    expect(shade('#405060', 1.5)).toBe('#607890')
    expect(shade('#c0c0c0', 2)).toBe('#ffffff')
    expect(terrainColor('forest', '3d')).toBe(shade(terrainColor('forest', '2d'), 1.3))
    const run = newRun()
    const cleared = Object.values(run.glades).find((g) => g.cleared)!
    expect(gladeFill(cleared, '2d')).toBe(terrainColor(cleared.terrain, '2d'))
  })
})

describe('building status', () => {
  /*
   * The rules live in the engine (`forecast.buildingStatus`); the map only
   * reduces them to a kind and adds a badge. These check the reduction and
   * that every kind the engine can report has a badge.
   */
  it('mirrors the engine status kind, with construction on top', () => {
    const run = newRun()
    const mill = addBuilding(run, 'lumberMill', { built: false, activeRecipeId: 'plank' })
    const engineKind = () => engineStatus(run, mill, computeModifiers(run)).kind
    expect(buildingStatusKind(run, mill)).toBe('construction')
    mill.built = true
    expect(buildingStatusKind(run, mill)).toBe('noWorkers')
    mill.workers = [Object.keys(run.villagers)[0]]
    run.stock.wood = 10
    expect(buildingStatusKind(run, mill)).toBe('working')
    run.stock.wood = 0
    expect(buildingStatusKind(run, mill)).toBe('waitingInputs')
    expect(buildingStatusKind(run, mill)).toBe(engineKind())
    run.stock.wood = 10
    mill.recipeProgress = 16
    run.storageCap = 0
    expect(buildingStatusKind(run, mill)).toBe('storageFull')
    mill.paused = true
    expect(buildingStatusKind(run, mill)).toBe('paused')
    expect(buildingStatusKind(run, mill)).toBe(engineKind())
  })

  it('flags camps without a live deposit and farms idled by the Storm', () => {
    const run = newRun()
    const villager = Object.keys(run.villagers)[0]
    const camp = addBuilding(run, 'woodcuttersCamp', { activeRecipeId: 'wood', workers: [villager] })
    expect(buildingStatusKind(run, camp)).toBe('noDeposit')
    const farm = addBuilding(run, 'smallFarm', { activeRecipeId: 'grain', workers: [villager] })
    const soil = Object.values(run.deposits).find((d) => d.kind === 'fertileSoil')!
    farm.depositsInRange = { fertileSoil: [soil.id] }
    run.season.season = 'storm'
    expect(buildingStatusKind(run, farm)).toBe('offSeason')
  })

  it('has a badge for every kind the engine reports except none', () => {
    const kinds: MapBuildingStatus[] = [
      'construction',
      'paused',
      'noWorkers',
      'noDeposit',
      'offSeason',
      'waitingInputs',
      'storageFull',
      'working',
    ]
    for (const kind of kinds) expect(STATUS_BADGE[kind as Exclude<MapBuildingStatus, 'none'>]).toBeTruthy()
    expect(Object.keys(STATUS_BADGE).sort()).toEqual([...kinds].sort())
  })

  it('has nothing to say about housing, and knows when it is cold', () => {
    const run = newRun()
    const near = addBuilding(run, 'shelter', { pos: { x: 1, y: 0 } })
    const far = addBuilding(run, 'shelter', { pos: { x: HEARTH_WARMTH_RADIUS + 1, y: 0 } })
    expect(buildingStatusKind(run, near)).toBe('none')
    run.season.season = 'storm'
    expect(isColdHousing(run, near)).toBe(false)
    expect(isColdHousing(run, far)).toBe(true)
    run.season.season = 'drizzle'
    expect(isColdHousing(run, far)).toBe(false)
  })

  it('counts a lit brazier as warmth, and an unlit one as cold', () => {
    const run = newRun()
    const far = addBuilding(run, 'shelter', { pos: { x: HEARTH_WARMTH_RADIUS + 1, y: 0 } })
    const brazier = addBuilding(run, 'brazier', { pos: { x: HEARTH_WARMTH_RADIUS + 1.6, y: 0.4 } })
    run.season.season = 'storm'
    expect(isColdHousing(run, far)).toBe(false)
    expect(isColdHousing(run, far, warmthSources(run))).toBe(false)
    expect(isUnlitWarmthSource(brazier)).toBe(false)
    brazier.unlit = true
    expect(isColdHousing(run, far)).toBe(true)
    expect(isColdHousing(run, far, warmthSources(run))).toBe(true)
    expect(isUnlitWarmthSource(brazier)).toBe(true)
  })
})

describe('warmth overlay', () => {
  it('shows when toggled, placing housing or a brazier, or inspecting a fire or a home', () => {
    const show = (toggled: boolean, buildMode: string | null, selectedDefId: string | null) =>
      showsWarmthRing({ toggled, buildMode, selectedDefId })
    expect(show(false, null, null)).toBe(false)
    expect(show(true, null, null)).toBe(true)
    expect(show(false, 'shelter', null)).toBe(true)
    expect(show(false, 'brazier', null)).toBe(true)
    expect(show(false, 'lumberMill', null)).toBe(false)
    expect(show(false, null, 'ancientHearth')).toBe(true)
    expect(show(false, null, 'brazier')).toBe(true)
    expect(show(false, null, 'shelter')).toBe(true)
    expect(show(false, null, 'lumberMill')).toBe(false)
  })
})

describe('3D layer keys', () => {
  /*
   * Each scene layer re-renders only when its key changes. These keys must
   * therefore hold still while the sim ticks with nothing visible happening —
   * that is what stops glade geometry being rebuilt on every store version.
   */
  it('stay stable across sim ticks that change nothing they draw', () => {
    const run = newRun()
    // A brazier in play must not churn the keys while it simply burns on.
    // (A cold one would be relit outside the Storm — a real change.)
    addBuilding(run, 'brazier', { pos: { x: 2.4, y: -1.2 } })
    const keys = () => ({
      warmth: warmthKey(run),
      glades: gladeSurfaceKey(run),
      forest: forestKey(run),
      cleared: clearedKey(run),
      deposits: depositKey(run),
      paths: pathKey(run),
      minimap: miniMapKey(run),
      threats: threatKey(run),
      villagers: villagerKey(run),
      buildings: buildingKey(run),
    })
    const before = keys()
    for (let i = 0; i < 40; i++) tick(run, TICK_SECONDS)
    expect(run.clock).toBeGreaterThan(4)
    expect(keys()).toEqual(before)
  })

  it('stay stable across ticks with roads laid and villagers walking them', () => {
    const run = newRun()
    // A staffed workplace joined to the hearth by road, villagers at work.
    run.stock.wood = 200
    const spot = findPlacement(run, 'woodcuttersCamp')!
    expect(placeBuilding(run, 'woodcuttersCamp', spot)).toBeNull()
    const camp = Object.values(run.buildings).find((b) => b.defId === 'woodcuttersCamp')!
    camp.built = true
    run.stats.buildingsBuilt++
    expect(assignWorker(run, camp.id)).toBeNull()
    const hearth = Object.values(run.buildings).find((b) => b.defId === 'ancientHearth')!
    // Straight to the hearth if the way is clear, else a short spur by it.
    if (placeRoad(run, camp.pos, hearth.pos) !== null) laySomeRoad(run)
    expect(run.roads!.length).toBeGreaterThan(0)
    const net = roadNetwork(run)
    const built = roadStats.networksBuilt

    const keys = () => ({
      roads: roadKey(run),
      routes: villagerRouteKey(run),
      villagers: villagerKey(run),
      paths: pathKey(run),
      glades: gladeSurfaceKey(run),
      forest: forestKey(run),
      cleared: clearedKey(run),
      warmth: warmthKey(run),
      minimap: miniMapKey(run),
    })
    const before = keys()
    for (let i = 0; i < 80; i++) tick(run, TICK_SECONDS)
    expect(run.clock).toBeGreaterThan(9)
    expect(keys()).toEqual(before)
    // …and the road graph behind them was not rebuilt by the ticks either.
    expect(roadNetwork(run)).toBe(net)
    expect(roadStats.networksBuilt).toBe(built)
  })

  it('move the road and route keys when a road is laid or a villager is reassigned', () => {
    const run = newRun()
    run.stock.wood = 50
    const roads = roadKey(run)
    const routes = villagerRouteKey(run)
    laySomeRoad(run)
    expect(roadKey(run)).not.toBe(roads)
    expect(villagerRouteKey(run)).not.toBe(routes)
    const laid = villagerRouteKey(run)
    const villager = Object.values(run.villagers)[0]
    villager.assignment = villager.assignment ? null : 'clearing:glade1'
    expect(villagerRouteKey(run)).not.toBe(laid)
  })

  it('change when a brazier goes out or is lit again', () => {
    const run = newRun()
    const brazier = addBuilding(run, 'brazier', { pos: { x: 2.4, y: -1.2 } })
    const buildings = buildingKey(run)
    const warmth = warmthKey(run)
    expect(warmth).toContain(brazier.id)
    brazier.unlit = true
    expect(buildingKey(run)).not.toBe(buildings) // lit → ash model, cold marker
    expect(warmthKey(run)).not.toContain(brazier.id) // its ring goes
    brazier.unlit = false
    expect(buildingKey(run)).toBe(buildings)
    expect(warmthKey(run)).toBe(warmth)
  })

  it('change when a glade is cleared', () => {
    const run = newRun()
    const target = Object.values(run.glades).find(
      (g) => g.discovered && !g.cleared && g.kind === 'small' && isReachable(run, g.id),
    )!
    const glades = gladeSurfaceKey(run)
    const forest = forestKey(run)
    addClearer(run, target.id)
    expect(gladeSurfaceKey(run)).not.toBe(glades) // reachable → clearing
    target.clearProgress = target.clearWork
    tick(run, TICK_SECONDS)
    drain(run)
    expect(target.cleared).toBe(true)
    expect(forestKey(run)).not.toBe(forest)
  })
})

describe('glade border geometry', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ]

  it('runs just inside the polygon, whichever way it winds', () => {
    for (const polygon of [square, [...square].reverse()]) {
      const geometry = gladeEdgeGeometry(polygon, null, 0.2)
      const pos = geometry.getAttribute('position')
      expect(pos.count).toBe(4 * 6)
      for (let i = 0; i < pos.count; i++) {
        const p = { x: pos.getX(i), y: pos.getZ(i) }
        const inside =
          p.x >= -1e-9 && p.x <= 4 + 1e-9 && p.y >= -1e-9 && p.y <= 4 + 1e-9
        expect(inside || pointInPolygon(p, polygon)).toBe(true)
      }
    }
  })

  it('dashes leave gaps', () => {
    const solid = gladeEdgeGeometry(square, null, 0.2).getAttribute('position')
    const dashed = gladeEdgeGeometry(square, [0.5, 0.5], 0.2).getAttribute('position')
    // Four dashes per side instead of one quad per side.
    expect(solid.count).toBe(4 * 6)
    expect(dashed.count).toBe(16 * 6)
    // Dashes start half a gap in ([0.25, 0.75], [1.25, 1.75], ...), so the
    // stretch around x = 1 on the first edge is empty.
    for (let i = 0; i < dashed.count; i++) {
      if (Math.abs(dashed.getZ(i)) < 1e-9) {
        const x = dashed.getX(i)
        expect(x > 0.8 && x < 1.2).toBe(false)
      }
    }
  })
})

describe('building upgrade tiers on the map', () => {
  it('marks a tier with stars and an upgrade with its progress', () => {
    const run = newRun()
    const home = addBuilding(run, 'shelter')
    expect(tierMark(home)).toBe('')
    expect(upgradeFraction(home)).toBeNull()
    home.upgradeProgress = 6
    expect(upgradeFraction(home)).toBeCloseTo(0.5)
    delete home.upgradeProgress
    home.tier = 2
    expect(tierMark(home)).toBe('★★')
    // Saves from before upgrades carry no tier at all.
    delete home.tier
    expect(tierMark(home)).toBe('')
  })

  it('an insulated home is never shown cold', () => {
    const run = newRun()
    run.season.season = 'storm'
    const far = addBuilding(run, 'shelter', { pos: { x: 60, y: 60 } })
    expect(isColdHousing(run, far)).toBe(true)
    far.tier = 1
    expect(isColdHousing(run, far)).toBe(false)
    expect(isColdHousing(run, far, warmthSources(run))).toBe(false)
  })

  it('a tier change moves the building key, and only that building view', () => {
    const run = newRun()
    const a = addBuilding(run, 'warehouse', { pos: { x: 2.5, y: 2.5 } })
    addBuilding(run, 'shelter', { pos: { x: -2.5, y: 2.5 } })
    const key = buildingKey(run)
    const views = buildingViews(run)
    a.tier = 1
    expect(buildingKey(run)).not.toBe(key)
    const after = buildingViews(run)
    // The memoised node re-renders on changed props; every other view's props
    // are equal, so only this node re-renders.
    const strip = (v: (typeof views)[number]) => ({ ...v, building: v.building.id })
    for (let i = 0; i < views.length; i++) {
      if (views[i].building.id === a.id) {
        expect(after[i].tier).toBe(1)
        expect(strip(after[i])).not.toEqual(strip(views[i]))
      } else {
        expect(strip(after[i])).toEqual(strip(views[i]))
      }
    }
  })

  it('stays stable across ticks while nothing upgrades, and tracks an upgrade under way', () => {
    const run = newRun()
    const home = addBuilding(run, 'shelter', { pos: { x: 2.5, y: -2.5 }, tier: 1 })
    const key = buildingKey(run)
    for (let i = 0; i < 16; i++) tick(run, TICK_SECONDS)
    expect(buildingKey(run)).toBe(key)
    home.upgradeProgress = 0
    expect(buildingKey(run)).not.toBe(key)
    const started = buildingKey(run)
    for (let i = 0; i < 16; i++) tick(run, TICK_SECONDS)
    expect(buildingKey(run)).not.toBe(started)
  })
})
