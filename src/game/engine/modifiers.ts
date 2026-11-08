import { CORNERSTONES } from '../content/cornerstones'
import { SEASON_LENGTH } from './balance'
import type { BuildingTag, CornerstoneEffect, RunState, Season, SpeciesId } from '../types'

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
  /** Multiplier on each season's length, every year. */
  seasonLength: Record<Season, number>
  /** Further multiplier on each season's length in Year 1 only. */
  firstYearSeasonLength: Record<Season, number>
  /** Additive work-speed bonus for every workplace, per season. */
  seasonProduction: Record<Season, number>
  /** Caravans call without a Trading Post. */
  caravanWithoutPost: boolean
  /** Multiplier on the time between caravan visits. */
  caravanInterval: number
  /** Extra reputation per completed order. */
  orderReputation: number
  /** Extra reputation per decree met in time. */
  decreeReputation: number
  /** Multiplier on a decree's time limit. */
  decreeTime: number
  /** Multiplier on the impatience a missed decree costs. */
  decreeMissPenalty: number
  /** Multiplier on the wood braziers burn. */
  brazierFuel: number
  /** Multiplier on favourable terrain percentages. */
  terrainBoost: number
  /** Multiplier on unfavourable terrain percentages (0 = ignored). */
  terrainPenalty: number
  /** Multiplier on adjacency work-speed bonuses. */
  adjacencyBoost: number
}

const perSeason = (value: number): Record<Season, number> => ({
  drizzle: value,
  clearance: value,
  storm: value,
})

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
    seasonLength: perSeason(1),
    firstYearSeasonLength: perSeason(1),
    seasonProduction: perSeason(0),
    caravanWithoutPost: false,
    caravanInterval: 1,
    orderReputation: 0,
    decreeReputation: 0,
    decreeTime: 1,
    decreeMissPenalty: 1,
    brazierFuel: 1,
    terrainBoost: 1,
    terrainPenalty: 1,
    adjacencyBoost: 1,
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
    case 'seasonLength': {
      const table = e.firstYearOnly ? m.firstYearSeasonLength : m.seasonLength
      // Seasons never shrink below a third of their length.
      table[e.season] = Math.max(0.35, table[e.season] * (1 + e.percent / 100))
      break
    }
    case 'seasonProduction':
      m.seasonProduction[e.season] += e.percent / 100
      break
    case 'caravanWithoutPost':
      m.caravanWithoutPost = true
      break
    case 'caravanInterval':
      m.caravanInterval = Math.max(0.25, m.caravanInterval * (1 + e.percent / 100))
      break
    case 'orderReputation':
      m.orderReputation += e.amount
      break
    case 'decreeReputation':
      m.decreeReputation += e.amount
      break
    case 'decreeTime':
      m.decreeTime = Math.max(0.25, m.decreeTime * (1 + e.percent / 100))
      break
    case 'decreeMissPenalty':
      m.decreeMissPenalty = Math.max(0, m.decreeMissPenalty * (1 + e.percent / 100))
      break
    case 'brazierFuel':
      m.brazierFuel = Math.max(0, m.brazierFuel * (1 + e.percent / 100))
      break
    case 'terrainBoost':
      m.terrainBoost = Math.max(0, m.terrainBoost * (1 + e.percent / 100))
      break
    case 'terrainPenalty':
      m.terrainPenalty = Math.max(0, m.terrainPenalty * (1 + e.percent / 100))
      break
    case 'adjacencyBoost':
      m.adjacencyBoost = Math.max(0, m.adjacencyBoost * (1 + e.percent / 100))
      break
    case 'hearthReach':
      // Read straight from the run's conditions by `stormReachFloor` (queries),
      // which the warmth checks call far more often than once a tick.
      break
  }
}

/** Length of `season` in `year` once season-length effects apply. */
export function seasonLengthFor(season: Season, year: number, m: Modifiers): number {
  const firstYear = year === 1 ? m.firstYearSeasonLength[season] : 1
  return SEASON_LENGTH[season] * m.seasonLength[season] * firstYear
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
