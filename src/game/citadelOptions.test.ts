import { describe, expect, it } from 'vitest'
import { CHARTERS } from './content/charters'
import { GLADE_EVENTS } from './content/gladeEvents'
import {
  HEARTH_STYLES,
  META_UPGRADES,
  META_UPGRADE_LIST,
  citadelLoadout,
  defaultMeta,
  emptyCitadelPerks,
  purchaseUpgrade,
} from './content/meta'
import {
  ALL_RUN_MODIFIER_LIST,
  CITADEL_RUN_MODIFIER_LIST,
  MAX_RUN_MODIFIERS,
  RUN_MODIFIERS,
  RUN_MODIFIER_LIST,
} from './content/runModifiers'
import { scoutedEvent } from './engine/citadel'
import { createRun } from './engine/createRun'
import { computeModifiers } from './engine/modifiers'
import {
  drawRunModifiers,
  landFor,
  modifierPool,
  modifiersClash,
  type LandPowers,
} from './engine/runModifiers'
import { offerCharter } from './engine/structure'
import type { MetaState, SpeciesId } from './types'

const TRIO: SpeciesId[] = ['human', 'beaver', 'lizard']

/** The upgrades this change adds; everything else predates it. */
const NEW_UPGRADES = [
  'charterOffice',
  'frontierCharter',
  'scoutsReport',
  'unchartedLands',
  'secondSurvey',
  'gildedHearth',
  'chosenGround',
]

/** The eighteen upgrades that existed before. */
const OLD_UPGRADES = META_UPGRADE_LIST.map((d) => d.id).filter((id) => !NEW_UPGRADES.includes(id))

function withPrereqs(...ids: string[]): string[] {
  const out = new Set<string>()
  const visit = (id: string) => {
    if (out.has(id)) return
    for (const req of META_UPGRADES[id]?.requires ?? []) visit(req)
    out.add(id)
  }
  ids.forEach(visit)
  return [...out]
}

function meta(...ids: string[]): MetaState {
  return { ...defaultMeta(), upgrades: withPrereqs(...ids) }
}

/** Only the prerequisites of `id`: the same Citadel, one upgrade short. */
function prereqsOf(id: string): MetaState {
  return { ...defaultMeta(), upgrades: withPrereqs(id).filter((u) => u !== id) }
}

const NO_POWERS: LandPowers = { unlockModifiers: [], landRerolls: 0, chooseModifier: false }

describe('new Citadel upgrades: content', () => {
  it('adds seven upgrades, keeps every old id, and fits the four branches', () => {
    expect(OLD_UPGRADES).toHaveLength(18)
    for (const id of NEW_UPGRADES) expect(META_UPGRADES[id], id).toBeDefined()
    for (const def of META_UPGRADE_LIST) {
      expect(['provisions', 'charters', 'knowledge', 'crown']).toContain(def.branch)
    }
  })

  it('every prerequisite chain is buyable in order from an empty Citadel', () => {
    for (const id of NEW_UPGRADES) {
      let m: MetaState = { ...defaultMeta(), citadelSupplies: 1000 }
      for (const step of withPrereqs(id)) {
        const res = purchaseUpgrade(m, step)
        expect(res.error, `${id} via ${step}`).toBeNull()
        m = res.meta!
      }
      expect(m.upgrades).toContain(id)
    }
    // And never out of order.
    expect(purchaseUpgrade({ ...defaultMeta(), citadelSupplies: 99 }, 'chosenGround').error).toMatch(
      /Requires/,
    )
  })

  it('only admits real, Citadel-locked modifiers and names a real hearth style', () => {
    const all = citadelLoadout(META_UPGRADE_LIST.map((d) => d.id))
    for (const id of all.unlockModifiers) expect(RUN_MODIFIERS[id]?.citadelLocked, id).toBe(true)
    // Every locked land can be admitted by some upgrade.
    for (const def of CITADEL_RUN_MODIFIER_LIST) expect(all.unlockModifiers).toContain(def.id)
    expect(HEARTH_STYLES[all.perks.hearthStyle!]).toBeDefined()
  })

  it('the locked lands follow the open pool’s invariants', () => {
    for (const def of CITADEL_RUN_MODIFIER_LIST) {
      expect(def.description.length).toBeGreaterThan(20)
      expect(def.tone).toBe('mixed')
      expect((def.effects?.length ?? 0) > 0 || !!def.mapgen).toBe(true)
      for (const ex of def.excludes ?? []) {
        expect(RUN_MODIFIERS[ex]?.excludes ?? []).toContain(def.id)
      }
      expect(RUN_MODIFIER_LIST).not.toContain(def)
    }
    expect(ALL_RUN_MODIFIER_LIST).toHaveLength(RUN_MODIFIER_LIST.length + CITADEL_RUN_MODIFIER_LIST.length)
  })
})

