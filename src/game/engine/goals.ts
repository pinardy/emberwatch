import { BUILDINGS } from '../content/buildings'
import { categoryTotal, resourceName } from '../content/resources'
import { SPECIES } from '../content/species'
import type { BuildingCategory, OrderGoal, RunState } from '../types'
import { REFINED_ORDER_HOLD_RATIO } from './balance'
import { gladesBeyond } from './crossings'
import { DEPOSIT_INFO } from './mapgen'
import { averageResolve, totalHousing } from './queries'
import { tierOf } from './upgrades'

/**
 * Goals: what the Queen's orders, royal decrees, lingering conditions and
 * Citadel commissions ask of a settlement, how far along it is, and how each
 * goal reads. Orders and commissions measure a level ("have 30 planks");
 * decrees and conditions count from the moment they begin ("produce 30 more").
 */

// ---------------------------------------------------------------------------
// Goals as levels
// ---------------------------------------------------------------------------

/** "cooked food", "raw food", or the category's name. */
export function categoryWords(category: string): string {
  if (category === 'food') return 'cooked food'
  if (category === 'rawFood') return 'raw food'
  return category
}

/** Human-readable goal, e.g. "Have 30 Planks in the stockpile". */
export function describeGoal(goal: OrderGoal): string {
  switch (goal.kind) {
    case 'stock':
      return `Have ${goal.amount} ${resourceName(goal.resource)} in the stockpile`
    case 'stockCategory':
      return `Have ${goal.amount} ${categoryWords(goal.category)} in the stockpile`
    case 'produced':
      return `Produce ${goal.amount} ${resourceName(goal.resource)} in total`
    case 'producedCategory':
      return `Produce ${goal.amount} ${categoryWords(goal.category)} in total`
    case 'population':
      return `Reach ${goal.amount} villagers`
    case 'housing':
      return `Provide housing for ${goal.amount} villagers`
    case 'buildingsOfCategory':
      return `Build ${goal.amount} ${goal.category} buildings`
    case 'buildingId':
      return `Build ${goal.amount} × ${BUILDINGS[goal.buildingId]?.name ?? goal.buildingId}`
    case 'gladesCleared':
      return `Clear ${goal.amount} glade${goal.amount === 1 ? '' : 's'}`
    case 'resolveAbove':
      return `Raise average resolve to ${goal.value}`
    case 'staffed':
      return goal.category === 'gathering'
        ? `Have ${goal.amount} camps staffed`
        : `Have ${goal.amount} ${goal.category} buildings staffed`
    case 'refinedServed': {
      const sp = SPECIES[goal.species]
      return `Meet the ${sp?.name ?? goal.species}' refined need (${sp?.refined?.name ?? 'a finer good'}) for ${goal.seconds} s`
    }
    case 'gladesBeyond':
      return `Clear ${countOf(goal.amount, 'glade')} ${goal.barrier === 'river' ? 'across the river' : 'beyond the ridge'}`
    case 'depositYield':
      return `Take ${goal.amount} goods from ${DEPOSIT_INFO[goal.deposit]?.name ?? goal.deposit}`
    case 'warmStorm':
      return 'See a whole Storm through with no one sleeping cold'
    case 'trades':
      return `Buy or sell ${countOf(goal.amount, 'lot')} at the caravan`
    case 'dangerousCleared':
      return `Clear ${countOf(goal.amount, 'dangerous glade')}`
    case 'fullyStaffed':
      return `Keep ${goal.buildings} ${categoryNoun(goal.category)}s at full crew for ${goal.seconds} s`
  }
}

/** "a glade", "3 glades". */
function countOf(n: number, noun: string): string {
  return n === 1 ? `a${/^[aeiou]/.test(noun) ? 'n' : ''} ${noun}` : `${n} ${noun}s`
}

/** What one building of a category is called on an order card: "camp", "workshop". */
export function categoryNoun(category: BuildingCategory): string {
  switch (category) {
    case 'gathering':
      return 'camp'
    case 'production':
      return 'workshop'
    case 'service':
      return 'service hall'
    default:
      return `${category} building`
  }
}

/**
 * Goal kinds measured in seconds held (`Order.held`), and how many make the
 * goal; `null` for the rest. A Storm's length is the season's own.
 */
export function heldSeconds(goal: OrderGoal, s: RunState): number | null {
  switch (goal.kind) {
    case 'refinedServed':
    case 'fullyStaffed':
      return goal.seconds
    case 'warmStorm':
      // A whole Storm, less a second for the step that turns the season.
      return s.season.season === 'storm' ? Math.max(1, s.season.length - 1) : Infinity
    default:
      return null
  }
}

/**
 * One more line for an order card about how a goal is met, for the kinds
 * whose words alone do not say (`null` for the rest).
 */
export function goalNote(goal: OrderGoal): string | null {
  switch (goal.kind) {
    case 'refinedServed': {
      const refined = SPECIES[goal.species]?.refined
      return refined
        ? `${refined.hint} Counts while it reaches at least ${Math.round(REFINED_ORDER_HOLD_RATIO * 100)}% of your people.`
        : null
    }
    case 'gladesBeyond':
      return goal.barrier === 'river'
        ? 'Only the fords lead across; glades on the hearth\'s bank do not count.'
        : 'Only the passes lead down; glades on the hearth\'s side of the cliffs do not count.'
    case 'depositYield':
      return DEPOSIT_INFO[goal.deposit]?.note ?? null
    case 'warmStorm':
      return 'Homes beyond the hearth\'s shrinking reach need a brazier or insulation. Anyone sleeping cold starts it over.'
    case 'trades':
      return 'Every lot bought from or sold to a caravan counts.'
    case 'dangerousCleared':
      return 'Dangerous and forbidden glades both count; their events ask harder choices.'
    case 'fullyStaffed':
      return `Counts while ${goal.buildings} of them each have every worker slot filled; the seconds add up.`
    default:
      return null
  }
}

