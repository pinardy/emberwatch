import { feats } from './feats'
import { BLUEPRINT_POOL, BUILDINGS, BUILDING_LIST } from '../content/buildings'
import { CHARTERS, CHARTER_LIST } from '../content/charters'
import { DECREES, DECREE_LIST } from '../content/decrees'
import { describeGoal, evaluateGoal } from '../content/orders'
import { RESOURCES, resourceName } from '../content/resources'
import type {
  ActiveCondition,
  ConditionOutcome,
  ConditionSpec,
  OrderGoal,
  PendingChoice,
  RunState,
} from '../types'
import {
  CHARTER_REPUTATION,
  DECREE_FIRST_DELAY,
  DECREE_INTERVAL,
  DECREE_MAX_START_PROGRESS,
  DECREE_MISS_ESCALATION,
  DECREE_MISS_IMPATIENCE,
  IMPATIENCE_PER_VILLAGER_LOST,
} from './balance'
import { pushLog } from './runLog'
import { relevantBlueprints, unleashThreat } from './events'
import { computeModifiers } from './modifiers'
import { grant, spend, storageUsed } from './queries'
import { makeRng } from './rng'
import { tierOf } from './upgrades'
import { addImpatience, addReputation, removeVillager } from './society'
import { recordEvent } from './timeline'

/**
 * Mid-run structure: the beats that give the middle of a run its shape.
 *
 *  - **Royal decrees** — a timed Queen's order on a cadence. Meet it in time
 *    for a richer reward; miss it and her patience frays.
 *  - **The Queen's charter** — a one-time, run-shaping pick at a reputation
 *    milestone.
 *  - **Lingering conditions** — glade-event aftermaths that weigh on the
 *    settlement until a build-loop goal is met.
 *
 * Everything is declarative data held in `RunState`, and all randomness goes
 * through the run RNG, so saves and seeds replay exactly.
 */

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

/** True when an unlocked building can produce `resource`. */
function canProduce(s: RunState, resource: string): boolean {
  return s.unlockedBuildings.some((id) =>
    BUILDINGS[id]?.recipes.some(
      (r) => ((r.outputs as Record<string, number>)[resource] ?? 0) > 0,
    ),
  )
}

/** Whether the settlement has any route to meeting the goal at all. */
export function goalFeasible(goal: OrderGoal, s: RunState): boolean {
  switch (goal.kind) {
    case 'stock':
    case 'produced':
      return (s.stock[goal.resource] ?? 0) > 0 || canProduce(s, goal.resource)
    case 'stockCategory':
      return Object.values(RESOURCES).some(
        (r) => r.category === goal.category && canProduce(s, r.id),
      )
    case 'buildingId':
      return s.unlockedBuildings.includes(goal.buildingId)
    case 'buildingsOfCategory':
      return BUILDING_LIST.some(
        (b) => b.category === goal.category && s.unlockedBuildings.includes(b.id),
      )
    default:
      return true
  }
}

// ---------------------------------------------------------------------------
// Royal decrees
// ---------------------------------------------------------------------------

/**
 * Impatience the live decree will cost if it lapses now: the base penalty,
 * plus the escalation for every earlier miss not yet made good, scaled by
 * cornerstones and map modifiers. Shared by the sim and the decree card.
 */
export function decreeMissImpatience(s: RunState): number {
  const strikes = s.decreeStrikes ?? 0
  const base = DECREE_MISS_IMPATIENCE + DECREE_MISS_ESCALATION * strikes
  return base * computeModifiers(s).decreeMissPenalty
}

/** Counts down to the next decree, and runs the live one against its deadline. */
export function stepDecree(s: RunState, dt: number): void {
  const decree = s.decree
  if (!decree) {
    s.decreeTimer -= dt
    if (s.decreeTimer <= 0) issueDecree(s)
    return
  }

  const def = DECREES[decree.defId]
  if (!def) {
    s.decree = null
    s.decreeTimer = DECREE_INTERVAL
    return
  }

  decree.progress = goalProgress(def.goal, s, decree.baseline)
  if (decree.progress >= 1) {
    decree.complete = true
    s.stats.ordersCompleted++
    const reputation = Math.max(0, def.reputationReward + computeModifiers(s).decreeReputation)
    addReputation(s, reputation)
    if (def.reward) {
      s.stats.resourcesProduced += grant(s.stock, def.reward, s.storageCap, storageUsed(s))
    }
    s.decreeStrikes = Math.max(0, (s.decreeStrikes ?? 0) - 1)
    recordEvent(s, 'decreeMet', def.name)
    feats(s).decreesMet++
    pushLog(
      s,
      `📯 Decree fulfilled with ${Math.ceil(decree.timeLeft)}s to spare — ${def.name}. +${reputation} reputation.`,
      'good',
    )
    s.decree = null
    s.decreeTimer = DECREE_INTERVAL
    return
  }

  decree.timeLeft -= dt
  if (decree.timeLeft <= 0) {
    const penalty = decreeMissImpatience(s)
    if (penalty > 0) addImpatience(s, penalty)
    s.decreeStrikes = (s.decreeStrikes ?? 0) + 1
    recordEvent(s, 'decreeMissed', def.name)
    pushLog(s, `📯 The decree lapsed unmet — ${def.name}. The Queen is displeased.`, 'bad')
    s.decree = null
    s.decreeTimer = DECREE_INTERVAL
  }
}

