import { describe, expect, it } from 'vitest'
import { BLUEPRINT_POOL, BUILDINGS } from '../content/buildings'
import { GLADE_EVENTS } from '../content/gladeEvents'
import { SPECIES } from '../content/species'
import { addClearer, assignWorker, findPlacement, placeBuilding } from './actions'
import { DECREE_FIRST_DELAY, SEASON_LENGTH, YEAR_SECONDS } from './balance'
import { createRun } from './createRun'
import {
  draftAppeal,
  optionAffordable,
  relevantBlueprints,
  rerollChoice,
  resolveGladeEvent,
  takeChoice,
} from './events'
import { foundingPart, foundingPicks, isFounding, migrateFounding } from './founding'
import { migrateRun } from '../persistence'
import { firstSteps, firstStepsComplete, firstStepTarget, isFoodCamp } from './onboarding'
import { population, storageUsed } from './queries'
import { RUN_MODIFIER_LIST } from '../content/runModifiers'
import { tick } from './tick'
import type { FirstStepId } from './onboarding'
import type { RunState } from '../types'

function newRun(species: RunState['speciesPool'] = ['human', 'beaver', 'lizard']): RunState {
  const state = createRun({ seed: 4242, species })
  while (state.pendingChoices.length > 0) takeChoice(state, state.pendingChoices[0].options[0])
  return state
}

function done(state: RunState): Record<FirstStepId, boolean> {
  return Object.fromEntries(firstSteps(state).map((s) => [s.id, s.done])) as Record<
    FirstStepId,
    boolean
  >
}

/** Places a building where the bot would, failing the test if it cannot. */
function place(state: RunState, defId: string): string {
  const pos = findPlacement(state, defId)
  expect(pos, `somewhere to put a ${defId}`).toBeTruthy()
  expect(placeBuilding(state, defId, pos!)).toBeNull()
  return Object.values(state.buildings).find((b) => b.defId === defId)!.id
}

describe('first steps checklist', () => {
  it('starts with nothing ticked', () => {
    const state = newRun()
    expect(Object.values(done(state)).some(Boolean)).toBe(false)
    expect(firstStepsComplete(state)).toBe(false)
  })

  it('ticks each step from the run state as the player acts', () => {
    const state = newRun()
    state.stock.wood = 200

    const forager = place(state, 'foragersCamp')
    expect(done(state)).toMatchObject({ foodCamp: true, woodCamp: false, staffCamps: false })

    const woodcutter = place(state, 'woodcuttersCamp')
    expect(done(state).woodCamp).toBe(true)

    // Staffing only one kind of camp is not enough.
    expect(assignWorker(state, forager)).toBeNull()
    expect(done(state).staffCamps).toBe(false)
    expect(assignWorker(state, woodcutter)).toBeNull()
    expect(done(state).staffCamps).toBe(true)
    expect(firstStepsComplete(state)).toBe(false)

    place(state, 'shelter')
    expect(done(state).shelter).toBe(true)
    // The glade is optional: the checklist completes without it.
    expect(done(state).glade).toBe(false)
    expect(firstStepsComplete(state)).toBe(true)

    const target = firstStepTarget(state, 'glade')
    expect(target?.kind).toBe('glade')
    expect(addClearer(state, (target as { gladeId: string }).gladeId)).toBeNull()
    expect(done(state).glade).toBe(true)
  })

  it('counts any food camp, and un-ticks when a camp loses its workers', () => {
    expect(isFoodCamp('foragersCamp')).toBe(true)
    expect(isFoodCamp('trappersCamp')).toBe(true)
    expect(isFoodCamp('smallFarm')).toBe(true)
    expect(isFoodCamp('woodcuttersCamp')).toBe(false)
    expect(isFoodCamp('lumberMill')).toBe(false)

    const state = newRun()
    state.stock.wood = 200
    const forager = place(state, 'foragersCamp')
    const woodcutter = place(state, 'woodcuttersCamp')
    expect(done(state).foodCamp).toBe(true)
    assignWorker(state, forager)
    assignWorker(state, woodcutter)
    expect(done(state).staffCamps).toBe(true)
    state.buildings[forager].workers = []
    expect(done(state).staffCamps).toBe(false)
  })

  it('points each step at something to click', () => {
    const state = newRun()
    expect(firstStepTarget(state, 'foodCamp')).toEqual({ kind: 'build', defId: 'foragersCamp' })
    expect(firstStepTarget(state, 'woodCamp')).toEqual({
      kind: 'build',
      defId: 'woodcuttersCamp',
    })
    expect(firstStepTarget(state, 'shelter')).toEqual({ kind: 'build', defId: 'shelter' })
    // Nothing to staff before a camp stands.
    expect(firstStepTarget(state, 'staffCamps')).toBeNull()
    const forager = place(state, 'foragersCamp')
    expect(firstStepTarget(state, 'staffCamps')).toEqual({ kind: 'building', buildingId: forager })
    // Reachable, and a safe glade before a dangerous one where there is a choice.
    const glade = firstStepTarget(state, 'glade')
    expect(glade?.kind).toBe('glade')
    const id = (glade as { gladeId: string }).gladeId
    expect(state.glades[id].cleared).toBe(false)
    expect(state.glades[id].neighbors.some((n) => state.glades[n].cleared)).toBe(true)
  })
})

