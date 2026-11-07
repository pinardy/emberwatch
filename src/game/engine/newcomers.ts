import { VILLAGER_TRAIT_LIST, speciesSingular, villagerName } from '../content/species'
import type { RunState } from '../types'
import { VILLAGER_TRAIT_CHANCE } from './balance'
import { population } from './queries'
import { makeRng } from './rng'
import { touchVillagers } from './runCache'
import { pushLog } from './runLog'

/** Villagers arriving: newcomers at the hearth while there are spare beds. */

/** Adds a villager of a random species from the run's pool. */
export function addVillager(s: RunState): string | null {
  const rng = makeRng(s.seed, s.rngCursor)
  const species = rng.pick(s.speciesPool)
  const trait = rng.chance(VILLAGER_TRAIT_CHANCE)
    ? rng.pick(VILLAGER_TRAIT_LIST).id
    : undefined
  s.rngCursor = rng.cursor()
  const index = Object.keys(s.villagers).length + s.stats.villagersLost
  const id = `v${index}_${s.clock.toFixed(0)}`
  s.villagers[id] = {
    id,
    species,
    name: villagerName(index),
    assignment: null,
    ...(trait ? { trait } : {}),
  }
  touchVillagers(s)
  return id
}

export function stepNewcomers(
  s: RunState,
  dt: number,
  interval: number,
  housing: number,
): void {
  if (population(s) >= housing) {
    // No spare beds — hold the timer so a newcomer arrives soon after a build.
    s.newcomerTimer = Math.min(s.newcomerTimer + dt, interval)
    return
  }
  s.newcomerTimer += dt
  while (s.newcomerTimer >= interval && population(s) < housing) {
    s.newcomerTimer -= interval
    const id = addVillager(s)
    if (id) {
      const v = s.villagers[id]
      pushLog(s, `${v.name} the ${speciesSingular(v.species)} arrived at the hearth.`, 'good')
    }
  }
}