/**
 * Issues a decree from the goals the settlement can actually pursue and has
 * not already mostly met. If none qualify, the Queen asks again shortly.
 */
export function issueDecree(s: RunState): boolean {
  const pool = DECREE_LIST.filter(
    (d) =>
      goalFeasible(d.goal, s) &&
      goalProgress(d.goal, s, goalCount(d.goal, s) ?? 0) < DECREE_MAX_START_PROGRESS,
  )
  if (pool.length === 0) {
    s.decreeTimer = 30
    return false
  }
  const rng = makeRng(s.seed, s.rngCursor)
  const def = rng.pick(pool)
  s.rngCursor = rng.cursor()
  const timeLimit = Math.round(def.timeLimit * computeModifiers(s).decreeTime)
  s.decree = {
    id: `d${s.orderCounter++}`,
    defId: def.id,
    progress: 0,
    complete: false,
    timeLeft: timeLimit,
    timeLimit,
    baseline: goalCount(def.goal, s) ?? 0,
  }
  s.decree.progress = goalProgress(def.goal, s, s.decree.baseline)
  pushLog(
    s,
    `📯 Royal decree: ${def.name} — ${describeTimedGoal(def.goal)} within ${Math.round(timeLimit / 60)} minutes.`,
    'info',
  )
  return true
}

/** Fresh-run defaults for the decree fields (also used to upgrade old saves). */
export function defaultDecreeState(): Pick<RunState, 'decree' | 'decreeTimer'> {
  return { decree: null, decreeTimer: DECREE_FIRST_DELAY }
}

// ---------------------------------------------------------------------------
// The Queen's charter
// ---------------------------------------------------------------------------

/** Offers the charter once, the first time reputation reaches the milestone. */
export function checkCharter(s: RunState): void {
  if (s.charterOffered || s.reputation < CHARTER_REPUTATION) return
  if (s.phase !== 'playing' || s.reputation >= s.maxReputation) return
  s.charterOffered = true
  offerCharter(s)
}

/** The blueprint an architect's warrant would grant right now, if any. */
function warrantBlueprint(s: RunState): string | undefined {
  const relevant = relevantBlueprints(s)[0]
  if (relevant) return relevant
  const pool = BLUEPRINT_POOL.filter((id) => !s.unlockedBuildings.includes(id))
  if (pool.length === 0) return undefined
  const rng = makeRng(s.seed, s.rngCursor)
  const pick = rng.pick(pool)
  s.rngCursor = rng.cursor()
  return pick
}

export function offerCharter(s: RunState): void {
  const rng = makeRng(s.seed, s.rngCursor)
  const perks = CHARTER_LIST.filter((c) => c.family === 'perk')
  const patience = CHARTER_LIST.filter((c) => c.family === 'patience')
  const perk = rng.pick(perks)
  const calm = rng.pick(patience)
  s.rngCursor = rng.cursor()

  const options = [perk.id, calm.id]
  const blueprintId = warrantBlueprint(s)
  if (blueprintId) {
    options.push('architectsWarrant')
  } else {
    // Nothing left to unlock: offer a second perk instead.
    const other = perks.find((c) => c.id !== perk.id)
    if (other) options.push(other.id)
  }

  // The Charter Office drafts spares: further perks, in list order after the
  // drawn one, so owning it consumes no extra randomness.
  const spares = s.citadel?.charterOptions ?? 0
  const start = perks.indexOf(perk)
  for (let i = 1; i < perks.length && spares > 0; i++) {
    const next = perks[(start + i) % perks.length]
    if (options.length >= 3 + spares) break
    if (!options.includes(next.id)) options.push(next.id)
  }

  const choice: PendingChoice = { kind: 'charter', options }
  if (blueprintId) choice.blueprintId = blueprintId
  s.pendingChoices.push(choice)
  pushLog(s, `👑 The Queen grants you a charter. Choose how she favours this settlement.`, 'good')
}

