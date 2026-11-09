import { BUILDINGS } from '../content/buildings'
import { ERRANDS, ERRAND_LIST, ERRAND_PACING, type ErrandDef } from '../content/errands'
import { RESOURCES, RESOURCE_LIST, resourceName } from '../content/resources'
import type { BuildingInstance, Errand, ErrandBook, ErrandGoal, ErrandReward, ResourceId, RunState } from '../types'
import { TRADE_LOT } from './balance'
import { evaluateGoal, goalCount, goalProgress } from './goals'
import { computeModifiers } from './modifiers'
import { productionRate } from './forecast'
import { hasLiveDeposit } from './production'
import { canAfford, grant, idleVillagers, population, spend, totalHousing } from './queries'
import { makeRng } from './rng'
import { gainReputation } from './reputation'
import { pushLog } from './runLog'
import { hearthFuelRate, secondsSinceReputation } from './society'
import { sellResource } from './trade'
import { isUpgrading, workerSlotsOf } from './upgrades'
import { assignWorker } from './actions'

/**
 * Errands: small, optional, short-lived tasks for the stretches when
 * reputation stands still — "carry 10 wood to the Thornmere clearers",
 * "staff the cookhouse north of the hearth". The templates are data
 * (`content/errands.ts`); this module draws one the settlement can meet right
 * now, measures it each tick, pays a little reputation (or amber) when it is
 * met, and lets it lapse without penalty when it is not.
 *
 * Errands never stop the clock and never open a dialog: they wait in the
 * Orders panel and on a small HUD chip. They turn up mostly once the Queen's
 * stagnation count (`secondsSinceReputation`) has run past her grace, and
 * only now and then otherwise. Early in a stall they pay a little amber;
 * once it has run long, the first one pays a fraction of a reputation point
 * (never toward the last points of the meter), granted through
 * `gainReputation` as their own source. None are offered while the Queen's
 * envoy rides, and any open one is set aside without cost when she sets out.
 * They draw from their own RNG stream, so drawing one never moves the run's
 * RNG cursor.
 */

/** Salt for the errands' own RNG stream (apart from the run's cursor). */
const ERRAND_STREAM = 0x5eed_e44a

/** Errands open now. */
export function openErrands(s: RunState): Errand[] {
  return s.errands ?? []
}

export function defaultErrandBook(): ErrandBook {
  return { next: 0, lastOffer: 0, cursor: 0, counter: 0, offered: 0, met: 0, lapsed: 0, reputation: 0, amber: 0 }
}