describe('runs with none of the new upgrades play exactly as before', () => {
  it('the land draw is unchanged for every seed without land powers', () => {
    for (let seed = 0; seed < 300; seed++) {
      expect(landFor(seed, NO_POWERS)).toEqual(drawRunModifiers(seed))
      // Choices without the powers are ignored.
      expect(landFor(seed, NO_POWERS, { reroll: true, chosen: 'richVeins' })).toEqual(
        drawRunModifiers(seed),
      )
    }
  })

  it('the old upgrades fold into the same perks and the same run as before', () => {
    const loadout = citadelLoadout(OLD_UPGRADES)
    expect(Object.keys(loadout.perks).sort()).toEqual(Object.keys(emptyCitadelPerks()).sort())
    expect(loadout.unlockModifiers).toEqual([])
    expect(loadout.landRerolls).toBe(0)
    expect(loadout.chooseModifier).toBe(false)
    const a = createRun({ seed: 515, species: [...TRIO], meta: meta(...OLD_UPGRADES) })
    const b = createRun({ seed: 515, species: [...TRIO], meta: meta(...OLD_UPGRADES), land: { reroll: true, chosen: 'illOmens' } })
    expect(b).toEqual(a)
    expect(a.runModifiers).toEqual(drawRunModifiers(515))
  })

  it('a charter offer without the Charter Office is the usual three', () => {
    const s = createRun({ seed: 9, species: [...TRIO], modifiers: [] })
    s.pendingChoices = []
    offerCharter(s)
    expect(s.pendingChoices[0].options).toHaveLength(3)
  })
})

describe('Uncharted Lands and the Frontier Charter', () => {
  it('admit their lands to the pool, after the open ones', () => {
    const powers = citadelLoadout(withPrereqs('unchartedLands'))
    expect(powers.unlockModifiers).toEqual(['amberSprings', 'pilgrimRoad'])
    const pool = modifierPool(powers.unlockModifiers).map((d) => d.id)
    expect(pool.slice(0, RUN_MODIFIER_LIST.length)).toEqual(RUN_MODIFIER_LIST.map((d) => d.id))
    expect(pool.slice(RUN_MODIFIER_LIST.length)).toEqual(['amberSprings', 'pilgrimRoad'])
    expect(citadelLoadout(withPrereqs('frontierCharter')).unlockModifiers).toEqual(['wildFrontier'])
  })

  it('makes those lands drawable, and only those', () => {
    const unlocked = ['amberSprings', 'pilgrimRoad']
    const seen = new Set<string>()
    for (let seed = 0; seed < 600; seed++) {
      const ids = drawRunModifiers(seed, { unlocked })
      ids.forEach((id) => seen.add(id))
      if (ids.length === 2) expect(modifiersClash(RUN_MODIFIERS[ids[0]], RUN_MODIFIERS[ids[1]])).toBe(false)
      expect(ids).not.toContain('wildFrontier')
    }
    expect(seen.has('amberSprings')).toBe(true)
    expect(seen.has('pilgrimRoad')).toBe(true)
    // Without the upgrade they never appear.
    for (let seed = 0; seed < 600; seed++) {
      for (const id of drawRunModifiers(seed)) expect(RUN_MODIFIERS[id].citadelLocked).toBeFalsy()
    }
  })

  it('their effects fold into the run like any other land', () => {
    const s = createRun({ seed: 3, species: [...TRIO], modifiers: ['wildFrontier'] })
    const mods = computeModifiers(s)
    const plain = computeModifiers(createRun({ seed: 3, species: [...TRIO], modifiers: [] }))
    expect(mods.decreeReputation).toBe(plain.decreeReputation + 1)
    expect(mods.gladeLoot).toBeGreaterThan(plain.gladeLoot)
  })
})

