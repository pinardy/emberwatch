import { CORNERSTONES } from '../content/cornerstones'
import type { BuildingTag, RunState, SpeciesId } from '../types'

/**
 * Flattened cornerstone effects. Recomputed once per tick (cheap — the list is
 * short) so the rest of the sim can read plain numbers.
 */
export interface Modifiers {
  resolveFlat: Record<SpeciesId | 'all', number>
  productionSpeed: Partial<Record<BuildingTag | 'all', number>>
  extraOutput: Partial<Record<BuildingTag | 'all', number>>
  hostilityRate: number
  foodUpkeep: number
  globalStorage: number
  reputationRate: number
  buildSpeed: number
  clearSpeed: number
  needsFewerServices: Record<SpeciesId | 'all', number>
}

export function emptyModifiers(): Modifiers {
  return {
    resolveFlat: { all: 0, human: 0, beaver: 0, lizard: 0, harpy: 0, fox: 0 },
    productionSpeed: {},
    extraOutput: {},
    hostilityRate: 1,
    foodUpkeep: 1,
    globalStorage: 0,
    reputationRate: 1,
    buildSpeed: 1,
    clearSpeed: 1,
    needsFewerServices: { all: 0, human: 0, beaver: 0, lizard: 0, harpy: 0, fox: 0 },
  }
}

export function computeModifiers(s: RunState): Modifiers {
  const m = emptyModifiers()
  for (const id of s.cornerstones) {
    const def = CORNERSTONES[id]
    if (!def) continue
    for (const e of def.effects) {
      switch (e.kind) {
        case 'resolveFlat':
          m.resolveFlat[e.species] += e.amount
          break
        case 'productionSpeed':
          m.productionSpeed[e.tag] = (m.productionSpeed[e.tag] ?? 0) + e.percent / 100
          break
        case 'extraOutput':
          // Chances stack additively; capped when read.
          m.extraOutput[e.tag] = (m.extraOutput[e.tag] ?? 0) + e.chance
          break
        case 'hostilityRate':
          m.hostilityRate *= 1 + e.percent / 100
          break
        case 'foodUpkeep':
          m.foodUpkeep *= 1 + e.percent / 100
          break
        case 'globalStorage':
          m.globalStorage += e.amount
          break
        case 'reputationRate':
          m.reputationRate *= 1 + e.percent / 100
          break
        case 'buildSpeed':
          m.buildSpeed *= 1 + e.percent / 100
          break
        case 'clearSpeed':
          m.clearSpeed *= 1 + e.percent / 100
          break
        case 'needsFewerServices':
          m.needsFewerServices[e.species] += e.amount
          break
      }
    }
  }
  return m
}

/** Multiplier for a building with the given tags. */
export function productionMultiplier(m: Modifiers, tags: BuildingTag[]): number {
  let bonus = m.productionSpeed.all ?? 0
  for (const tag of tags) bonus += m.productionSpeed[tag] ?? 0
  return Math.max(0.1, 1 + bonus)
}

/** Chance (0..0.9) of a doubled output cycle. */
export function extraOutputChance(m: Modifiers, tags: BuildingTag[]): number {
  let chance = m.extraOutput.all ?? 0
  for (const tag of tags) chance += m.extraOutput[tag] ?? 0
  return Math.min(0.9, chance)
}

export function resolveBonusFor(m: Modifiers, species: SpeciesId): number {
  return m.resolveFlat.all + m.resolveFlat[species]
}

export function needsReductionFor(m: Modifiers, species: SpeciesId): number {
  return m.needsFewerServices.all + m.needsFewerServices[species]
}
