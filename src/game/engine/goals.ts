import { BUILDINGS } from '../content/buildings'
import { categoryTotal, resourceName } from '../content/resources'
import type { OrderGoal, RunState } from '../types'
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