/**
 * A new player who does exactly what the checklist says, in order, and nothing
 * else: one food camp, one woodcutters' camp, a worker in each, one shelter,
 * a crew on the glade the checklist points at. Drafts take the first option;
 * glade events take the first option that costs no villagers and unleashes no
 * threat, as the event card's warnings steer a careful newcomer. Every
 * balance change has to leave this settlement standing after its first Storm.
 */
function playChecklistOnly(state: RunState): void {
  const act = () => {
    const step = firstSteps(state).find((s) => !s.done)
    if (!step) return
    const target = firstStepTarget(state, step.id)
    if (!target) return
    if (target.kind === 'build') {
      const pos = findPlacement(state, target.defId)
      if (pos) placeBuilding(state, target.defId, pos)
    } else if (target.kind === 'building') {
      assignWorker(state, target.buildingId)
    } else {
      addClearer(state, target.gladeId)
      addClearer(state, target.gladeId)
    }
  }
  const answer = () => {
    while (state.pendingChoices.length > 0) {
      const choice = state.pendingChoices[0]
      if (choice.kind === 'gladeEvent') {
        const def = GLADE_EVENTS[choice.options[0]]
        const safe = def.options.findIndex(
          (o) => optionAffordable(state.stock, o) && !o.villagerLoss && !o.threat,
        )
        resolveGladeEvent(state, safe >= 0 ? safe : def.options.length - 1)
      } else {
        takeChoice(state, choice.options[0])
      }
    }
  }
  let sinceAct = Infinity
  while (state.phase === 'playing' && state.season.year === 1) {
    answer()
    if (sinceAct >= 2) {
      sinceAct = 0
      act()
    }
    tick(state, 0.25)
    sinceAct += 0.25
  }
  answer()
}

describe('a new player following the checklist', () => {
  it('rides out the first Storm on every trio', () => {
    const trios: RunState['speciesPool'][] = [
      ['human', 'beaver', 'lizard'],
      ['human', 'fox', 'harpy'],
      ['beaver', 'lizard', 'harpy'],
      ['beaver', 'lizard', 'fox'],
    ]
    for (const species of trios) {
      for (const seed of [1, 42, 777, 4242, 31337, 90210]) {
        const state = createRun({ seed, species })
        playChecklistOnly(state)
        const label = `${species.join('/')} seed ${seed}`
        expect(firstStepsComplete(state), `${label}: checklist done`).toBe(true)
        expect(state.phase, `${label}: still in the running`).toBe('playing')
        expect(state.season.year, label).toBe(2)
        expect(state.stats.villagersLost, `${label}: nobody left`).toBe(0)
        expect(population(state), label).toBeGreaterThanOrEqual(6)
        // Nobody is on the verge of leaving as Year 2 opens.
        for (const sp of species) expect(state.despair[sp], `${label}: ${sp} despair`).toBe(0)
      }
    }
  })
})