/** Returns 0..1 progress toward the goal. */
export function evaluateGoal(goal: OrderGoal, s: RunState): number {
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  switch (goal.kind) {
    case 'stock':
      return clamp((s.stock[goal.resource] ?? 0) / goal.amount)
    case 'stockCategory':
      return clamp(categoryTotal(s.stock, goal.category) / goal.amount)
    case 'produced':
      return clamp((s.producedTotals[goal.resource] ?? 0) / goal.amount)
    case 'producedCategory':
      return clamp(categoryTotal(s.producedTotals, goal.category) / goal.amount)
    case 'population':
      return clamp(Object.keys(s.villagers).length / goal.amount)
    case 'housing':
      return clamp(totalHousing(s) / goal.amount)
    case 'buildingsOfCategory': {
      const n = Object.values(s.buildings).filter(
        (b) => b.built && BUILDINGS[b.defId]?.category === goal.category,
      ).length
      return clamp(n / goal.amount)
    }
    case 'buildingId': {
      const n = Object.values(s.buildings).filter(
        (b) => b.built && b.defId === goal.buildingId,
      ).length
      return clamp(n / goal.amount)
    }
    case 'gladesCleared':
      return clamp(s.stats.gladesCleared / goal.amount)
    case 'resolveAbove':
      return clamp(averageResolve(s) / goal.value)
    case 'staffed': {
      const n = Object.values(s.buildings).filter(
        (b) => b.built && b.workers.length > 0 && BUILDINGS[b.defId]?.category === goal.category,
      ).length
      return clamp(n / goal.amount)
    }
    // Counted from an order's draw (`goalCount`); as a level, the run's whole count.
    case 'gladesBeyond':
    case 'depositYield':
    case 'trades':
    case 'dangerousCleared':
      return clamp((goalCount(goal, s) ?? 0) / goal.amount)
    // Held goals measure seconds an order has held (`Order.held`); nothing as a level.
    case 'refinedServed':
    case 'warmStorm':
    case 'fullyStaffed':
      return 0
  }
}

// ---------------------------------------------------------------------------
// Goals that count from "now"
// ---------------------------------------------------------------------------

/**
 * The raw count behind a counting goal (lifetime production, buildings
 * standing, glades cleared), or `null` for goals that measure a level.
 * Decrees and conditions measure counting goals relative to a baseline taken
 * when they begin, so "produce 30 planks" means 30 *more*.
 */
export function goalCount(goal: OrderGoal, s: RunState): number | null {
  switch (goal.kind) {
    case 'produced':
      return s.producedTotals[goal.resource] ?? 0
    case 'producedCategory':
      return categoryTotal(s.producedTotals, goal.category)
    case 'gladesCleared':
      return s.stats.gladesCleared
    /*
     * Each finished construction job counts — a new building, or a tier
     * raised on one already standing — so "build 2 more homes" can be met by
     * upgrading two shelters, and a demolished-and-rebuilt site is not free.
     */
    case 'buildingId':
      return constructionCount(s, (defId) => defId === goal.buildingId)
    case 'buildingsOfCategory':
      return constructionCount(s, (defId) => BUILDINGS[defId]?.category === goal.category)
    case 'gladesBeyond': {
      const far = gladesBeyond(s, goal.barrier)
      let n = 0
      for (const id of far) if (s.glades[id]?.cleared) n++
      return n
    }
    case 'depositYield':
      return s.orderTallies?.depositYield?.[goal.deposit] ?? 0
    case 'trades':
      return s.orderTallies?.trades ?? 0
    case 'dangerousCleared':
      return Object.values(s.glades).filter((g) => g.cleared && (g.kind === 'dangerous' || g.kind === 'forbidden')).length
    default:
      return null
  }
}

/** Finished buildings matching `match`, plus every tier they have been raised. */
function constructionCount(s: RunState, match: (defId: string) => boolean): number {
  let n = 0
  for (const b of Object.values(s.buildings)) {
    if (b.built && match(b.defId)) n += 1 + tierOf(b)
  }
  return n
}

/** 0..1 progress toward a goal, counting from `baseline` where it applies. */
export function goalProgress(goal: OrderGoal, s: RunState, baseline: number): number {
  const count = goalCount(goal, s)
  if (count === null) return evaluateGoal(goal, s)
  const amount = 'amount' in goal ? goal.amount : 1
  return Math.max(0, Math.min(1, (count - baseline) / amount))
}

/** Like `describeGoal`, but phrased for goals that count from now. */
export function describeTimedGoal(goal: OrderGoal): string {
  switch (goal.kind) {
    case 'produced':
      return `Produce ${goal.amount} more ${resourceName(goal.resource)}`
    case 'producedCategory':
      return `Produce ${goal.amount} more ${categoryWords(goal.category)}`
    case 'gladesCleared':
      return `Clear ${goal.amount} more glade${goal.amount === 1 ? '' : 's'}`
    case 'buildingId':
      return `Build or upgrade ${goal.amount} more ${BUILDINGS[goal.buildingId]?.name ?? goal.buildingId}`
    case 'buildingsOfCategory':
      return `Build or upgrade ${goal.amount} more ${goal.category} building${goal.amount === 1 ? '' : 's'}`
    default:
      return describeGoal(goal)
  }
}
