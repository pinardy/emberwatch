import { COMMISSIONS } from '../content/commissions'
import { RUN_MODIFIERS } from '../content/runModifiers'
import type { EnvoyState, ReputationProfile, ReputationSource, RunState } from '../types'
import { population } from './queries'
import { pushLog } from './runLog'
import { recordEvent } from './timeline'

/*
 * Reputation: what each source pays on this land, and the one place a point
 * of it is granted.
 *
 * Every land (run modifier) and commission may carry a reputation profile — a
 * multiplier per source ("here the Queen values cleared glades ×2"). They
 * multiply together. Each source asks `reputationFor` what its base amount is
 * worth here, so the cards, the log and the grant always agree, and hands the
 * result to `gainReputation`, which tallies it by source and, once the
 * maximum is reached, sends the envoy and banks the rest as Glory.
 */

/** Every source, in the order the profile and the ledger list them. */
export const REPUTATION_SOURCES: ReputationSource[] = [
  'orders',
  'decrees',
  'glades',
  'events',
  'resolve',
  'trade',
  'errands',
]

/** How a source reads on a card: "cleared glades ×2". */
export const REPUTATION_SOURCE_LABEL: Record<ReputationSource, string> = {
  orders: 'completed orders',
  decrees: 'royal decrees',
  glades: 'reclaimed land',
  events: 'glade events',
  resolve: 'contented villagers',
  trade: 'caravan trade',
  errands: 'errands',
}

/** The profile of a land, a commission, or several stacked: multipliers multiply. */
export function combineProfiles(profiles: (ReputationProfile | undefined)[]): ReputationProfile {
  const out: ReputationProfile = {}
  for (const p of profiles) {
    if (!p) continue
    for (const source of REPUTATION_SOURCES) {
      const m = p[source]
      if (m === undefined) continue
      out[source] = (out[source] ?? 1) * m
    }
  }
  return out
}

/** What the Queen values on this run: its lands' and its commission's profiles together. */
export function runReputationProfile(
  s: Pick<RunState, 'runModifiers' | 'commission'>,
): ReputationProfile {
  return combineProfiles([
    ...(s.runModifiers ?? []).map((id) => RUN_MODIFIERS[id]?.reputation),
    s.commission ? COMMISSIONS[s.commission]?.reputation : undefined,
  ])
}

/**
 * The multiplier on `source` this run. Trade is the exception: it pays
 * nothing unless a profile names it.
 */
export function reputationMultiplier(
  s: Pick<RunState, 'runModifiers' | 'commission'>,
  source: ReputationSource,
): number {
  const m = runReputationProfile(s)[source]
  return m ?? (source === 'trade' ? 0 : 1)
}

/** What `base` reputation from `source` is worth on this run. */
export function reputationFor(
  s: Pick<RunState, 'runModifiers' | 'commission'>,
  source: ReputationSource,
  base: number,
): number {
  return base * reputationMultiplier(s, source)
}

/** "×2", "×0.75", "×1.5": a multiplier as a card shows it. */
export function formatMultiplier(m: number): string {
  return `×${Number(m.toFixed(2))}`
}

/** A reputation amount as the log and the cards show it: "1", "1.5", "0.75". */
export function formatReputation(n: number): string {
  return String(Number(n.toFixed(2)))
}

/**
 * The profile in words, sources that differ from the usual only:
 * ["reclaimed land ×2", "completed orders ×0.75", "caravan trade pays"].
 */
export function describeProfile(profile: ReputationProfile): string[] {
  const out: string[] = []
  for (const source of REPUTATION_SOURCES) {
    const m = profile[source]
    if (m === undefined || (source !== 'trade' && Math.abs(m - 1) < 1e-9)) continue
    if (source === 'trade') {
      if (m > 0) out.push(m === 1 ? 'caravan trade' : `caravan trade ${formatMultiplier(m)}`)
      continue
    }
    out.push(`${REPUTATION_SOURCE_LABEL[source]} ${formatMultiplier(m)}`)
  }
  return out
}

/**
 * Grants `amount` reputation from `source` — already worth what this run's
 * profile says (see `reputationFor`). Whole points fill the meter (fractions
 * carry in `reputationProgress`); once it is full the envoy sets out and
 * anything more is Glory. A negative amount (a glade event's price) comes off
 * the whole points and is not tallied.
 */
export function gainReputation(s: RunState, amount: number, source: ReputationSource): void {
  if (!(amount > 0)) {
    if (amount < 0) s.reputation = Math.max(0, s.reputation + amount)
    return
  }
  const by = (s.reputationBy ??= {})
  by[source] = (by[source] ?? 0) + amount
  if (s.envoy) {
    s.envoy.glory += amount
    return
  }
  s.reputationProgress += amount
  while (s.reputationProgress >= 1 - 1e-9 && s.reputation < s.maxReputation) {
    s.reputationProgress = Math.max(0, s.reputationProgress - 1)
    s.reputation += 1
  }
  if (s.reputation >= s.maxReputation) {
    s.reputation = s.maxReputation
    const spill = s.reputationProgress
    s.reputationProgress = 0
    sendEnvoy(s)
    const envoy = s.envoy as EnvoyState | undefined
    if (envoy && spill > 1e-9) envoy.glory += spill
  }
}

/**
 * Reputation has reached the maximum: the Queen's envoy sets out. Only the
 * state is set here — when she arrives and what the forest does meanwhile
 * are `climax.ts`'s, stepped by the tick.
 */
export function sendEnvoy(s: RunState): void {
  if (s.envoy || s.phase !== 'playing') return
  s.envoy = {
    setOutAt: s.clock,
    year: s.season.year,
    population: population(s),
    finalStorm: false,
    coldSeconds: 0,
    unrestSeconds: 0,
    glory: 0,
  }
  recordEvent(s, 'envoy')
  pushLog(
    s,
    'The Queen is satisfied: her envoy sets out to confirm the settlement, and arrives as the next Storm ends. Hold until then — in that Storm the forest makes its last stand.',
    'good',
  )
}