describe('first royal decree', () => {
  it('waits for the first Storm to pass: none in Year 1, one as Year 2 opens', () => {
    expect(DECREE_FIRST_DELAY).toBe(YEAR_SECONDS)
    expect(YEAR_SECONDS).toBe(SEASON_LENGTH.drizzle + SEASON_LENGTH.clearance + SEASON_LENGTH.storm)

    const state = newRun()
    let sawStorm = false
    while (state.season.year === 1) {
      tick(state, 0.125)
      // Answer orders as they come; keep any decree offer for the check below.
      state.pendingChoices = state.pendingChoices.filter((c) => c.kind === 'decree')
      if (state.season.season === 'storm') sawStorm = true
      if (state.season.year === 1) {
        expect(state.decree, `no decree at ${state.clock}s (${state.season.season})`).toBeNull()
        expect(state.pendingChoices, `no decree offer at ${state.clock}s`).toHaveLength(0)
      }
    }
    expect(sawStorm).toBe(true)
    // The countdown and the season clock run on the same tick.
    // The herald arrives with a choice of decrees; taking one makes it live.
    for (let i = 0; i < 4 && state.pendingChoices.length === 0; i++) tick(state, 0.125)
    expect(state.pendingChoices[0]?.kind).toBe('decree')
    takeChoice(state, state.pendingChoices[0].options[0])
    expect(state.decree).not.toBeNull()
    expect(state.season).toMatchObject({ year: 2, season: 'drizzle' })
    expect(state.log.some((entry) => entry.text.includes('Royal decree'))).toBe(true)
  })
})

describe('draft appeal', () => {
  it("names the run's species that want a service venue", () => {
    const state = newRun(['human', 'beaver', 'lizard'])
    const venue = BLUEPRINT_POOL.map((id) => BUILDINGS[id]).find((def) => def.service)!
    const appeal = draftAppeal(state, venue.id)
    const wanting = state.speciesPool.filter((sp) => SPECIES[sp].needs.includes(venue.service!.need))
    expect(appeal.serves).toEqual({ need: venue.service!.need, species: wanting })
  })

  it('marks producers that supply a wanted service good', () => {
    const state = newRun(['human', 'beaver', 'lizard'])
    // Whatever the draft logic would offer to complete a chain carries a reason.
    for (const id of relevantBlueprints(state)) {
      const appeal = draftAppeal(state, id)
      expect(
        appeal.serves !== undefined || appeal.supplies.length > 0,
        `${id} explains why it is relevant`,
      ).toBe(true)
      for (const supply of appeal.supplies) expect(supply.species.length).toBeGreaterThan(0)
    }

    // A building whose goods feed a venue lists the need and who wants it.
    const supplier = BLUEPRINT_POOL.find((id) => draftAppeal(state, id).supplies.length > 0)
    expect(supplier).toBeTruthy()
    for (const { need, species } of draftAppeal(state, supplier!).supplies) {
      for (const sp of species) expect(SPECIES[sp].needs).toContain(need)
    }
  })

  it('says nobody wants a service no species in the run needs', () => {
    const state = newRun(['human', 'beaver', 'lizard'])
    const wanted = new Set(state.speciesPool.flatMap((sp) => SPECIES[sp].needs))
    const unwanted = BLUEPRINT_POOL.map((id) => BUILDINGS[id]).find(
      (def) => def.service && !wanted.has(def.service.need),
    )
    if (!unwanted) return // every need is wanted by this trio
    expect(draftAppeal(state, unwanted.id).serves?.species).toEqual([])
  })
})

