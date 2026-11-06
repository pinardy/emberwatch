import { feats } from './feats'
import { BLUEPRINT_POOL, BUILDINGS, BUILDING_LIST } from '../content/buildings'
import { CHARTERS, CHARTER_LIST } from '../content/charters'
import { DECREES, DECREE_LIST } from '../content/decrees'
import { categoryWords, describeGoal, evaluateGoal, producedInCategory } from '../content/orders'
import { RESOURCES, resourceName } from '../content/resources'
import type {
  ActiveCondition,
  ConditionOutcome,
  ConditionSpec,
  DecreeDef,
  OrderGoal,
  PendingChoice,
  ResourceId,
  RoyalDecree,
  RunState,
} from '../types'
import {
  CHARTER_REPUTATION,
  DECREE_FIRST_DELAY,
  DECREE_INTERVAL,
  DECREE_DECLINE_IMPATIENCE,
  DECREE_MAX_SHARE,
  DECREE_MAX_START_PROGRESS,
  DECREE_MIN_SHARE,
  DECREE_MISS_ESCALATION,
  DECREE_MISS_IMPATIENCE,
  DECREE_RATE_SHARE,
  DECREE_STREAK_AMBER,
  DECREE_STREAK_AMBER_CAP,
  IMPATIENCE_PER_VILLAGER_LOST,
} from './balance'
import { pushLog } from './runLog'
import { relevantBlueprints, unleashThreat } from './events'
import { productionRate } from './forecast'
import { computeModifiers, type Modifiers } from './modifiers'
import { DECLINE_CHOICE, takeOrderChoice } from './orders'
import { grant, spend, storageUsed } from './queries'
import { makeRng, type Rng } from './rng'
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
    case 'producedCategory':
      return producedInCategory(s, goal.category)
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

/** The goal a live (or offered) decree is measured against. */
export function decreeGoal(decree: RoyalDecree): OrderGoal | undefined {
  return decree.goal ?? DECREES[decree.defId]?.goal
}

/**
 * What meeting a decree pays on top of its own reward, on a streak of
 * `streak` decrees met in a row (counting this one): a purse from the court
 * that grows with the streak. It pays no reputation — decrees are something
 * an idle economy can farm, so the favour that wins runs stays with services.
 */
export function decreeStreakBonus(streak: number): { reputation: number; amber: number } {
  if (streak < 2) return { reputation: 0, amber: 0 }
  return { reputation: 0, amber: Math.min(DECREE_STREAK_AMBER_CAP, DECREE_STREAK_AMBER * (streak - 1)) }
}

/** "+2 reputation", "the Queen's patience returns (−1 impatience)". */
function decreePayText(def: DecreeDef, reputation: number): string {
  const parts: string[] = []
  if (reputation > 0) parts.push(`+${reputation} reputation`)
  if (def.impatienceRelief) parts.push(`−${def.impatienceRelief} impatience`)
  return parts.join(', ') || 'The Queen is satisfied'
}

/** Counts down to the next decree, and runs the live one against its deadline. */
export function stepDecree(s: RunState, dt: number): void {
  const decree = s.decree
  if (!decree) {
    s.decreeTimer -= dt
    if (s.decreeTimer <= 0) offerDecrees(s)
    return
  }

  const def = DECREES[decree.defId]
  const goal = decreeGoal(decree)
  if (!def || !goal) {
    s.decree = null
    s.decreeTimer = DECREE_INTERVAL
    return
  }

  decree.progress = goalProgress(goal, s, decree.baseline)
  if (decree.progress >= 1) {
    decree.complete = true
    s.stats.ordersCompleted++
    const reputation = Math.max(0, def.reputationReward + computeModifiers(s).decreeReputation)
    addReputation(s, reputation)
    if (def.impatienceRelief) s.impatience = Math.max(0, s.impatience - def.impatienceRelief)
    if (def.reward) {
      s.stats.resourcesProduced += grant(s.stock, def.reward, s.storageCap, storageUsed(s))
    }
    s.decreeStrikes = Math.max(0, (s.decreeStrikes ?? 0) - 1)
    const streak = (s.decreeStreak ?? 0) + 1
    s.decreeStreak = streak
    recordEvent(s, 'decreeMet', def.name)
    feats(s).decreesMet++
    pushLog(
      s,
      `📯 Decree fulfilled with ${Math.ceil(decree.timeLeft)}s to spare — ${def.name}. ${decreePayText(def, reputation)}.`,
      'good',
    )
    const bonus = decreeStreakBonus(streak)
    if (bonus.reputation > 0) {
      addReputation(s, bonus.reputation)
      pushLog(s, `👑 ${streak} decrees met in a row — the Queen's favour. +${bonus.reputation} reputation.`, 'good')
    } else if (bonus.amber > 0) {
      s.stats.resourcesProduced += grant(s.stock, { amber: bonus.amber }, s.storageCap, storageUsed(s))
      pushLog(s, `👑 ${streak} decrees met in a row — a purse from the court. +${bonus.amber} amber.`, 'good')
    }
    s.decree = null
    s.decreeTimer = DECREE_INTERVAL
    return
  }

  decree.timeLeft -= dt
  if (decree.timeLeft <= 0) {
    const penalty = decreeMissImpatience(s)
    if (penalty > 0) addImpatience(s, penalty)
    s.decreeStrikes = (s.decreeStrikes ?? 0) + 1
    s.decreeStreak = 0
    recordEvent(s, 'decreeMissed', def.name)
    pushLog(s, `📯 The decree lapsed unmet — ${def.name}. The Queen is displeased.`, 'bad')
    s.decree = null
    s.decreeTimer = DECREE_INTERVAL
  }
}

