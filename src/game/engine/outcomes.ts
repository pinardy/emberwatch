import { RESOURCES } from '../content/resources'
import type { ActiveCondition, ConditionOutcome, ConditionSpec, RunState } from '../types'
import { IMPATIENCE_PER_VILLAGER_LOST } from './balance'
import { goalCount, goalProgress } from './goals'
import { grantProduced, spend } from './queries'
import { pushLog } from './runLog'
import { addImpatience, loseVillager } from './society'
import { formatReputation, gainReputation, reputationFor } from './reputation'
import { unleashThreat } from './threats'

/**
 * Lingering conditions begin here, and what they pay or cost when they end.
 * Glade events, storm blights and the conditions themselves all start one
 * with `addCondition`; `applyOutcome` settles a condition's payout or penalty.
 */

/** Starts a lingering condition left behind by a glade event. */
export function addCondition(s: RunState, spec: ConditionSpec, gladeId: string): ActiveCondition {
  const condition: ActiveCondition = {
    ...spec,
    id: `c${s.conditionCounter++}`,
    gladeId,
    baseline: goalCount(spec.resolveBy, s) ?? 0,
    progress: 0,
    ...(spec.deadline !== undefined ? { timeLeft: spec.deadline } : {}),
  }
  condition.progress = goalProgress(spec.resolveBy, s, condition.baseline)
  s.conditions.push(condition)
  pushLog(s, `${spec.icon} ${spec.name}: ${spec.description}`, 'bad')
  return condition
}

/** Applies a condition's payout or penalty, returning log fragments. */
export function applyOutcome(s: RunState, outcome: ConditionOutcome | undefined): string[] {
  if (!outcome) return []
  const parts: string[] = []
  if (outcome.reputation) {
    const worth = outcome.reputation > 0 ? reputationFor(s, 'events', outcome.reputation) : outcome.reputation
    gainReputation(s, worth, 'events')
    parts.push(`reputation ${worth > 0 ? '+' : ''}${formatReputation(worth)}`)
  }
  if (outcome.hostility) {
    s.hostility = Math.max(0, s.hostility + outcome.hostility)
    parts.push(`hostility ${outcome.hostility > 0 ? '+' : ''}${outcome.hostility}`)
  }
  if (outcome.impatience) {
    addImpatience(s, outcome.impatience)
    parts.push(outcome.impatience > 0 ? 'the Queen frets' : 'the Queen is pleased')
  }
  if (outcome.gain) {
    grantProduced(s, outcome.gain)
    parts.push('supplies arrive')
  }
  if (outcome.villagerLoss) {
    for (let i = 0; i < outcome.villagerLoss; i++) {
      const victim = Object.values(s.villagers)[0]
      if (!victim) break
      loseVillager(s, victim)
      addImpatience(s, IMPATIENCE_PER_VILLAGER_LOST)
      parts.push(`${victim.name} leaves`)
    }
  }
  if (outcome.spoil) {
    const { category, share } = outcome.spoil
    let lost = 0
    for (const [id, amount] of Object.entries(s.stock)) {
      if (RESOURCES[id as keyof typeof RESOURCES]?.category !== category) continue
      const take = Math.floor((amount ?? 0) * share)
      if (take <= 0) continue
      spend(s.stock, { [id]: take })
      lost += take
    }
    if (lost > 0) parts.push(`${lost} ${category === 'rawFood' ? 'food' : 'goods'} spoiled`)
  }
  if (outcome.threat) {
    unleashThreat(s, outcome.threat, '')
    parts.push(`${outcome.threat.name} is loose`)
  }
  if (outcome.condition) {
    const follow = addCondition(s, outcome.condition, '')
    // Damage that lasts "for the Storm" counts down to the Storm's end.
    if (follow.passesWithStorm && s.season.season === 'storm') {
      follow.timeLeft = Math.max(0, s.season.length - s.season.elapsed)
    }
  }
  return parts
}
