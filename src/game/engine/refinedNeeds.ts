import { BUILDINGS } from '../content/buildings'
import { SPECIES } from '../content/species'
import type { RefinedNeedDef, ResourceId, RunState, SpeciesId } from '../types'
import { serviceCapacity } from './adjacency'
import { feats } from './feats'
import { SERVICE_COVERAGE_RATIO, canAfford, population, speciesCounts } from './queries'
import { pushLog } from './runLog'
import { recipesOf, tierOf } from './upgrades'

/**
 * Second-tier needs. Once a settlement has grown (Year 3, or a population of
 * `REFINED_FROM_POPULATION`), each species comes to want one of its needs in
 * a finer form: a better good handed out at the venue — the humans' spiced
 * ale, the beavers' blueprint folios, incense at the harpies' baths (a
 * def may also ask for the venue raised a tier, `venueTier`). Meeting it
 * pays resolve on top of the base need and gives back part of the rising
 * expectations; missing it costs nothing — the base need still pays in full.
 *
 * Every form is a good with no other use, on purpose. In the balance harness
 * a venue tier as the refined form lifted the bot's win rate ~9 points on the
 * extra capacity alone, and parts as the beavers' good ~6 more by feeding
 * upgrades and "ship parts" orders — before any refined resolve. The two new
 * goods (spiced ale, blueprint folios) and the existing ones chosen
 * (incense, jerky, porridge) move it about a point.
 *
 * Pure reads plus one step (`stepRefinedNeeds`) that burns the finer goods
 * and keeps the run's achievement bookkeeping.
 */

/** Refined needs wake from the start of this year… */
export const REFINED_FROM_YEAR = 3
/** …or as soon as the settlement is this large, whichever comes first. */
export const REFINED_FROM_POPULATION = 20
/** Resolve a fully met refined need adds on top of its base need. */
export const RESOLVE_REFINED_NEED = 2
/**
 * Share of the rising expectations (`expectations` in society.ts) a fully met
 * refined need gives back. Never more than a met base need costs in them, so
 * the term is a pure bonus.
 */
export const REFINED_EXPECTATION_RELIEF = 0.15
/** Each serving venue burns one finer good every this many seconds. */
export const REFINED_GOOD_SECONDS = 30

/** True once species want their refined needs (see the constants above). */
export function refinedUnlocked(s: RunState, pop = population(s)): boolean {
  return s.season.year >= REFINED_FROM_YEAR || pop >= REFINED_FROM_POPULATION
}

/** The refined form of `sp`'s needs, if it has one. */
export function refinedNeedOf(sp: SpeciesId): RefinedNeedDef | undefined {
  return SPECIES[sp]?.refined
}

/**
 * Venues serving `def.need` that also meet its refined form right now: open,
 * staffed, supplied with their own good (as `serviceCoverage` requires), at
 * the tier asked, and holding the finer good.
 */
function refinedVenues(s: RunState, def: RefinedNeedDef) {
  const hasGood = !def.good || (s.stock[def.good] ?? 0) >= 1
  if (!hasGood) return []
  return Object.values(s.buildings).filter((b) => {
    const venue = BUILDINGS[b.defId]
    if (!b.built || b.paused || venue?.service?.need !== def.need) return false
    if (b.workers.length === 0 || tierOf(b) < (def.venueTier ?? 0)) return false
    const recipe = recipesOf(b)[0]
    return !recipe || canAfford(s.stock, recipe.inputs)
  })
}

/** Villagers the venues meeting `def` can serve. */
export function refinedCapacity(s: RunState, def: RefinedNeedDef): number {
  return refinedVenues(s, def).reduce((sum, b) => sum + serviceCapacity(s, b), 0)
}

/** Where a species' refined need stands, for the resolve breakdown and the UI. */
export interface RefinedStatus {
  def: RefinedNeedDef
  /** The settlement is grown enough for it to matter. */
  unlocked: boolean
  /** 0..1 share of the population the qualifying venues reach. */
  ratio: number
  /**
   * Every base need of the species is met, so the refined one can pay
   * (set by `resolveBreakdowns`; true when read on its own).
   */
  basicsMet: boolean
  met: boolean
  capacity: number
  required: number
}

export function refinedStatus(
  s: RunState,
  sp: SpeciesId,
  pop = population(s),
): RefinedStatus | null {
  const def = refinedNeedOf(sp)
  if (!def) return null
  const unlocked = refinedUnlocked(s, pop)
  const required = Math.max(1, pop * SERVICE_COVERAGE_RATIO)
  const capacity = refinedCapacity(s, def)
  const ratio = Math.min(1, capacity / required)
  const met = ratio >= 1
  return { def, unlocked, ratio, basicsMet: true, met, capacity, required: Math.ceil(required) }
}

/**
 * The resolve a refined need adds: a flat bonus plus part of what the
 * species owes rising expectations, in proportion to its reach. Zero until
 * unlocked, zero until the species' base needs are all met (refinement comes
 * after the basics), and never negative.
 */
export function refinedResolve(status: RefinedStatus | null, owed: number): number {
  if (!status?.unlocked || !status.basicsMet || status.ratio <= 0) return 0
  return status.ratio * (RESOLVE_REFINED_NEED + REFINED_EXPECTATION_RELIEF * Math.max(0, owed))
}

/** Log line when species first want their refined needs. */
export const REFINED_UNLOCKED_LOG =
  'Your villagers have grown particular: each people now hopes for a finer form of one need. See the People panel.'

/**
 * Burns the finer goods at the venues serving a refined need, and notes in
 * the run's feats which species had theirs fully met (and whether all did at
 * once). `statuses` are this tick's, from `resolveBreakdowns`.
 */
export function stepRefinedNeeds(
  s: RunState,
  dt: number,
  statuses: { species: SpeciesId; refined: RefinedStatus | null }[],
): void {
  const pop = population(s)
  if (!refinedUnlocked(s, pop) || pop === 0) return
  const f = feats(s)
  if (f.refinedFrom === undefined) {
    f.refinedFrom = s.clock
    pushLog(s, REFINED_UNLOCKED_LOG, 'info')
  }
  const counts = speciesCounts(s)
  const burned = new Set<string>()
  let all = true
  let any = false
  for (const { species, refined } of statuses) {
    if (!refined || counts[species] <= 0) continue
    any = true
    if (refined.met && refined.basicsMet) {
      if (!f.refinedMet?.includes(species)) f.refinedMet = [...(f.refinedMet ?? []), species]
    } else {
      all = false
    }
    const good = refined.def.good
    if (!good || refined.ratio <= 0) continue
    const key = `${refined.def.need}:${good}`
    if (burned.has(key)) continue
    burned.add(key)
    burnGood(s, good, (refinedVenues(s, refined.def).length * dt) / REFINED_GOOD_SECONDS)
  }
  if (any && all) f.refinedAll = true
}

function burnGood(s: RunState, good: ResourceId, amount: number): void {
  const left = (s.stock[good] ?? 0) - amount
  if (left <= 0.0001) delete s.stock[good]
  else s.stock[good] = left
}