describe('Second Survey', () => {
  const powers = citadelLoadout(withPrereqs('secondSurvey'))

  it('allows one deterministic re-roll of the land', () => {
    expect(powers.landRerolls).toBe(1)
    let differs = 0
    for (let seed = 0; seed < 200; seed++) {
      const own = landFor(seed, powers)
      const rerolled = landFor(seed, powers, { reroll: true })
      expect(landFor(seed, powers, { reroll: true })).toEqual(rerolled)
      expect(rerolled.length).toBeGreaterThanOrEqual(1)
      expect(rerolled.length).toBeLessThanOrEqual(MAX_RUN_MODIFIERS)
      if (own.join() !== rerolled.join()) differs++
    }
    expect(differs).toBeGreaterThan(150)
  })

  it('reaches the run through createRun', () => {
    const m = meta('secondSurvey')
    const run = createRun({ seed: 42, species: [...TRIO], meta: m, land: { reroll: true } })
    expect(run.runModifiers).toEqual(landFor(42, citadelLoadout(m.upgrades), { reroll: true }))
  })
})

describe('Chosen Ground', () => {
  const powers = citadelLoadout(withPrereqs('chosenGround'))

  it('guarantees the chosen land, keeps the rest compatible, and caps at two', () => {
    expect(powers.chooseModifier).toBe(true)
    for (let seed = 0; seed < 200; seed++) {
      for (const chosen of ['longStorms', 'earlyFrost', 'amberSprings']) {
        const ids = landFor(seed, powers, { chosen })
        expect(ids[0]).toBe(chosen)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.length).toBeLessThanOrEqual(MAX_RUN_MODIFIERS)
        if (ids.length === 2) {
          expect(modifiersClash(RUN_MODIFIERS[ids[0]], RUN_MODIFIERS[ids[1]])).toBe(false)
        }
      }
    }
  })

  it('ignores a land outside the pool or unknown', () => {
    expect(landFor(5, powers, { chosen: 'wildFrontier' })).toEqual(landFor(5, powers))
    expect(landFor(5, powers, { chosen: 'nope' })).toEqual(landFor(5, powers))
  })
})

describe("Scouts' Report", () => {
  it('names the event in each first-ring glade, and nothing elsewhere', () => {
    const s = createRun({ seed: 1234, species: [...TRIO], meta: meta('scoutsReport'), modifiers: [] })
    expect(s.citadel.scoutReport).toBe(true)
    const ring = s.glades.glade0.neighbors
    for (const id of ring) {
      const report = scoutedEvent(s, id)
      const eventId = s.glades[id].eventId
      expect(report, id).toBe(eventId ? GLADE_EVENTS[eventId] : null)
    }
    const outer = Object.keys(s.glades).find((id) => id !== 'glade0' && !ring.includes(id))!
    expect(scoutedEvent(s, outer)).toBeUndefined()
    expect(scoutedEvent(s, 'glade0')).toBeUndefined()
    // A cleared glade has nothing left to report.
    s.glades[ring[0]].cleared = true
    expect(scoutedEvent(s, ring[0])).toBeUndefined()
  })

  it('says nothing without the upgrade, and does not change the map', () => {
    const plain = createRun({ seed: 1234, species: [...TRIO], modifiers: [], meta: prereqsOf('scoutsReport') })
    const scouted = createRun({ seed: 1234, species: [...TRIO], meta: meta('scoutsReport'), modifiers: [] })
    for (const id of plain.glades.glade0.neighbors) expect(scoutedEvent(plain, id)).toBeUndefined()
    expect(scouted.glades).toEqual(plain.glades)
    expect(scouted.rngCursor).toBe(plain.rngCursor)
  })
})

describe('Charter Office', () => {
  it('adds one more perk to the charter without consuming randomness', () => {
    const base = createRun({ seed: 77, species: [...TRIO], modifiers: [], meta: prereqsOf('charterOffice') })
    const office = createRun({ seed: 77, species: [...TRIO], modifiers: [], meta: meta('charterOffice') })
    expect(office.citadel.charterOptions).toBe(1)
    base.pendingChoices = []
    office.pendingChoices = []
    offerCharter(base)
    offerCharter(office)
    const a = base.pendingChoices[0].options
    const b = office.pendingChoices[0].options
    expect(b).toHaveLength(a.length + 1)
    expect(b.slice(0, a.length)).toEqual(a)
    expect(new Set(b).size).toBe(b.length)
    expect(CHARTERS[b[b.length - 1]].family).toBe('perk')
    expect(office.rngCursor).toBe(base.rngCursor)
  })
})

describe('Gilded Hearth', () => {
  it('is cosmetic: it sets the flame and changes nothing else', () => {
    const base = createRun({ seed: 31, species: [...TRIO], modifiers: [] })
    const gilded = createRun({ seed: 31, species: [...TRIO], modifiers: [], meta: meta('gildedHearth') })
    expect(gilded.citadel.hearthStyle).toBe('sapphire')
    expect({ ...gilded, citadel: base.citadel }).toEqual(base)
  })
})