describe('the founding', () => {
  const kinds = (s: RunState) => s.pendingChoices.map((c) => foundingPart(c))

  it('opens with room in the stockpile on every land, its storage counted before the clock starts', () => {
    for (const def of RUN_MODIFIER_LIST) {
      const s = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'], modifiers: [def.id] })
      // The founding holds the clock, so the cap shown now must already be
      // the one the first tick works out (Early Frost's woodshed included).
      const ticked = structuredClone(s)
      ticked.pendingChoices = []
      tick(ticked, 0.125)
      expect(s.storageCap, def.id).toBe(ticked.storageCap)
      expect(storageUsed(s), def.id).toBeLessThan(s.storageCap)
    }
  })

  it('deals every opening pick as one founding, and the clock waits for all of it', () => {
    const s = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'] })
    expect(isFounding(s)).toBe(true)
    expect(s.pendingChoices.every((c) => c.founding)).toBe(true)
    expect(kinds(s)).toEqual(['blueprint', 'blueprint', 'blueprint', 'cornerstone', 'writ'])
    expect(foundingPicks(s).map((p) => p.index)).toEqual([0, 1, 2, 3, 4])
    // Picks come in any order: the writ and the cornerstone first.
    takeChoice(s, s.pendingChoices[4].options[0], 4)
    expect(s.orders.some((o) => o.writ)).toBe(true)
    tick(s, 1)
    expect(s.clock).toBe(0)
    takeChoice(s, s.pendingChoices[3].options[0], 3)
    expect(s.cornerstones).toHaveLength(1)
    expect(kinds(s)).toEqual(['blueprint', 'blueprint', 'blueprint'])
    while (isFounding(s)) takeChoice(s, s.pendingChoices[0].options[0])
    expect(s.pendingChoices).toEqual([])
    tick(s, 1)
    expect(s.clock).toBeGreaterThan(0)
  })

  it('never redraws the showing draft when a pick is taken out of turn', () => {
    const s = createRun({ seed: 99, species: ['human', 'fox', 'harpy'] })
    const showing = [...s.pendingChoices[0].options]
    const cursor = s.rngCursor
    takeChoice(s, s.pendingChoices[3].options[1], 3)
    takeChoice(s, s.pendingChoices[3].options[0], 3)
    expect(s.pendingChoices[0].options).toEqual(showing)
    expect(s.rngCursor).toBe(cursor)
  })

  it('ends on the same settlement whichever order the picks are made in', () => {
    const inTurn = createRun({ seed: 2024, species: ['beaver', 'lizard', 'fox'] })
    const outOfTurn = createRun({ seed: 2024, species: ['beaver', 'lizard', 'fox'] })
    const stone = outOfTurn.pendingChoices[3].options[1]
    const writ = outOfTurn.pendingChoices[4].options[2]
    takeChoice(outOfTurn, writ, 4)
    takeChoice(outOfTurn, stone, 3)
    while (isFounding(outOfTurn)) takeChoice(outOfTurn, outOfTurn.pendingChoices[0].options[0])
    while (isFounding(inTurn)) {
      const c = inTurn.pendingChoices[0]
      takeChoice(inTurn, c.kind === 'cornerstone' ? stone : c.kind === 'order' ? writ : c.options[0])
    }
    expect(outOfTurn.unlockedBuildings).toEqual(inTurn.unlockedBuildings)
    expect(outOfTurn.cornerstones).toEqual(inTurn.cornerstones)
    expect(outOfTurn.orders.map((o) => o.defId)).toEqual(inTurn.orders.map((o) => o.defId))
  })

  it('rerolls the founding cornerstone in place, leaving the draft before it alone', () => {
    const s = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'] })
    s.stock.amber = 50
    const showing = [...s.pendingChoices[0].options]
    const stones = [...s.pendingChoices[3].options]
    expect(rerollChoice(s, 3)).toBeNull()
    for (const id of s.pendingChoices[3].options) expect(stones).not.toContain(id)
    expect(s.pendingChoices[0].options).toEqual(showing)
    expect(s.pendingChoices[3].founding).toBe(true)
    // The writ is not up for a reroll.
    expect(rerollChoice(s, 4)).not.toBeNull()
  })

  it('later choices are not founding ones', () => {
    const s = newRun()
    expect(isFounding(s)).toBe(false)
    s.reputation = 1
    tick(s, 0.125)
    expect(s.pendingChoices.length).toBeGreaterThan(0)
    expect(s.pendingChoices.some((c) => c.founding)).toBe(false)
  })

  it('resumes a save made mid-opening, before picks carried the flag, as a founding', () => {
    const s = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'] })
    takeChoice(s, s.pendingChoices[0].options[0])
    const legacy = JSON.parse(JSON.stringify(s))
    for (const c of legacy.pendingChoices) delete c.founding
    const run = migrateRun(legacy)!
    expect(run.pendingChoices.every((c) => c.founding)).toBe(true)
    expect(foundingPicks(run)).toHaveLength(4)
    // Mid-run, nothing is flagged.
    const later = newRun()
    tick(later, 1)
    later.pendingChoices.push({ kind: 'blueprint', options: ['tavern', 'brewery'] })
    migrateFounding(later)
    expect(later.pendingChoices[0].founding).toBeUndefined()
  })
})