/** Units per second of everything in a resource category, from staffed producers. */
function categoryRate(s: RunState, mods: Modifiers, category: string): number {
  let rate = 0
  for (const r of Object.values(RESOURCES)) {
    if (r.category === category) rate += productionRate(s, mods, r.id as ResourceId)
  }
  return rate
}

function categoryStock(s: RunState, category: string): number {
  let sum = 0
  for (const [id, amount] of Object.entries(s.stock)) {
    if (RESOURCES[id as ResourceId]?.category === category) sum += amount ?? 0
  }
  return sum
}

/** Rounds up to an even number: decrees ask for round amounts. */
const evenUp = (n: number) => Math.ceil(n / 2) * 2

/**
 * A decree drawn from `def`, sized to this settlement, or null when it does
 * not suit it now. Production decrees need a staffed producer and ask for
 * about what those producers make over the time limit at their current rate
 * (within a band around the listed amount); expansion decrees need something
 * to build or clear. Either way, nothing already mostly met is decreed.
 */
export function decreeCandidate(
  s: RunState,
  def: DecreeDef,
  mods: Modifiers = computeModifiers(s),
): RoyalDecree | null {
  const timeLimit = Math.round(def.timeLimit * mods.decreeTime)
  let goal: OrderGoal = def.goal
  switch (def.goal.kind) {
    case 'produced': {
      const rate = productionRate(s, mods, def.goal.resource)
      if (rate <= 0) return null
      const listed = def.goal.amount
      const amount = Math.min(
        Math.ceil(listed * DECREE_MAX_SHARE),
        Math.max(Math.ceil(listed * DECREE_MIN_SHARE), evenUp(rate * timeLimit * DECREE_RATE_SHARE)),
      )
      goal = { ...def.goal, amount }
      break
    }
    case 'producedCategory': {
      const rate = categoryRate(s, mods, def.goal.category)
      if (rate <= 0) return null
      const listed = def.goal.amount
      const amount = Math.min(
        Math.ceil(listed * DECREE_MAX_SHARE),
        Math.max(Math.ceil(listed * DECREE_MIN_SHARE), evenUp(rate * timeLimit * DECREE_RATE_SHARE)),
      )
      goal = { ...def.goal, amount }
      break
    }
    case 'stockCategory': {
      const rate = categoryRate(s, mods, def.goal.category)
      if (rate <= 0) return null
      const listed = def.goal.amount
      // Food is eaten as it is cooked, so only a quarter of the output is
      // counted on to stay in the larder.
      const reach =
        categoryStock(s, def.goal.category) + rate * timeLimit * DECREE_RATE_SHARE * 0.25
      const amount = Math.min(
        listed,
        Math.max(Math.ceil(listed * DECREE_MIN_SHARE), evenUp(reach)),
      )
      goal = { ...def.goal, amount }
      break
    }
    case 'gladesCleared': {
      const open = Object.values(s.glades).some(
        (g) => !g.cleared && g.neighbors.some((id) => s.glades[id]?.cleared),
      )
      if (!open) return null
      break
    }
    case 'buildingsOfCategory': {
      const category = def.goal.category
      if (!BUILDING_LIST.some((b) => b.category === category && s.unlockedBuildings.includes(b.id))) {
        return null
      }
      break
    }
    default:
      break
  }
  const baseline = goalCount(goal, s) ?? 0
  const progress = goalProgress(goal, s, baseline)
  if (progress >= DECREE_MAX_START_PROGRESS) return null
  return {
    id: '',
    defId: def.id,
    progress,
    complete: false,
    timeLeft: timeLimit,
    timeLimit,
    baseline,
    ...(goal !== def.goal ? { goal } : {}),
  }
}

