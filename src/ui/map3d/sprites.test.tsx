import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ICON_IDS } from '../../art/icons'
import { BUILDING_ART, DEPOSIT_ART } from '../../game/content/art'
import type { IconId } from '../../art/icons'
import { artTexture, textureStats } from './sprites'

const iconTexture = (id: IconId) => artTexture('?', id)
const emojiTexture = (emoji: string) => artTexture(emoji)

/**
 * jsdom has no 2D canvas, so a recording stand-in takes its place: enough to
 * prove each icon is rasterised from its path data exactly once and then
 * shared, which is what keeps the 3D layers from re-baking on every tick.
 */
const paths: string[] = []
const restore: (() => void)[] = []

beforeAll(() => {
  class FakePath2D {
    constructor(d: string) {
      paths.push(d)
    }
  }
  vi.stubGlobal('Path2D', FakePath2D)
  const ctx = new Proxy(
    {},
    {
      get: (target: Record<string, unknown>, key: string) =>
        key in target ? target[key] : (target[key] = vi.fn(() => ({ width: 10 }))),
      set: (target: Record<string, unknown>, key: string, value) => {
        target[key] = value
        return true
      },
    },
  )
  const spy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => ctx as unknown as CanvasRenderingContext2D)
  restore.push(() => spy.mockRestore(), () => vi.unstubAllGlobals())
})

afterAll(() => restore.forEach((fn) => fn()))

describe('3D icon textures', () => {
  it('rasterises each icon once and hands every sprite the same texture', () => {
    const before = textureStats.created
    const first = iconTexture('wood')
    expect(textureStats.created).toBe(before + 1)
    expect(paths.length).toBeGreaterThan(0)

    const drawn = paths.length
    for (let i = 0; i < 50; i++) expect(iconTexture('wood')).toBe(first)
    expect(textureStats.created).toBe(before + 1)
    expect(paths.length).toBe(drawn)

    const other = iconTexture('stone')
    expect(other).not.toBe(first)
    expect(textureStats.created).toBe(before + 2)
  })

  it('keeps drawn icons and emoji in separate cache slots', () => {
    const before = textureStats.created
    const art = iconTexture('brazier')
    const emoji = emojiTexture('🏮')
    expect(art).not.toBe(emoji)
    iconTexture('brazier')
    emojiTexture('🏮')
    expect(textureStats.created).toBe(before + 2)
  })

  it('can bake every building and deposit icon the map shows', () => {
    const ids = new Set([...Object.values(BUILDING_ART), ...Object.values(DEPOSIT_ART)])
    for (const id of ids) {
      expect(ICON_IDS).toContain(id)
      expect(() => iconTexture(id!)).not.toThrow()
    }
    const before = textureStats.created
    for (const id of ids) iconTexture(id!)
    expect(textureStats.created).toBe(before)
  })
})