/** Keeps a queued warrant pointing at a blueprint that is still locked. */
export function refreshCharterOffer(s: RunState, choice: PendingChoice): void {
  if (!choice.blueprintId || !s.unlockedBuildings.includes(choice.blueprintId)) return
  const next = warrantBlueprint(s)
  if (next) {
    choice.blueprintId = next
  } else {
    delete choice.blueprintId
    choice.options = choice.options.filter((id) => !CHARTERS[id]?.grantsBlueprint)
  }
}

/**
 * Applies the chosen charter (the caller retires the choice). Returns false
 * when `charterId` is not on offer.
 */
export function takeCharter(s: RunState, choice: PendingChoice, charterId: string): boolean {
  const def = CHARTERS[charterId]
  if (!def || !choice.options.includes(charterId)) return false

  if (def.grantsBlueprint) {
    refreshCharterOffer(s, choice)
    const id = choice.blueprintId
    if (!id) return false
    s.unlockedBuildings.push(id)
    const building = BUILDINGS[id]
    if (building) {
      s.stats.resourcesProduced += grant(s.stock, building.cost, s.storageCap, storageUsed(s))
    }
    pushLog(s, `📐 The Royal Architect delivers plans and materials for a ${building?.name ?? id}.`, 'good')
  }
  if (def.maxImpatience) s.maxImpatience += def.maxImpatience
  if (def.impatienceRelief) {
    s.impatience = Math.max(0, s.impatience - def.impatienceRelief)
  }

  s.charter = def.id
  recordEvent(s, 'charter', def.name)
  s.ongoing.push({
    id: `charter_${def.id}`,
    name: def.name,
    icon: def.icon,
    description: def.description,
    effects: def.effects ?? [],
  })
  pushLog(s, `👑 Charter sealed: ${def.name}.`, 'good')
  return true
}

// ---------------------------------------------------------------------------
// Lingering conditions
// ---------------------------------------------------------------------------

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
    addReputation(s, outcome.reputation)
    parts.push(`reputation +${outcome.reputation}`)
  }
  if (outcome.hostility) {
    s.hostility = Math.max(0, s.hostility + outcome.hostility)
    parts.push(`hostility ${outcome.hostility > 0 ? '+' : ''}${outcome.hostility}`)
  }
  if (outcome.impatience) {
    if (outcome.impatience > 0) addImpatience(s, outcome.impatience)
    else s.impatience = Math.max(0, s.impatience + outcome.impatience)
    parts.push(outcome.impatience > 0 ? 'the Queen frets' : 'the Queen is pleased')
  }
  if (outcome.gain) {
    s.stats.resourcesProduced += grant(s.stock, outcome.gain, s.storageCap, storageUsed(s))
    parts.push('supplies arrive')
  }
  if (outcome.villagerLoss) {
    for (let i = 0; i < outcome.villagerLoss; i++) {
      const victim = Object.values(s.villagers)[0]
      if (!victim) break
      removeVillager(s, victim.id)
      s.stats.villagersLost++
      recordEvent(s, 'lost', victim.species)
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

/** Lifts conditions whose goal is met; fails timed ones whose deadline passed. */
export function stepConditions(s: RunState, dt: number): void {
  if (s.conditions.length === 0) return
  const remaining: ActiveCondition[] = []
  // An outcome can start a follow-on condition: it is appended past `n`.
  const all = s.conditions
  const n = all.length
  for (let i = 0; i < n; i++) {
    const condition = all[i]
    const goal = condition.resolveBy
    condition.progress = goalProgress(goal, s, condition.baseline)
    if (condition.progress >= 1) {
      if (condition.consume && goal.kind === 'stock') {
        spend(s.stock, { [goal.resource]: goal.amount })
      }
      const parts = applyOutcome(s, condition.onResolve)
      if (condition.breaksWithStorm) {
        s.stormBlights ??= { forecast: 0, struck: 0, blunted: 0 }
        s.stormBlights.blunted++
        parts.push('turned aside before the Storm')
      }
      pushLog(
        s,
        `${condition.icon} ${condition.name} is lifted${parts.length ? ` — ${parts.join(', ')}` : ''}.`,
        'good',
      )
      continue
    }
    if (condition.timeLeft !== undefined) {
      condition.timeLeft -= dt
      // Storm-bound conditions only count down to the Storm breaking or
      // passing; `tick` settles them then, never on this timer.
      if (condition.breaksWithStorm || condition.passesWithStorm) {
        condition.timeLeft = Math.max(0, condition.timeLeft)
      } else if (condition.timeLeft <= 0) {
        const parts = applyOutcome(s, condition.onFail)
        pushLog(
          s,
          `${condition.icon} ${condition.name} — time ran out${parts.length ? `: ${parts.join(', ')}` : ''}.`,
          'bad',
        )
        continue
      }
    }
    remaining.push(condition)
  }
  s.conditions = all.length > n ? [...remaining, ...all.slice(n)] : remaining
}
