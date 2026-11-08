import { describe, expect, it } from 'vitest'
import { BUILDING_ART, DEPOSIT_ART, GLADE_ART, METER_ART, NEED_ART, SEASON_ART, SPECIES_ART, TERRAIN_ART, edictArt } from '../game/content/art'
import { runModifierArt } from '../game/content/art'
import { STATUS_BADGE_ART, TAB_ART, VILLAGER_TRAIT_ART, achievementArt, charterArt, conditionArt, cornerstoneArt, gladeEventArt, metaBranchArt, metaUpgradeArt, ongoingArt, threatArt } from '../game/content/artFamilies'
import { ACHIEVEMENT_LIST } from '../game/content/achievements'
import { CHARTER_LIST } from '../game/content/charters'
import { CORNERSTONE_LIST } from '../game/content/cornerstones'
import { GLADE_EVENT_LIST } from '../game/content/gladeEvents'
import { EDICTS, META_BRANCHES, META_UPGRADE_LIST } from '../game/content/meta'
import { ALL_RUN_MODIFIER_LIST } from '../game/content/runModifiers'
import { modifierOngoingId } from '../game/engine/runModifiers'
import { VILLAGER_TRAIT_LIST } from '../game/content/species'
import { STATUS_BADGE } from '../ui/mapShared'
import { CORE_ICONS } from './core'
import { FRAMES } from './frames'
import { BUILDING_LIST } from '../game/content/buildings'
import { RESOURCE_LIST } from '../game/content/resources'
import { NEED_LABELS, SPECIES_LIST } from '../game/content/species'
import { TERRAIN } from '../game/content/terrain'
import { SEASON_INFO } from '../game/engine/balance'
import { DEPOSIT_INFO } from '../game/engine/mapgen'
import { ICON_IDS, ICONS, PALETTE, iconShapes, isIconId, type IconId } from './icons'

/**
 * Content that is still allowed to render its emoji instead of drawn art,
 * as `family:id`. Empty today: every family below has an icon for every id.
 * A new building, cornerstone, event, land, charter, upgrade or achievement
 * added without art fails here until it is drawn or listed on purpose.
 */
const AWAITING_ART: string[] = []