function book(s: RunState): ErrandBook {
  s.errandBook ??= defaultErrandBook()
  return s.errandBook
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** "north of the hearth", "by the hearth": where a spot lies, for errand titles. */
export function whereFromHearth(s: RunState, pos: { x: number; y: number }): string {
  const hearth = s.buildings.hearth?.pos ?? { x: 0, y: 0 }
  const dx = pos.x - hearth.x
  const dy = pos.y - hearth.y
  if (Math.hypot(dx, dy) < 4) return 'by the hearth'
  // The map's y grows southward.
  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI
  const names = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east']
  const index = ((Math.round(angle / 45) % 8) + 8) % 8
  return `${names[index]} of the hearth`
}

/** "+0.35 reputation", "+12 amber". */
export function describeErrandReward(reward: ErrandReward): string {
  const parts: string[] = []
  if (reward.reputation) parts.push(`+${Number(reward.reputation.toFixed(2))} reputation`)
  if (reward.amber) parts.push(`+${reward.amber} amber`)
  return parts.join(', ')
}

function fill(def: ErrandDef, words: { n?: number; good?: ResourceId; place?: string }): string {
  return def.title
    .replace('{n}', String(words.n ?? ''))
    .replace('{good}', words.good ? resourceName(words.good) : '')
    .replace('{place}', words.place ?? '')
}

// ---------------------------------------------------------------------------
// Drawing an errand the settlement can meet now
// ---------------------------------------------------------------------------

/** Building and glade ids open errands are already about. */
function claimed(s: RunState): Set<string> {
  const ids = new Set<string>()
  for (const e of openErrands(s)) {
    if (e.buildingId) ids.add(e.buildingId)
    if (e.gladeId) ids.add(e.gladeId)
  }
  return ids
}

function sites(s: RunState): BuildingInstance[] {
  return Object.values(s.buildings).filter((b) => !b.built)
}

/** A built workplace with room and nobody in it, that would work if staffed. */
function emptyWorkplace(s: RunState, b: BuildingInstance): boolean {
  const def = BUILDINGS[b.defId]
  if (!def || !b.built || b.paused || isUpgrading(b)) return false
  if (!['gathering', 'production', 'service'].includes(def.category)) return false
  if (workerSlotsOf(b) <= 0 || b.workers.length > 0) return false
  const recipe = def.recipes.find((r) => r.id === b.activeRecipeId) ?? def.recipes[0]
  if (recipe?.requiresDeposit && !hasLiveDeposit(s, b, recipe.requiresDeposit)) return false
  return true
}

const roundUp5 = (n: number) => Math.ceil(n / 5) * 5

type Draft = Omit<Errand, 'id' | 'progress' | 'timeLeft' | 'timeLimit' | 'reward' | 'defId'> & { seconds?: number }

/**
 * The errand `def` would be for this settlement now, or null when it does not
 * suit it: nothing to carry it to, not the goods to spare, nobody free.
 * `pick` chooses among several fitting targets.
 */
function draftFor(s: RunState, def: ErrandDef, pick: <T>(items: T[]) => T): Draft | null {
  const spec = def.spec
  const taken = claimed(s)
  const idle = idleVillagers(s).length
  switch (spec.kind) {
    case 'deliver': {
      if (spec.to === 'clearers') {
        const glades = Object.values(s.glades).filter(
          (g) => !g.cleared && g.clearers > 0 && g.clearProgress < g.clearWork * 0.8 && !taken.has(g.id),
        )
        if (glades.length === 0 || (s.stock[spec.resource] ?? 0) < spec.amount + 20) return null
        const glade = pick(glades)
        return {
          title: fill(def, { n: spec.amount, good: spec.resource, place: glade.name }),
          goal: { kind: 'deliver', resource: spec.resource, amount: spec.amount },
          gladeId: glade.id,
        }
      }
      if (s.starving) return null
      const site = sites(s).filter((b) => !taken.has(b.id))
      if (site.length === 0) return null
      const foods = RESOURCE_LIST.filter(
        (r) => r.category === spec.category && (s.stock[r.id] ?? 0) >= spec.amount * 2,
      ).sort((a, b) => (s.stock[b.id] ?? 0) - (s.stock[a.id] ?? 0))
      if (foods.length === 0) return null
      const b = pick(site)
      const good = foods[0].id
      return {
        title: fill(def, { n: spec.amount, good, place: `${BUILDINGS[b.defId]?.name ?? 'site'} site` }),
        goal: { kind: 'deliver', resource: good, amount: spec.amount },
        buildingId: b.id,
      }
    }
    case 'hold': {
      // Not in the Storm: gathering halves and the hearth burns the pile down.
      if (s.season.season === 'storm') return null
      const have = s.stock[spec.resource] ?? 0
      const mods = computeModifiers(s)
      // What the stockpile gains a second after the hearth and braziers burn.
      const net = productionRate(s, mods, spec.resource) - (spec.resource === 'wood' ? hearthFuelRate(s.season.season, mods) : 0)
      if (net <= 0.05) return null
      // A mark half a minute of that surplus away: reachable, then kept.
      const above = Math.max(spec.above, roundUp5(have + net * 30))
      if (above > s.storageCap * 0.5) return null
      return {
        title: fill(def, { n: above, good: spec.resource }),
        goal: { kind: 'hold', goal: { kind: 'stock', resource: spec.resource, amount: above }, seconds: spec.seconds },
        buildingId: 'hearth',
      }
    }
    case 'staff': {
      if (idle < 2) return null
      if (spec.at === 'hearth') {
        const hearth = s.buildings.hearth
        if (!hearth || hearth.workers.length > 0 || taken.has(hearth.id)) return null
        if ((s.stock.herb ?? 0) < 4 || s.hostility < 10) return null
        return {
          title: fill(def, {}),
          goal: { kind: 'staff', buildingId: hearth.id, seconds: spec.seconds },
          buildingId: hearth.id,
        }
      }
      const empty = Object.values(s.buildings).filter((b) => emptyWorkplace(s, b) && !taken.has(b.id))
      if (empty.length === 0) return null
      const b = pick(empty)
      return {
        title: fill(def, { place: `${BUILDINGS[b.defId]?.name ?? 'workplace'} ${whereFromHearth(s, b.pos)}` }),
        goal: { kind: 'staff', buildingId: b.id, seconds: spec.seconds },
        buildingId: b.id,
      }
    }
    case 'builders': {
      if (sites(s).length === 0 || idle >= spec.idle || population(s) < spec.idle + 5) return null
      return {
        title: fill(def, { n: spec.idle }),
        goal: { kind: 'builders', idle: spec.idle, seconds: spec.seconds },
      }
    }
    case 'sell': {
      const caravan = s.caravan
      if (!caravan.here || caravan.timer < 30) return null
      const spare = (id: ResourceId) => id !== 'amber' && (s.stock[id] ?? 0) >= TRADE_LOT + 15
      const goods = (Object.keys(s.stock) as ResourceId[]).filter((id) => RESOURCES[id] && spare(id))
      if (goods.length === 0) return null
      const good = spare(caravan.wants)
        ? caravan.wants
        : goods.sort((a, b) => (s.stock[b] ?? 0) - (s.stock[a] ?? 0))[0]
      return {
        title: fill(def, { n: TRADE_LOT, good }),
        goal: { kind: 'sell', resource: good },
        seconds: Math.min(def.seconds, Math.floor(caravan.timer - 5)),
      }
    }
    case 'finishGlade': {
      if (idle < 2) return null
      const glades = Object.values(s.glades).filter(
        (g) =>
          !g.cleared &&
          !g.spared &&
          g.clearers === 0 &&
          g.clearProgress >= g.clearWork * 0.1 &&
          g.neighbors.some((id) => s.glades[id]?.cleared) &&
          !taken.has(g.id),
      )
      if (glades.length === 0) return null
      const glade = pick(glades)
      return { title: fill(def, { place: glade.name }), goal: { kind: 'clear', gladeId: glade.id }, gladeId: glade.id }
    }
    case 'raiseHome': {
      if (idle < 2 || population(s) < totalHousing(s) - 2) return null
      const home = ['shelter', 'cabin'].find(
        (id) => s.unlockedBuildings.includes(id) && BUILDINGS[id] && canAfford(s.stock, BUILDINGS[id].cost),
      )
      if (!home) return null
      return { title: fill(def, {}), goal: { kind: 'count', goal: { kind: 'buildingsOfCategory', category: 'housing', amount: 1 } } }
    }
  }
}

/** One errand drawn for the settlement now, or null when no template suits it. */
export function drawErrand(s: RunState): Errand | null {
  const b = book(s)
  const rng = makeRng(s.seed ^ ERRAND_STREAM, b.cursor)
  const pick = <T>(items: T[]): T => rng.pick(items)
  const open = new Set(openErrands(s).map((e) => e.defId))
  const fits: { def: ErrandDef; draft: Draft }[] = []
  for (const def of ERRAND_LIST) {
    if (open.has(def.id) || def.id === b.last) continue
    const draft = draftFor(s, def, pick)
    if (draft) fits.push({ def, draft })
  }
  const chosen = fits.length > 0 ? rng.weighted(fits, (f) => f.def.weight) : null
  b.cursor = rng.cursor()
  if (!chosen) return null
  const { def, draft } = chosen
  const { seconds, ...rest } = draft
  const timeLimit = seconds ?? def.seconds
  const errand: Errand = {
    ...rest,
    id: `e${b.counter++}`,
    defId: def.id,
    progress: 0,
    timeLeft: timeLimit,
    timeLimit,
    reward: errandReward(s, def.reward),
  }
  if (errand.goal.kind === 'count') errand.baseline = goalCount(errand.goal.goal, s) ?? 0
  return errand
}

/**
 * What an errand drawn now pays: its template's reward while this stall
 * still has a reputation errand to give and victory is a few points off;
 * otherwise the same in amber. Decided when it is drawn, so the card says
 * what it will pay.
 */
export function errandReward(s: RunState, reward: ErrandReward): ErrandReward {
  if (!reward.reputation) return { ...reward }
  const b = book(s)
  const at = s.reputationRise?.at ?? 0
  const paid = b.stall?.at === at ? b.stall.paid : 0
  const short = s.maxReputation - s.reputation
  const long = secondsSinceReputation(s) >= ERRAND_PACING.reputationAfter
  if (long && paid < ERRAND_PACING.reputationPerStall && short >= ERRAND_PACING.reputationShortOf) {
    b.stall = { at, paid: paid + 1 }
    const reputation = Math.round(reward.reputation * stallBonus(s) * 100) / 100
    return { ...reward, reputation }
  }
  const amber = Math.round(reward.reputation * ERRAND_PACING.amberPerPoint) + (reward.amber ?? 0)
  return { amber }
}

/**
 * How many times its template's reward a reputation errand drawn now pays:
 * once when the stall first runs long, once more for every
 * `stallBonusEvery` seconds after (×3 at most) — so an errand met deep in a
 * flat stretch moves the meter, while the per-stall cap keeps errands a
 * nudge rather than a strategy.
 */
export function stallBonus(s: RunState): number {
  const past = secondsSinceReputation(s) - ERRAND_PACING.reputationAfter
  if (past < 0) return 1
  return 1 + Math.min(ERRAND_PACING.stallBonusSteps, Math.floor(past / ERRAND_PACING.stallBonusEvery))
}

/** True while reputation has stood still long enough for errands to turn up. */
export function errandStall(s: RunState): boolean {
  return secondsSinceReputation(s) >= ERRAND_PACING.stallAfter
}

/** How many errands may be open at once right now. */
export function errandSlots(s: RunState): number {
  return secondsSinceReputation(s) >= ERRAND_PACING.secondAfter ? 2 : 1
}

/**
 * Offers an errand when one is due: never in the opening, never while a
 * choice is waiting (a dialog, an order slot to fill), a short gap after the
 * last one, and — unless reputation has stalled — only now and then.
 */
function maybeOffer(s: RunState): void {
  if (s.clock < ERRAND_PACING.firstAt) return
  const b = book(s)
  if (s.clock < b.next) return
  // An order offer waiting in the Orders panel does not stop the clock, so
  // errands still come; a dialog does.
  if (s.pendingChoices.length > 0) return
  if (openErrands(s).length >= errandSlots(s)) return
  if (!errandStall(s) && s.clock - b.lastOffer < ERRAND_PACING.quietGap) return
  const errand = drawErrand(s)
  if (!errand) {
    b.next = s.clock + 10
    return
  }
  s.errands = [...openErrands(s), errand]
  b.offered++
  b.lastOffer = s.clock
  b.next = s.clock + ERRAND_PACING.gap
  b.last = errand.defId
  pushLog(
    s,
    `${ERRANDS[errand.defId]?.icon ?? '🧺'} An errand: ${errand.title} (${describeErrandReward(errand.reward)}). Optional — see Orders.`,
    'info',
  )
}

// ---------------------------------------------------------------------------
// Measuring, paying, lapsing
// ---------------------------------------------------------------------------

/** Whether a held goal (hold, staff, builders) holds right now. */
function holdsNow(s: RunState, goal: ErrandGoal): boolean {
  switch (goal.kind) {
    case 'hold':
      return evaluateGoal(goal.goal, s) >= 1
    case 'staff': {
      const b = s.buildings[goal.buildingId]
      return !!b && b.built && b.workers.length > 0
    }
    case 'builders':
      return sites(s).length > 0 && idleVillagers(s).length >= goal.idle
    default:
      return false
  }
}

/** 0..1 progress of an open errand, advancing held time by `dt`. */
function measure(s: RunState, e: Errand, dt: number): number {
  const goal = e.goal
  switch (goal.kind) {
    case 'hold':
    case 'staff':
    case 'builders':
      if (holdsNow(s, goal)) e.held = (e.held ?? 0) + dt
      return Math.min(1, (e.held ?? 0) / goal.seconds)
    case 'count':
      return goalProgress(goal.goal, s, e.baseline ?? 0)
    case 'clear': {
      const g = s.glades[goal.gladeId]
      if (!g) return 0
      return g.cleared ? 1 : Math.min(0.99, g.clearProgress / Math.max(1, g.clearWork))
    }
    case 'deliver':
    case 'sell':
      return e.progress
  }
}

/** The thing an errand is about is gone (a building demolished): it cannot be met. */
function orphaned(s: RunState, e: Errand): boolean {
  if (e.goal.kind === 'staff') return !s.buildings[e.goal.buildingId]
  if (e.goal.kind === 'clear') {
    const g = s.glades[e.goal.gladeId]
    return !g || (!!g.spared && !g.cleared)
  }
  if (e.goal.kind === 'deliver' && e.gladeId) return !!s.glades[e.gladeId]?.cleared
  if (e.goal.kind === 'deliver' && e.buildingId) return !!s.buildings[e.buildingId]?.built || !s.buildings[e.buildingId]
  if (e.goal.kind === 'sell') return !s.caravan.here
  return false
}

function pay(s: RunState, e: Errand): void {
  const b = book(s)
  if (e.reward.reputation) {
    gainReputation(s, e.reward.reputation, 'errands')
    b.reputation += e.reward.reputation
  }
  if (e.reward.amber) {
    grant(s.stock, { amber: e.reward.amber })
    b.amber += e.reward.amber
  }
  b.met++
  pushLog(s, `✔️ Errand done — ${e.title}. ${describeErrandReward(e.reward)}.`, 'good')
}

function close(s: RunState, id: string): void {
  s.errands = openErrands(s).filter((e) => e.id !== id)
  const b = book(s)
  b.next = Math.max(b.next, s.clock + ERRAND_PACING.gap)
}

/** Measures every open errand, pays the ones met, lapses the expired, and offers the next. */
export function stepErrands(s: RunState, dt: number): void {
  if (s.phase !== 'playing') return
  // Reputation is full and the envoy rides: errands are done for the run.
  if (s.envoy) {
    if (openErrands(s).length > 0) {
      book(s).lapsed += openErrands(s).length
      s.errands = []
      pushLog(s, 'The envoy is on her way: the open errands are set aside. No harm done.', 'info')
    }
    return
  }
  for (const e of [...openErrands(s)]) {
    e.progress = measure(s, e, dt)
    if (e.progress >= 1) {
      pay(s, e)
      close(s, e.id)
      continue
    }
    e.timeLeft -= dt
    if (e.timeLeft <= 0 || orphaned(s, e)) {
      book(s).lapsed++
      close(s, e.id)
      pushLog(s, `The errand lapsed — ${e.title}. No harm done.`, 'info')
    }
  }
  maybeOffer(s)
}

// ---------------------------------------------------------------------------
// The player's side: hand-overs, sales, letting one go
// ---------------------------------------------------------------------------

/** Why an errand's button cannot be pressed now, or null. Errands met by play have no button. */
export function errandBlocked(s: RunState, e: Errand): string | null {
  if (s.phase !== 'playing') return 'The run is over.'
  if (s.envoy) return 'The envoy is on her way: errands are done.'
  const goal = e.goal
  if (goal.kind === 'deliver') {
    const have = Math.floor(s.stock[goal.resource] ?? 0)
    return have < goal.amount ? `Needs ${goal.amount} ${resourceName(goal.resource)}; you have ${have}.` : null
  }
  if (goal.kind === 'sell') {
    if (!s.caravan.here) return 'The caravan has gone.'
    const have = Math.floor(s.stock[goal.resource] ?? 0)
    return have < TRADE_LOT ? `Needs ${TRADE_LOT} ${resourceName(goal.resource)}; you have ${have}.` : null
  }
  if (goal.kind === 'staff') {
    const b = s.buildings[goal.buildingId]
    if (!b) return 'That building is gone.'
    if (b.workers.length > 0) return `Someone works there: keep them on for ${goal.seconds} s in all.`
    if (idleVillagers(s).length === 0) return 'Nobody is idle: free a villager first.'
    return null
  }
  return 'This errand is met by what the settlement does.'
}

/**
 * True when the errand has a button: a hand-over or a sale (met at once), or
 * a staffing errand's "send a worker" (met once they have worked its time).
 */
export function errandHasAction(e: Errand): boolean {
  return e.goal.kind === 'deliver' || e.goal.kind === 'sell' || e.goal.kind === 'staff'
}

/**
 * Does an errand's button: a hand-over or sale (the goods go or sell, and the
 * errand is met), or sends an idle villager to the workplace a staffing
 * errand names (it is met once they have held it long enough).
 */
export function runErrand(s: RunState, id: string): string | null {
  const e = openErrands(s).find((x) => x.id === id)
  if (!e) return 'That errand is no longer open.'
  const blocked = errandBlocked(s, e)
  if (blocked) return blocked
  const goal = e.goal
  if (goal.kind === 'staff') return assignWorker(s, goal.buildingId)
  if (goal.kind === 'sell') {
    const error = sellResource(s, goal.resource)
    if (error) return error
  } else if (goal.kind === 'deliver') {
    spend(s.stock, { [goal.resource]: goal.amount })
  }
  e.progress = 1
  pay(s, e)
  close(s, e.id)
  return null
}

/** Lets an open errand go: no penalty, and the next waits its usual gap. */
export function dismissErrand(s: RunState, id: string): string | null {
  const e = openErrands(s).find((x) => x.id === id)
  if (!e) return 'That errand is no longer open.'
  book(s).lapsed++
  close(s, id)
  return null
}

/** Drops errands a save could not have made (unknown template, damaged fields), and repairs a damaged book; for migration. */
export function migrateErrands(run: RunState): void {
  const valid = (e: unknown): e is Errand => {
    if (!e || typeof e !== 'object') return false
    const x = e as Partial<Errand>
    return (
      typeof x.id === 'string' &&
      typeof x.defId === 'string' &&
      Object.hasOwn(ERRANDS, x.defId) &&
      typeof x.title === 'string' &&
      !!x.goal &&
      typeof x.goal === 'object' &&
      typeof x.goal.kind === 'string' &&
      [x.progress, x.timeLeft, x.timeLimit].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
      !!x.reward &&
      typeof x.reward === 'object'
    )
  }
  // Absent stays absent (none open), so a save round-trips unchanged.
  if (run.errands !== undefined) {
    if (Array.isArray(run.errands)) run.errands = run.errands.filter(valid)
    else delete run.errands
  }
  const open = run.errands ?? []
  const b = run.errandBook as Partial<ErrandBook> | undefined
  if (b !== undefined) {
    const fields: (keyof ErrandBook)[] = ['next', 'lastOffer', 'cursor', 'counter', 'offered', 'met', 'lapsed', 'reputation', 'amber']
    const ok = typeof b === 'object' && b !== null && fields.every((k) => typeof b[k] === 'number' && Number.isFinite(b[k]))
    const counter = Math.max(0, ...open.map((e) => Number(e.id.slice(1)) + 1).filter(Number.isFinite))
    if (!ok) run.errandBook = { ...defaultErrandBook(), counter, next: run.clock ?? 0 }
  }
}
