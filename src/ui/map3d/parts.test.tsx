import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { BUILDINGS } from '../../game/content/buildings'
import { createRun } from '../../game/engine/createRun'
import type { BuildingInstance } from '../../game/types'
import { buildingModelKey } from './layerKeys'
import { buildingParts, chimneyAt, depositParts, obstacleParts } from './modelParts'
import { SpriteAtlas } from './spriteBatch'
import type { SpriteTile } from './sprites'

/**
 * The 3D map draws every building, deposit and obstacle as instanced parts:
 * one draw call per geometry × material class, however big the settlement.
 * These tests pin that the set of classes is small and does not grow with the
 * number of buildings, and that the sprite atlas paints each tile once.
 */

function building(defId: string, i: number, over: Partial<BuildingInstance> = {}): BuildingInstance {
  return {
    id: `${defId}-${i}`,
    defId,
    pos: { x: (i % 7) * 2 - 7, y: Math.floor(i / 7) * 2 - 5 },
    gladeId: 'g0',
    built: true,
    buildProgress: 0,
    workers: [],
    activeRecipeId: '',
    recipeProgress: 0,
    paused: false,
    depositsInRange: {},
    ...over,
  }
}

const groupsOf = (parts: { geo: string; mat: string }[]) => new Set(parts.map((p) => `${p.geo}|${p.mat}`))

describe('instanced 3D models', () => {
  it('draws every building in every state with a small, fixed set of instanced meshes', () => {
    const one: { geo: string; mat: string }[] = []
    const many: { geo: string; mat: string }[] = []
    for (const def of Object.values(BUILDINGS)) {
      for (const state of [
        { occupied: true, lit: true, tier: 2, upgrading: true, cold: true },
        { occupied: false, lit: false, tier: 0, upgrading: false, cold: false },
      ]) {
        one.push(...buildingParts({ building: building(def.id, 0), progress: 1, ...state }))
        one.push(...buildingParts({ building: building(def.id, 0, { built: false }), progress: 0.4, ...state }))
        for (let i = 0; i < 12; i++) {
          many.push(...buildingParts({ building: building(def.id, i), progress: 1, ...state }))
          many.push(...buildingParts({ building: building(def.id, i, { built: false }), progress: 0.4, ...state }))
        }
      }
    }
    // Every def at once in every state needs fewer than 20 draw calls, and
    // twelve copies of each need exactly the same ones.
    expect(groupsOf(one).size).toBeLessThan(20)
    expect(groupsOf(many)).toEqual(groupsOf(one))
  })

  it('draws every deposit and obstacle with a handful of instanced meshes', () => {
    const run = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'] })
    const parts = [
      ...Object.values(run.deposits).flatMap((d) => depositParts(d)),
      ...run.obstacles.flatMap((o) => obstacleParts(o)),
    ]
    expect(parts.length).toBeGreaterThan(Object.keys(run.deposits).length)
    expect(groupsOf(parts).size).toBeLessThan(14)
  })

  it('puts the smoke on top of the rotated chimney', () => {
    for (let i = 0; i < 8; i++) {
      const b = building('lumberMill', i)
      const parts = buildingParts({ building: b, progress: 1, occupied: false, lit: true, tier: 0, upgrading: false, cold: false })
      // The chimney: the tallest thin box.
      const pos = new THREE.Vector3()
      const scale = new THREE.Vector3()
      let top: THREE.Vector3 | null = null
      let best = 0
      for (const p of parts) {
        if (p.geo !== 'box') continue
        p.matrix.decompose(pos, new THREE.Quaternion(), scale)
        if (scale.x < 0.3 && scale.y > best) {
          best = scale.y
          top = new THREE.Vector3(pos.x, pos.y + scale.y, pos.z)
        }
      }
      const [x, y, z] = chimneyAt(b)
      expect(top!.x).toBeCloseTo(x, 5)
      expect(top!.y).toBeCloseTo(y, 5)
      expect(top!.z).toBeCloseTo(z, 5)
    }
  })

  it('keeps the building model key still while only work and stock change', () => {
    const run = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'] })
    const key = buildingModelKey(run)
    for (const b of Object.values(run.buildings)) {
      b.recipeProgress += 3
      b.workers = [...b.workers]
    }
    run.clock += 10
    expect(buildingModelKey(run)).toBe(key)
    const first = Object.values(run.buildings)[0]
    first.tier = (first.tier ?? 0) + 1
    expect(buildingModelKey(run)).not.toBe(key)
  })
})

describe('sprite atlas', () => {
  const restore: (() => void)[] = []
  beforeAll(() => {
    const ctx = new Proxy(
      {},
      {
        get: (target: Record<string, unknown>, key: string) =>
          key in target ? target[key] : (target[key] = vi.fn(() => ({ width: 10, data: new Uint8ClampedArray(4) }))),
        set: (target: Record<string, unknown>, key: string, value) => {
          target[key] = value
          return true
        },
      },
    )
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => ctx as unknown as CanvasRenderingContext2D)
    restore.push(() => spy.mockRestore())
  })
  afterAll(() => restore.forEach((fn) => fn()))

  const tile = (key: string, painted: string[]): SpriteTile => ({ key, draw: () => painted.push(key) })

  it('paints a tile once, shares it, and reuses a released slot only when full', () => {
    const atlas = new SpriteAtlas(256, 256, 128, 128) // four slots
    const painted: string[] = []
    const a = atlas.acquire(tile('a', painted))
    expect(atlas.acquire(tile('a', painted))).toBe(a)
    expect(painted).toEqual(['a'])

    const slots = ['b', 'c', 'd'].map((k) => atlas.acquire(tile(k, painted)))
    expect(new Set([a, ...slots]).size).toBe(4)
    // Full of live tiles: nothing to give.
    expect(atlas.acquire(tile('e', painted))).toBe(-1)

    // Released tiles stay cached (no repaint) until a new one needs the room.
    atlas.release('b')
    expect(atlas.acquire(tile('b', painted))).toBe(slots[0])
    expect(painted.filter((k) => k === 'b')).toHaveLength(1)
    atlas.release('b')
    atlas.release('a')
    atlas.release('a')
    // 'b' was released first, so it is the one evicted.
    expect(atlas.acquire(tile('e', painted))).toBe(slots[0])
    expect(atlas.acquire(tile('f', painted))).toBe(a)
    expect(atlas.acquire(tile('g', painted))).toBe(-1)
  })
})
