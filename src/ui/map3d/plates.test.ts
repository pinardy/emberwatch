import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { iconShapes } from '../../art/icons'
import type { Glade } from '../../game/types'
import { SPARED_STYLE } from '../mapShared'
import { plateTile } from './plates'

/**
 * The 3D glade plate, painted into a recording stand-in for a 2D canvas
 * (jsdom has none): a glade left to the forest must read apart from one
 * waiting for a crew — its own key, a soft border with no glow, the truce on
 * its status line beside a trees badge.
 */

interface Recorded {
  texts: string[]
  strokes: string[]
  shadowBlur: number[]
  paths: string[]
}

let paths: string[] = []

beforeAll(() => {
  class FakePath2D {
    constructor(d: string) {
      paths.push(d)
    }
  }
  vi.stubGlobal('Path2D', FakePath2D)
})

afterAll(() => vi.unstubAllGlobals())

function paint(glade: Glade, access: Parameters<typeof plateTile>[1]): Recorded {
  paths = []
  const rec: Recorded = { texts: [], strokes: [], shadowBlur: [], paths }
  const target: Record<string, unknown> = {}
  const ctx = new Proxy(target, {
    get: (t, key: string) => {
      if (key === 'fillText') return (text: string) => rec.texts.push(text)
      if (key === 'measureText') return (text: string) => ({ width: text.length * 16 })
      if (key in t) return t[key]
      return (t[key] = () => undefined)
    },
    set: (t, key: string, value) => {
      if (key === 'strokeStyle' && typeof value === 'string') rec.strokes.push(value)
      if (key === 'shadowBlur') rec.shadowBlur.push(value as number)
      t[key] = value
      return true
    },
  })
  plateTile(glade, access, 0, 0).draw(ctx as unknown as CanvasRenderingContext2D, 512, 256)
  return rec
}

const glade = {
  id: 'g7',
  name: 'Mossy Hollow',
  kind: 'dangerous',
} as unknown as Glade

describe('3D glade plates', () => {
  it('sets a glade left to the forest apart from one in reach', () => {
    const reachable = paint(glade, 'reachable')
    const spared = paint(glade, 'spared')
    expect(plateTile(glade, 'spared', 0, 0).key).not.toBe(plateTile(glade, 'reachable', 0, 0).key)

    // The truce on its status line, with the trees badge drawn beside it.
    expect(spared.texts).toContain(SPARED_STYLE.label)
    expect(reachable.texts).not.toContain(SPARED_STYLE.label)
    const trees = iconShapes(SPARED_STYLE.art).map((shape) => shape.d)
    expect(trees.every((d) => spared.paths.includes(d))).toBe(true)
    // Still named, kind and all.
    expect(spared.texts).toContain('Mossy Hollow')
    expect(spared.texts).toContain('DANGEROUS')

    // A softer border: no glow, and not the kind's warning colour.
    expect(reachable.shadowBlur.some((b) => b > 0)).toBe(true)
    expect(spared.shadowBlur.some((b) => b > 0)).toBe(false)
    // (The plate's border is its first stroke; the icons' come after.)
    expect(spared.strokes[0]).not.toBe(reachable.strokes[0])
    expect(spared.strokes[0]).toMatch(/rgba\(159, 220, 180/)
  })
})
