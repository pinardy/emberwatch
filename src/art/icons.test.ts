import { describe, expect, it } from 'vitest'
import {
  BUILDING_ART,
  DEPOSIT_ART,
  GLADE_ART,
  METER_ART,
  NEED_ART,
  SEASON_ART,
  SPECIES_ART,
  TERRAIN_ART,
} from '../game/content/art'
import { BUILDING_LIST } from '../game/content/buildings'
import { RESOURCE_LIST } from '../game/content/resources'
import { NEED_LABELS, SPECIES_LIST } from '../game/content/species'
import { TERRAIN } from '../game/content/terrain'
import { SEASON_INFO } from '../game/engine/balance'
import { DEPOSIT_INFO } from '../game/engine/mapgen'
import { ICON_IDS, ICONS, PALETTE, iconSvgMarkup, isIconId } from './icons'

/**
 * Content that is still allowed to render its emoji instead of drawn art.
 * Empty today: every resource, building, species, need, meter, season,
 * deposit, glade kind and terrain has an icon. A new building added without
 * art fails below until it is drawn or listed here on purpose.
 */
const AWAITING_ART: string[] = []

describe('icon coverage', () => {
  it('draws every resource', () => {
    for (const def of RESOURCE_LIST) {
      expect(isIconId(def.art), def.id).toBe(true)
      expect(def.icon.length, `${def.id} keeps its emoji fallback`).toBeGreaterThan(0)
    }
  })

  it('draws every building, the brazier included', () => {
    const missing = BUILDING_LIST.filter((d) => !isIconId(d.art)).map((d) => d.id)
    expect(missing).toEqual(AWAITING_ART.filter((id) => BUILDING_LIST.some((d) => d.id === id)))
    expect(BUILDING_LIST.find((d) => d.id === 'brazier')?.art).toBe('brazier')
    // The mapping holds nothing stale either.
    for (const id of Object.keys(BUILDING_ART)) {
      expect(BUILDING_LIST.some((d) => d.id === id), id).toBe(true)
    }
  })

  it('draws every species, need, meter, season, deposit, glade kind and terrain', () => {
    for (const def of SPECIES_LIST) expect(isIconId(def.art), def.id).toBe(true)
    for (const need of Object.keys(NEED_LABELS)) {
      expect(isIconId(NEED_ART[need as keyof typeof NEED_ART]), need).toBe(true)
    }
    for (const id of Object.values(METER_ART)) expect(isIconId(id), id).toBe(true)
    for (const season of Object.keys(SEASON_INFO)) {
      expect(isIconId(SEASON_ART[season as keyof typeof SEASON_ART]), season).toBe(true)
    }
    for (const kind of Object.keys(DEPOSIT_INFO)) {
      expect(isIconId(DEPOSIT_ART[kind as keyof typeof DEPOSIT_ART]), kind).toBe(true)
    }
    for (const kind of ['settlement', 'small', 'dangerous', 'forbidden'] as const) {
      expect(isIconId(GLADE_ART[kind]), kind).toBe(true)
    }
    for (const def of Object.values(TERRAIN)) {
      expect(def.art, def.id).toBe(TERRAIN_ART[def.id])
      expect(isIconId(def.art), def.id).toBe(true)
    }
    expect(Object.keys(SPECIES_ART).sort()).toEqual(SPECIES_LIST.map((d) => d.id).sort())
  })

  it('tells resources and buildings apart: no two share a drawing', () => {
    const ids = [...RESOURCE_LIST.map((d) => d.art), ...BUILDING_LIST.map((d) => d.art)]
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('icon registry', () => {
  it('holds only well-formed path data in the shared palette', () => {
    expect(ICON_IDS.length).toBeGreaterThan(90)
    for (const id of ICON_IDS) {
      const shapes = ICONS[id]
      expect(shapes.length, id).toBeGreaterThan(0)
      for (const s of shapes) {
        expect(s.d, id).toMatch(/^M[-\d.\sMmLlHhVvCcSsQqTtAaZz]+$/)
        expect(s.d, id).not.toMatch(/NaN|undefined/)
        expect(s.fill ?? s.stroke, `${id} draws something`).toBeDefined()
        if (s.fill) expect(PALETTE).toHaveProperty(s.fill)
        if (s.stroke) expect(PALETTE).toHaveProperty(s.stroke)
      }
    }
  })

  it('serialises to a standalone SVG with concrete colours', () => {
    const svg = iconSvgMarkup('impatience', { current: '#ffffff' })
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
    expect(svg).toContain('viewBox="0 0 24 24"')
    expect(svg).not.toContain('currentColor')
    expect(iconSvgMarkup('impatience')).toContain('currentColor')
  })

  it('rejects ids that are not drawn', () => {
    expect(isIconId('wood')).toBe(true)
    expect(isIconId('toString')).toBe(false)
    expect(isIconId('nope')).toBe(false)
    expect(isIconId(undefined)).toBe(false)
  })
})