/** Every id a family helper returns must be drawn, unless deliberately listed. */
function expectDrawn(family: string, id: string | number, art: IconId | undefined) {
  if (AWAITING_ART.includes(`${family}:${id}`)) return
  expect(art, `${family}:${id} has no art`).toBeDefined()
  expect(isIconId(art), `${family}:${id} → ${art}`).toBe(true)
  expect(iconShapes(art!).length, `${family}:${id}`).toBeGreaterThan(0)
}

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

  it('draws every cornerstone, Citadel-locked ones included, framed by rarity', () => {
    expect(CORNERSTONE_LIST.length).toBeGreaterThan(40)
    for (const def of CORNERSTONE_LIST) {
      const art = cornerstoneArt(def)
      expectDrawn('cornerstone', def.id, art)
      expect(art?.startsWith(`stone-${def.rarity}/`), def.id).toBe(true)
    }
  })

  it('draws every glade event and the threats, pacts and conditions they leave', () => {
    for (const def of GLADE_EVENT_LIST) {
      expectDrawn('event', def.id, gladeEventArt(def))
      for (const option of def.options) {
        if (option.threat) expectDrawn('threat', option.threat.name, threatArt(option.threat))
        if (option.ongoing) {
          // As the run records it: a glade pact's id is `g<n>_<event>`.
          expectDrawn('pact', option.ongoing.name, ongoingArt({ id: `g0_${def.id}`, name: option.ongoing.name }))
        }
        if (option.condition) expectDrawn('condition', option.condition.name, conditionArt(option.condition))
      }
    }
  })

  it('draws every land, charter, Citadel branch and upgrade, edict and achievement', () => {
    expect(ALL_RUN_MODIFIER_LIST.length).toBeGreaterThanOrEqual(15)
    for (const def of ALL_RUN_MODIFIER_LIST) {
      expectDrawn('land', def.id, runModifierArt(def))
      // The land's entry in "Pacts & blessings" finds the same art.
      expect(ongoingArt({ id: modifierOngoingId(def.id), name: def.name })).toBe(runModifierArt(def))
    }
    for (const def of CHARTER_LIST) {
      expectDrawn('charter', def.id, charterArt(def))
      expect(ongoingArt({ id: `charter_${def.id}`, name: def.name })).toBe(charterArt(def))
    }
    for (const branch of META_BRANCHES) expectDrawn('branch', branch.id, metaBranchArt(branch.id))
    expect(META_UPGRADE_LIST.length).toBeGreaterThanOrEqual(25)
    for (const def of META_UPGRADE_LIST) {
      const art = metaUpgradeArt(def)
      expectDrawn('upgrade', def.id, art)
      expect(art?.startsWith(`citadel-${def.branch}/`), def.id).toBe(true)
    }
    for (const def of EDICTS) expectDrawn('edict', def.level, edictArt(def.level))
    expect(ACHIEVEMENT_LIST.length).toBeGreaterThanOrEqual(25)
    for (const def of ACHIEVEMENT_LIST) {
      const art = achievementArt(def)
      expectDrawn('achievement', def.id, art)
      expect(art?.startsWith(`medal-${def.tier}/`), def.id).toBe(true)
    }
    expectDrawn('pact', 'citadel', ongoingArt({ id: 'citadel', name: 'Citadel provisions' }))
    expectDrawn('pact', 'edict', ongoingArt({ id: 'edict', name: "Queen's Edict II" }))
  })

  it('draws every villager trait, side-panel tab and map status badge', () => {
    for (const def of VILLAGER_TRAIT_LIST) expectDrawn('trait', def.id, VILLAGER_TRAIT_ART[def.id])
    for (const [tab, art] of Object.entries(TAB_ART)) expectDrawn('tab', tab, art)
    for (const [kind, badge] of Object.entries(STATUS_BADGE)) {
      expectDrawn('badge', kind, badge.art)
      expect(badge.art.startsWith('mono/'), kind).toBe(true)
    }
    expectDrawn('badge', 'cold', STATUS_BADGE_ART.cold)
  })

  it('keeps every member of a framed family distinct within its family', () => {
    const families: [string, (IconId | undefined)[]][] = [
      ['cornerstone', CORNERSTONE_LIST.map((d) => cornerstoneArt(d))],
      ['upgrade', META_UPGRADE_LIST.map((d) => metaUpgradeArt(d))],
      ['achievement', ACHIEVEMENT_LIST.map((d) => achievementArt(d))],
      ['land', ALL_RUN_MODIFIER_LIST.map((d) => runModifierArt(d))],
      ['charter', CHARTER_LIST.map((d) => charterArt(d))],
      ['edict', EDICTS.map((d) => edictArt(d.level))],
    ]
    for (const [family, ids] of families) {
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
      expect(dupes, family).toEqual([])
    }
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

  it('composes framed ids from any frame and any drawn icon, and rejects the rest', () => {
    const framed = iconShapes('threat/wolf')
    expect(framed.length).toBeGreaterThan(ICONS.wolf.length)
    expect(iconShapes('threat/wolf')).toBe(framed) // composed once, then cached
    for (const frame of Object.keys(FRAMES)) expect(isIconId(`${frame}/wood`), frame).toBe(true)
    expect(isIconId('nope/wood')).toBe(false)
    expect(isIconId('threat/nope')).toBe(false)
    expect(isIconId('threat/')).toBe(false)
  })

  it('keeps the eager core small: only what the menu shows', () => {
    // The species, the two race meters and the menu's own glyphs.
    expect(Object.keys(CORE_ICONS).length).toBeLessThanOrEqual(16)
    for (const id of Object.keys(CORE_ICONS)) expect(ICONS).toHaveProperty(id)
  })

  it('rejects ids that are not drawn', () => {
    expect(isIconId('wood')).toBe(true)
    expect(isIconId('toString')).toBe(false)
    expect(isIconId('nope')).toBe(false)
    expect(isIconId(undefined)).toBe(false)
  })
})
