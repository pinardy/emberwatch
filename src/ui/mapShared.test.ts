import { describe, expect, it } from 'vitest'
import { addClearer, isReachable } from '../game/engine/actions'
import { HEARTH_WARMTH_RADIUS, TICK_SECONDS } from '../game/engine/balance'
import { createRun } from '../game/engine/createRun'
import { resolveGladeEvent, takeChoice } from '../game/engine/events'
import { pointInPolygon } from '../game/engine/geometry'
import { tick } from '../game/engine/tick'
import type { BuildingInstance, RunState } from '../game/types'
import {
  GLADE_KIND_STYLE,
  buildingStatus,
  gladeAccessText,
  gladeFill,
  gladeKindLabel,
  gladeLook,
  gladePlateInfo,
  isColdHousing,
  shade,
  showsWarmthRing,
  terrainColor,
} from './mapShared'
import {
  buildingKey,
  clearedKey,
  depositKey,
  forestKey,
  gladeSurfaceKey,
  miniMapKey,
  pathKey,
  threatKey,
  villagerKey,
} from './map3d/layerKeys'
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
  it('walks construction → unstaffed → working → inputs/storage/paused', () => {
    const run = newRun()
    const mill = addBuilding(run, 'lumberMill', { built: false, activeRecipeId: 'plank' })
    expect(buildingStatus(run, mill)).toBe('construction')
    mill.built = true
    expect(buildingStatus(run, mill)).toBe('unstaffed')
    mill.workers = [Object.keys(run.villagers)[0]]
    run.stock.wood = 10
    expect(buildingStatus(run, mill)).toBe('working')
    run.stock.wood = 0
    expect(buildingStatus(run, mill)).toBe('noInputs')
    run.stock.wood = 10
    mill.recipeProgress = 16
    run.storageCap = 0
    expect(buildingStatus(run, mill)).toBe('storageFull')
    mill.paused = true
    expect(buildingStatus(run, mill)).toBe('paused')
  })

  it('flags camps without a live deposit and farms idled by the Storm', () => {
    const run = newRun()
    const villager = Object.keys(run.villagers)[0]
    const camp = addBuilding(run, 'woodcuttersCamp', { activeRecipeId: 'wood', workers: [villager] })
    expect(buildingStatus(run, camp)).toBe('noDeposit')
    const farm = addBuilding(run, 'smallFarm', { activeRecipeId: 'grain', workers: [villager] })
    const soil = Object.values(run.deposits).find((d) => d.kind === 'fertileSoil')!
    farm.depositsInRange = { fertileSoil: [soil.id] }
    run.season.season = 'storm'
    expect(buildingStatus(run, farm)).toBe('seasonIdle')
  })

  it('has nothing to say about housing, and knows when it is cold', () => {
    const run = newRun()
    const near = addBuilding(run, 'shelter', { pos: { x: 1, y: 0 } })
    const far = addBuilding(run, 'shelter', { pos: { x: HEARTH_WARMTH_RADIUS + 1, y: 0 } })
    expect(buildingStatus(run, near)).toBe('none')
    run.season.season = 'storm'
    expect(isColdHousing(run, near)).toBe(false)
    expect(isColdHousing(run, far)).toBe(true)
    run.season.season = 'drizzle'
    expect(isColdHousing(run, far)).toBe(false)
  })
})

describe('warmth overlay', () => {
  it('shows when toggled, placing housing, or inspecting the hearth', () => {
    expect(showsWarmthRing({ toggled: false, buildMode: null, hearthSelected: false })).toBe(false)
    expect(showsWarmthRing({ toggled: true, buildMode: null, hearthSelected: false })).toBe(true)
    expect(showsWarmthRing({ toggled: false, buildMode: 'shelter', hearthSelected: false })).toBe(true)
    expect(showsWarmthRing({ toggled: false, buildMode: 'lumberMill', hearthSelected: false })).toBe(false)
    expect(showsWarmthRing({ toggled: false, buildMode: null, hearthSelected: true })).toBe(true)
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
    const keys = () => ({
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
