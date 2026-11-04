import { CORNERSTONES } from '../content/cornerstones'
import type { BuildingTag, CornerstoneEffect, RunState, SpeciesId } from '../types'

/**
 * Flattened effects from cornerstones, event-granted ongoing effects, and any
 * live threats. Recomputed once per tick (cheap — the lists are short) so the
 * rest of the sim can read plain numbers.
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
  /** Farm speed during the Storm (0 = the default standstill). */
  farmsInStorm: number
  /** Multiplier on hostility gained per glade cleared. */
  gladeHostility: number
  /** Multiplier on hearth fuel burned. */
  hearthFuel: number
  /** Multiplier on passive impatience growth. */
  impatienceRate: number
  /** Multiplier on the newcomer arrival interval (lower = sooner). */
  newcomerRate: number
  /** Multiplier on glade clear loot. */
  gladeLoot: number
  /** Multiplier on caravan asking prices. */
  tradePrices: number
  /** Flat resolve for everyone, applied only during the Storm. */
  stormResolve: number
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
    farmsInStorm: 0,
    gladeHostility: 1,
    hearthFuel: 1,
    impatienceRate: 1,
    newcomerRate: 1,
    gladeLoot: 1,
    tradePrices: 1,
    stormResolve: 0,
  }
}

function foldEffect(m: Modifiers, e: CornerstoneEffect): void {
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
    case 'farmsInStorm':
      // The best greenhouse wins; they do not stack past 100%.
      m.farmsInStorm = Math.min(1, Math.max(m.farmsInStorm, e.percent / 100))
      break
    case 'gladeHostility':
      m.gladeHostility = Math.max(0, m.gladeHostility * (1 + e.percent / 100))
      break
    case 'hearthFuel':
      m.hearthFuel = Math.max(0, m.hearthFuel * (1 + e.percent / 100))
      break
    case 'impatienceRate':
      m.impatienceRate = Math.max(0, m.impatienceRate * (1 + e.percent / 100))
      break
    case 'newcomerRate':
      m.newcomerRate = Math.max(0.25, m.newcomerRate * (1 + e.percent / 100))
      break
    case 'gladeLoot':
      m.gladeLoot = Math.max(0, m.gladeLoot * (1 + e.percent / 100))
      break
    case 'tradePrices':
      m.tradePrices = Math.max(0.25, m.tradePrices * (1 + e.percent / 100))
      break
    case 'stormResolve':
      m.stormResolve += e.amount
      break
  }
}

export function computeModifiers(s: RunState): Modifiers {
  const m = emptyModifiers()
  for (const id of s.cornerstones) {
    const def = CORNERSTONES[id]
    if (!def) continue
    for (const e of def.effects) foldEffect(m, e)
  }
  // Event-granted pacts and curses use the same effect vocabulary.
  for (const ongoing of s.ongoing) {
    for (const e of ongoing.effects) foldEffect(m, e)
  }
  // Threats can weigh on the settlement for as long as they live.
  for (const threat of s.threats) {
    for (const e of threat.whileActive ?? []) foldEffect(m, e)
  }
  // So can lingering glade conditions, until their goal is met.
  for (const condition of s.conditions ?? []) {
    for (const e of condition.whileActive ?? []) foldEffect(m, e)
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
