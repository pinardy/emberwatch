import type { RunState } from '../types'
import {
  HOSTILITY_CALM_PER_SPARED_GLADE,
  HOSTILITY_PER_POPULATION,
  HOSTILITY_PER_SECOND,
  HOSTILITY_RATE_PER_CLEARED_GLADE,
  HOSTILITY_SEASON_MULTIPLIER,
  HOSTILITY_YEAR_SCALING,
  SPARED_GLADE_WEIGHT,
} from './balance'
import { population } from './queries'

/**
 * The forest's hostility between storms: its passive growth with the year,
 * the population and the land reclaimed, and the calm of glades left to it.
 * Shared by the tick and the HUD's forecast, so both read the same rate.
 */

/** The hostility meter's ceiling. */
export const MAX_HOSTILITY = 100

/**
 * Passive hostility gained per second right now (before storms, glades and
 * threat strikes). Shared with the HUD so its forecast matches the sim. It
 * grows with the year, the population and every glade reclaimed, and glades
 * left to the forest calm it — enough of them and it falls.
 */
export function hostilityRate(s: RunState, rateMultiplier: number): number {
  return hostilityGrowth(s, rateMultiplier) - sparedGladeCalm(s)
}

/** The forest's passive growth, before glades left to it calm it. */
export function hostilityGrowth(s: RunState, rateMultiplier: number): number {
  const yearScale = 1 + (s.season.year - 1) * HOSTILITY_YEAR_SCALING
  const popScale = 1 + population(s) * HOSTILITY_PER_POPULATION
  const seasonScale = HOSTILITY_SEASON_MULTIPLIER[s.season.season]
  const gladeScale = 1 + s.stats.gladesCleared * HOSTILITY_RATE_PER_CLEARED_GLADE
  return HOSTILITY_PER_SECOND * yearScale * popScale * seasonScale * gladeScale * rateMultiplier
}

/** Hostility per second one spared glade of this kind calms. */
export function sparedGladeCalmOf(kind: keyof typeof SPARED_GLADE_WEIGHT): number {
  return HOSTILITY_CALM_PER_SPARED_GLADE * SPARED_GLADE_WEIGHT[kind]
}

/** Hostility per second calmed by every glade left to the forest. */
export function sparedGladeCalm(s: RunState): number {
  let calm = 0
  for (const g of Object.values(s.glades)) {
    if (g.spared && !g.cleared) calm += sparedGladeCalmOf(g.kind)
  }
  return calm
}

/** Moves hostility on by `dt` seconds of passive growth, within 0..MAX_HOSTILITY. */
export function stepHostility(s: RunState, dt: number, rateMultiplier: number): void {
  const gain = hostilityRate(s, rateMultiplier) * dt
  s.hostility = Math.min(MAX_HOSTILITY, Math.max(0, s.hostility + gain))
}
