import { describe, expect, it } from 'vitest'
import { BLUEPRINT_POOL, BUILDINGS } from '../content/buildings'
import { SPECIES } from '../content/species'
import { addClearer, assignWorker, findPlacement, placeBuilding } from './actions'
import { DECREE_FIRST_DELAY, SEASON_LENGTH, YEAR_SECONDS } from './balance'
import { createRun } from './createRun'
import { draftAppeal, relevantBlueprints, takeChoice } from './events'
import { firstSteps, firstStepsComplete, firstStepTarget, isFoodCamp } from './onboarding'
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

describe('first royal decree', () => {
  it('waits for the first Storm to pass: none in Year 1, one as Year 2 opens', () => {
    expect(DECREE_FIRST_DELAY).toBe(YEAR_SECONDS)
    expect(YEAR_SECONDS).toBe(SEASON_LENGTH.drizzle + SEASON_LENGTH.clearance + SEASON_LENGTH.storm)

    const state = newRun()
    let sawStorm = false
    while (state.season.year === 1) {
      tick(state, 0.125)
      state.pendingChoices = []
      if (state.season.season === 'storm') sawStorm = true
      if (state.season.year === 1) {
        expect(state.decree, `no decree at ${state.clock}s (${state.season.season})`).toBeNull()
      }
    }
    expect(sawStorm).toBe(true)
    // The countdown and the season clock run on the same tick.
    for (let i = 0; i < 4 && !state.decree; i++) tick(state, 0.125)
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
