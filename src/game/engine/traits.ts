import { SPECIES, VILLAGER_TRAITS } from '../content/species'
import type {
  Season,
  SpeciesId,
  SpeciesTraitEffect,
  Villager,
} from '../types'

/**
 * Trait lookups — species quirks and personal quirks folded into single
 * multipliers at the places the sim spends, works, builds, and clears.
 */

function speciesEffect<K extends SpeciesTraitEffect['kind']>(
  species: SpeciesId,
  kind: K,
): Extract<SpeciesTraitEffect, { kind: K }> | undefined {
  return SPECIES[species].trait.effects.find(
    (e): e is Extract<SpeciesTraitEffect, { kind: K }> => e.kind === kind,
  )
}

/** True when a cold hearth does not touch this species' resolve. */
export function ignoresColdHearth(species: SpeciesId): boolean {
  return speciesEffect(species, 'ignoreColdHearth') !== undefined
}

/** Multiplier on despair accumulation (humans grind it out). */
export function despairRate(species: SpeciesId): number {
  const e = speciesEffect(species, 'slowDespair')
  return e ? Math.max(0, 1 - e.percent / 100) : 1
}

/** Food one villager eats, relative to the norm. */
export function mealMultiplier(v: Villager): number {
  const e = speciesEffect(v.species, 'mealSize')
  let m = e ? Math.max(0.1, 1 + e.percent / 100) : 1
  if (v.trait) m *= VILLAGER_TRAITS[v.trait].meals ?? 1
  return m
}

/** Build contribution of one idle villager, relative to the norm. */
export function buildMultiplier(v: Villager): number {
  const e = speciesEffect(v.species, 'buildRate')
  let m = e ? 1 + e.percent / 100 : 1
  if (v.trait) m *= VILLAGER_TRAITS[v.trait].build ?? 1
  return m
}

/** Glade-clearing contribution of one villager, relative to the norm. */
export function clearMultiplier(v: Villager): number {
  const e = speciesEffect(v.species, 'clearRate')
  let m = e ? 1 + e.percent / 100 : 1
  if (v.trait) m *= VILLAGER_TRAITS[v.trait].clear ?? 1
  return m
}

/** Personal work-speed multiplier on top of species work bonuses. */
export function workTraitMultiplier(
  v: Villager,
  isGathering: boolean,
  season: Season,
): number {
  if (!v.trait) return 1
  const def = VILLAGER_TRAITS[v.trait]
  let m = def.work ?? 1
  if (isGathering) m *= def.gatherWork ?? 1
  if (season === 'storm') m *= def.stormWork ?? 1
  return m
}

/**
 * Everything one worker brings to a building, relative to an average worker:
 * species work bonuses for the building's tags times the personal quirk. This
 * is the per-villager factor inside `workRate`, exposed so the UI can rank
 * who should work where.
 */
export function workerMultiplier(v: Villager, tags: readonly string[], season: Season): number {
  const bonuses = SPECIES[v.species].workBonus as Record<string, number | undefined>
  let bonus = 0
  for (const tag of tags) bonus += bonuses[tag] ?? 0
  return (1 + bonus) * workTraitMultiplier(v, tags.includes('gathering'), season)
}
