import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../content/buildings'
import type { RunState } from '../types'
import { adjacencyMultiplier, adjacencyStatus, serviceCapacity } from './adjacency'
import { createRun } from './createRun'
import { addVillager } from './events'
import { gladeAt } from './mapgen'
import { computeModifiers } from './modifiers'
import { completeUpgrade } from './production'
import {
  comfortableHousing,
  computeStorageCap,
  population,
  speciesCounts,
  totalHousing,
} from './queries'
import { inRunCache, withRunCache } from './runCache'
import { removeVillager } from './society'
import { tick } from './tick'
import { hasTradingPost } from './trade'

const FAR = { x: 12, y: 9 }

function newRun(): RunState {
  const state = createRun({ seed: 9090, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  state.pendingChoices = []
  return state
}

function put(state: RunState, defId: string, pos: { x: number; y: number }, built = true) {
  const id = `cache_${defId}_${Object.keys(state.buildings).length}`
  state.buildings[id] = {
    id,
    defId,
    pos,
    gladeId: gladeAt(state.glades, pos)?.id ?? Object.keys(state.glades)[0],
    built,
    buildProgress: built ? BUILDINGS[defId].buildSeconds : 0,
    workers: [],
    activeRecipeId: BUILDINGS[defId].recipes[0]?.id ?? '',
    recipeProgress: 0,
    paused: false,
    depositsInRange: {},
  }
  return state.buildings[id]
}

/** Everything the cache remembers, as plain numbers to compare. */
function snapshot(state: RunState) {
  const mods = computeModifiers(state)
  return {
    adjacency: Object.values(state.buildings).map((b) => [
      b.id,
      adjacencyMultiplier(state, b, mods),
      serviceCapacity(state, b),
      adjacencyStatus(state, b).map((st) => st.partners),
    ]),
    population: population(state),
    species: speciesCounts(state),
    housing: totalHousing(state),
    comfort: comfortableHousing(state),
    storage: computeStorageCap(state, 7),
    tradingPost: hasTradingPost(state),
  }
}

describe('run cache', () => {
  it('answers exactly what the plain queries do, before and after the run changes', () => {
    const state = newRun()
    const tavern = put(state, 'tavern', FAR)
    const mill = put(state, 'lumberMill', { x: FAR.x - 3, y: FAR.y })
    put(state, 'shelter', { x: FAR.x + 1.6, y: FAR.y })
    const check = () => {
      const fresh = snapshot(state)
      expect(withRunCache(state, () => snapshot(state))).toEqual(fresh)
      // Twice: the second scope reuses what the first remembered.
      expect(withRunCache(state, () => snapshot(state))).toEqual(fresh)
    }
    check()

    // Edits by hand between scopes: a new partner, a site, a removal, a move,
    // a building unfinished, a tier, a Trading Post, a villager gone.
    put(state, 'woodcuttersCamp', { x: FAR.x - 3, y: FAR.y + 1.5 })
    check()
    const site = put(state, 'cabin', { x: FAR.x - 1.6, y: FAR.y }, false)
    check()
    site.built = true
    check()
    delete state.buildings[site.id]
    check()
    mill.pos = { x: FAR.x + 6, y: FAR.y + 4 }
    check()
    tavern.built = false
    check()
    tavern.built = true
    tavern.tier = 1
    check()
    put(state, 'tradingPost', { x: FAR.x - 6, y: FAR.y - 3 })
    check()
    delete state.villagers[Object.keys(state.villagers)[0]]
    check()
  })

  it('sees changes the engine makes in the middle of a scope', () => {
    const state = newRun()
    const home = put(state, 'shelter', FAR)
    const tavern = put(state, 'tavern', { x: FAR.x + 6, y: FAR.y })
    withRunCache(state, () => {
      expect(inRunCache(state)).toBe(true)
      const pop = population(state)
      const housing = totalHousing(state)
      const capacity = serviceCapacity(state, tavern)

      addVillager(state)
      expect(population(state)).toBe(pop + 1)
      removeVillager(state, Object.keys(state.villagers)[0])
      expect(population(state)).toBe(pop)

      // A site finishing moves `stats.buildingsBuilt`, as construction does.
      const site = put(state, 'shelter', { x: FAR.x + 6, y: FAR.y + 1.6 }, false)
      site.built = true
      state.stats.buildingsBuilt++
      expect(totalHousing(state)).toBeGreaterThan(housing)
      expect(serviceCapacity(state, tavern)).toBeGreaterThan(capacity)

      const before = totalHousing(state)
      completeUpgrade(state, home)
      // A copy of the record is outside the scope, so it is counted fresh.
      expect(totalHousing(state)).toBe(totalHousing({ ...state, buildings: { ...state.buildings } }))
      expect(totalHousing(state)).toBeGreaterThanOrEqual(before)
    })
    expect(inRunCache(state)).toBe(false)
  })

  it('leaves a played run exactly where the plain queries would', () => {
    const state = newRun()
    for (let i = 0; i < 2400; i++) {
      tick(state, 0.125)
      state.pendingChoices = []
      if (i % 300 === 0) expect(withRunCache(state, () => snapshot(state))).toEqual(snapshot(state))
    }
  })
})