/** Production decrees (goods) versus expansion decrees (building, clearing). */
export function isProductionDecree(def: DecreeDef): boolean {
  const kind = def.goal.kind
  return kind === 'produced' || kind === 'producedCategory' || kind === 'stockCategory' || kind === 'stock'
}

/**
 * Up to two decree candidates for the Queen to offer: one production and one
 * expansion when both kinds suit the settlement, otherwise two of one kind.
 */
export function drawDecrees(s: RunState, rng: Rng): RoyalDecree[] {
  const mods = computeModifiers(s)
  const all: { def: DecreeDef; decree: RoyalDecree }[] = []
  for (const def of DECREE_LIST) {
    const decree = decreeCandidate(s, def, mods)
    if (decree) all.push({ def, decree })
  }
  const picks: RoyalDecree[] = []
  const take = (pool: typeof all) => {
    const left = pool.filter((c) => !picks.some((p) => p.defId === c.def.id))
    if (left.length > 0) picks.push(rng.pick(left).decree)
  }
  take(all.filter((c) => isProductionDecree(c.def)))
  take(all.filter((c) => !isProductionDecree(c.def)))
  if (picks.length < 2) take(all)
  for (const decree of picks) decree.id = `d${s.orderCounter++}`
  return picks
}

/**
 * The Queen's next decree arrives as a choice of two. If none suits the
 * settlement, she asks again shortly.
 */
export function offerDecrees(s: RunState): boolean {
  const rng = makeRng(s.seed, s.rngCursor)
  const decrees = drawDecrees(s, rng)
  s.rngCursor = rng.cursor()
  if (decrees.length === 0) {
    s.decreeTimer = 30
    return false
  }
  s.decreeTimer = DECREE_INTERVAL
  s.pendingChoices.push({ kind: 'decree', options: decrees.map((d) => d.id), decrees })
  pushLog(s, '📯 A royal herald arrives: the Queen offers a choice of decrees.', 'info')
  return true
}

/** Makes a decree live and announces it. */
function proclaim(s: RunState, decree: RoyalDecree): void {
  const def = DECREES[decree.defId]
  const goal = decreeGoal(decree)
  if (!def || !goal) return
  s.decree = decree
  decree.progress = goalProgress(goal, s, decree.baseline)
  pushLog(
    s,
    `📯 Royal decree: ${def.name} — ${describeTimedGoal(goal)} within ${Math.round(decree.timeLimit / 60)} minutes.`,
    'info',
  )
}

/**
 * Issues a decree straight away, without offering a choice, from the goals
 * the settlement can actually pursue and has not already mostly met. If none
 * qualify, the Queen asks again shortly.
 */
export function issueDecree(s: RunState): boolean {
  const rng = makeRng(s.seed, s.rngCursor)
  const [decree] = drawDecrees(s, rng)
  s.rngCursor = rng.cursor()
  if (!decree) {
    s.decreeTimer = 30
    return false
  }
  proclaim(s, decree)
  return true
}

/**
 * Applies a pick from a decree offer: the chosen decree goes live, or with
 * `DECLINE_CHOICE` both are turned down for a little of the Queen's patience
 * (and any streak ends). Returns true when the offer is settled.
 */
export function takeDecreeChoice(s: RunState, choice: PendingChoice, optionId: string): boolean {
  if (optionId === DECLINE_CHOICE) {
    addImpatience(s, DECREE_DECLINE_IMPATIENCE)
    s.decreeStreak = 0
    s.decreeTimer = DECREE_INTERVAL
    pushLog(s, '📯 You beg off both decrees. The Queen will remember it.', 'bad')
    return true
  }
  const decree = (choice.decrees ?? []).find((d) => d.id === optionId)
  if (!decree || !choice.options.includes(optionId)) return false
  proclaim(s, decree)
  return true
}

/** Settles an order or decree offer (the caller retires it when true). */
export function takeQueenChoice(s: RunState, choice: PendingChoice, optionId: string): boolean {
  return choice.kind === 'order'
    ? takeOrderChoice(s, choice, optionId)
    : takeDecreeChoice(s, choice, optionId)
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
