import type { IconId } from '../../art/icons'
import type {
  CornerstoneEffect,
  MetaState,
  OrderGoal,
  ReputationProfile,
  ResourceBag,
  RunState,
} from '../types'
import { hashInt, makeRng } from '../engine/rng'
import { achievementUnlocks } from './meta'
import { describeGoal, evaluateGoal } from '../engine/goals'

/**
 * Commissions: what the Citadel sends the next settlement out *for*.
 *
 * Before a run the player may take one of a few commissions the Citadel has
 * on its board. Each changes what the run is about in two halves:
 *
 *  - a **twist** applied when the run is founded, in the vocabulary the rest
 *    of the game already speaks (run-long effects like a pact, a land
 *    modifier, starting stock, hostility, a blueprint or a cornerstone);
 *  - an **objective** judged when the run ends — hold the settlement *and*
 *    meet every term — which pays a share more supplies home.
 *
 * Three commissions are open from the first run. Every other one is opened by
 * a Citadel upgrade (`unlockedBy`), so buying into the tree changes which
 * runs are on offer, not only how many options each run has.
 *
 * Taking no commission is always allowed and founds exactly the run there was
 * before commissions existed. Ids are what saves hold: never rename one.
 */

/** One term of a commission's objective. All must hold, and the run be won. */
export type CommissionTerm =
  /** An order goal, judged as it stands when the run ends. */
  | { kind: 'goal'; goal: OrderGoal; label?: string }
  /** Caravans that called on the settlement. */
  | { kind: 'caravans'; amount: number }
  /** The settlement holds no later than the end of this year. */
  | { kind: 'byYear'; year: number }
  /** At most this many villagers lost. */
  | { kind: 'maxLost'; amount: number }
  /** Royal decrees met in time. */
  | { kind: 'decrees'; amount: number }
  /** The hearth never ran out of wood in a Storm. */
  | { kind: 'warmHearth' }
  /** The Queen's impatience ends at or below this share of her patience. */
  | { kind: 'calmCourt'; share: number }
  /** The forest's hostility ends at or below this. */
  | { kind: 'calmForest'; max: number }

export interface CommissionDef {
  id: string
  name: string
  icon: string
  art: IconId
  /** Who asks, in a few words. */
  patron: string
  /** The twist in one sentence, as the player reads it. */
  twist: string
  /** Run-long effects, recorded in the run like a pact. */
  effects?: CornerstoneEffect[]
  /** Percent change to the whole starting stockpile (negative = less). */
  startStockPercent?: number
  /** Added to (or, negative, taken from) the starting stockpile. */
  startStock?: ResourceBag
  /** Hostility the forest starts at. */
  startHostility?: number
  /** Blueprints unlocked from the start. */
  startBlueprints?: string[]
  /** A map modifier (`RUN_MODIFIERS`) this commission's land always has. */
  land?: string
  /** The Queen lays one rare cornerstone from the pool at the founding. */
  royalCornerstone?: boolean
  terms: CommissionTerm[]
  /** Extra supplies when met, as a percent of the run's own payout. */
  bonusPercent: number
  /** Citadel upgrade that puts this commission on the board; absent = open. */
  unlockedBy?: string
  /** What the Queen values on this commission: multipliers on each reputation source. */
  reputation?: ReputationProfile
}

/*
 * Terms and rewards are tuned against the balance harness's commission sweep,
 * where the bot pursues each commission the way a competent player would: it
 * should meet the objective in roughly 40-75% of the runs it wins, and the
 * fewer runs end won *and* met, the more the commission pays.
 */
const defs: CommissionDef[] = [
  // ---- open from the first run ----------------------------------------------
  {
    id: 'holdFrontier',
    name: 'Hold the Frontier',
    icon: '🐺',
    art: 'charter/wolf',
    patron: "The Wardens' commission",
    twist: 'The forest starts restless (hostility 8), but every glade gives up 40% more loot.',
    startHostility: 8,
    effects: [{ kind: 'gladeLoot', percent: 40 }],
    reputation: { glades: 1.5 },
    terms: [
      { kind: 'goal', goal: { kind: 'gladesCleared', amount: 12 } },
      // 40, not 35, since the envoy's last stand surges the forest at the end.
      { kind: 'calmForest', max: 40 },
    ],
    bonusPercent: 65,
  },
  {
    id: 'lightWagons',
    name: 'Light Wagons',
    icon: '🛒',
    art: 'charter/cart',
    patron: "A quartermaster's wager",
    twist: 'The wagons carry 15% less, but the settlers travel light: builders work 15% faster.',
    startStockPercent: -15,
    effects: [{ kind: 'buildSpeed', percent: 15 }],
    terms: [{ kind: 'maxLost', amount: 0 }, { kind: 'byYear', year: 3 }],
    bonusPercent: 70,
  },
  {
    id: 'royalSurvey',
    name: 'The Royal Survey',
    icon: '🗺️',
    art: 'charter/map',
    patron: "The Queen's cartographers",
    twist: "Glades clear 20% faster, but the Queen wants her maps: impatience grows 10% faster.",
    effects: [
      { kind: 'clearSpeed', percent: 20 },
      { kind: 'impatienceRate', percent: 10 },
    ],
    terms: [{ kind: 'byYear', year: 3 }],
    bonusPercent: 65,
  },

  // ---- opened by Citadel upgrades -------------------------------------------
  {
    id: 'tradeTown',
    name: 'Found a Trade Town',
    icon: '⚖️',
    art: 'charter/tradingPost',
    patron: "The Merchants' Guild",
    twist:
      'The Trading Post blueprint from the start and caravans call 20% more often, but the wagons carry trade amber (+20) instead of timber (−10 wood).',
    startBlueprints: ['tradingPost'],
    startStock: { amber: 20, wood: -10 },
    effects: [{ kind: 'caravanInterval', percent: -20 }],
    reputation: { trade: 1 },
    terms: [
      {
        kind: 'goal',
        goal: { kind: 'buildingId', buildingId: 'tradingPost', amount: 1 },
        label: 'Keep a Trading Post standing',
      },
      { kind: 'caravans', amount: 6 },
    ],
    bonusPercent: 100,
    unlockedBy: 'merchantCharter',
  },
  {
    id: 'queensFavourite',
    name: "The Queen's Favourite",
    icon: '👑',
    art: 'charter/reputation',
    patron: 'A royal summons',
    twist: 'The Queen lays a rare cornerstone at the founding, and expects more for it: impatience grows 20% faster.',
    royalCornerstone: true,
    effects: [{ kind: 'impatienceRate', percent: 20 }],
    reputation: { decrees: 1.5, resolve: 0.75 },
    terms: [{ kind: 'calmCourt', share: 1 / 4 }],
    bonusPercent: 60,
    unlockedBy: 'citadelBlessing',
  },
  {
    id: 'openGates',
    name: 'Open Gates',
    icon: '🛤️',
    art: 'charter/people',
    patron: 'The road wardens',
    twist: 'Newcomers arrive 30% sooner, and every mouth eats 10% more.',
    effects: [
      { kind: 'newcomerRate', percent: -30 },
      { kind: 'foodUpkeep', percent: 10 },
    ],
    reputation: { resolve: 1.25, orders: 0.85 },
    // 23, not 21: the Envoy's approach gives a settlement one more season to grow.
    terms: [{ kind: 'goal', goal: { kind: 'population', amount: 23 } }],
    bonusPercent: 70,
    unlockedBy: 'openRoads',
  },
  {
    id: 'stormWatch',
    name: 'Storm Watch',
    icon: '🏮',
    art: 'charter/lantern',
    patron: "The Wardens' watch",
    twist:
      'The land always has Long Storms (25% longer, a bountiful Clearance after), and the hearth burns 40% more wood.',
    land: 'longStorms',
    effects: [{ kind: 'hearthFuel', percent: 40 }],
    // 25, not 20, since the envoy's last stand surges the forest at the end.
    terms: [{ kind: 'warmHearth' }, { kind: 'calmForest', max: 25 }],
    bonusPercent: 50,
    unlockedBy: 'wardensWrit',
  },
  {
    id: 'royalWorks',
    name: 'Royal Works',
    icon: '📯',
    art: 'charter/horn',
    patron: 'The Charter Office',
    twist: 'Decrees allow 15% less time and a miss stings 25% more, but each decree met pays +1 reputation.',
    effects: [
      { kind: 'decreeTime', percent: -15 },
      { kind: 'decreeMissPenalty', percent: 25 },
      { kind: 'decreeReputation', amount: 1 },
    ],
    // 4, not 3: the Envoy's approach leaves time for one more decree.
    terms: [{ kind: 'decrees', amount: 4 }],
    bonusPercent: 70,
    unlockedBy: 'charterOffice',
  },
  {
    id: 'deepWorks',
    name: 'The Deep Works',
    icon: '⚒️',
    art: 'charter/forge',
    patron: "The Masons' guild",
    twist:
      'The land always has Rich Veins and the guild sends Copper Mine and Smelter plans, but the digging wakes the forest: hostility rises 10% faster.',
    land: 'richVeins',
    startBlueprints: ['copperMine', 'smelter'],
    effects: [{ kind: 'hostilityRate', percent: 10 }],
    terms: [{ kind: 'goal', goal: { kind: 'produced', resource: 'copperBar', amount: 40 } }],
    bonusPercent: 80,
    unlockedBy: 'masonsArchive',
  },
]

export const COMMISSIONS: Record<string, CommissionDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
)

export const COMMISSION_LIST = defs

/** Commissions on offer before each run (fewer while fewer are open). */
export const COMMISSION_OFFER_SIZE = 3

/**
 * Commissions the Citadel's upgrades have put on the board, in list order —
 * plus any in `opened`, put there early by a style achievement.
 */
export function unlockedCommissions(
  upgrades: readonly string[],
  opened: readonly string[] = [],
): CommissionDef[] {
  return defs.filter(
    (d) => !d.unlockedBy || upgrades.includes(d.unlockedBy) || opened.includes(d.id),
  )
}

/** The board for a Citadel: its upgrades and the commissions its achievements opened. */
export function boardFor(
  meta: Pick<MetaState, 'upgrades'> & Partial<Pick<MetaState, 'achievements'>>,
): CommissionDef[] {
  const opened = achievementUnlocks(meta.achievements?.unlocked).commissions
  return unlockedCommissions(meta.upgrades, opened)
}

/** Commissions an upgrade puts on the board, for its card in the tree. */
export function commissionsOpenedBy(upgradeId: string): CommissionDef[] {
  return defs.filter((d) => d.unlockedBy === upgradeId)
}

/** Salt for the offer's own stream, so it never touches a run's RNG. */
const OFFER_STREAM = 0x636f6d6d

/**
 * The commissions on offer for the next settlement: up to three from the
 * open board, drawn afresh after every finished run. A commission the player
 * has opened but never taken is always among them, so buying the upgrade that
 * opens one shows it at once. Deterministic: the same Citadel and ledger
 * always offer the same three.
 */
export function commissionOffer(
  meta: Pick<MetaState, 'upgrades' | 'runsWon' | 'runsLost' | 'history'> &
    Partial<Pick<MetaState, 'achievements'>>,
): string[] {
  const pool = boardFor(meta)
  if (pool.length <= COMMISSION_OFFER_SIZE) return pool.map((d) => d.id)
  const taken = new Set(meta.history.map((e) => e.commission?.id).filter(Boolean))
  const round = Math.max(0, meta.runsWon) + Math.max(0, meta.runsLost)
  const rng = makeRng(hashInt((round ^ OFFER_STREAM) >>> 0, 0), 0)
  const fresh = pool.filter((d) => d.unlockedBy && !taken.has(d.id))
  const picked: CommissionDef[] = fresh.length > 0 ? [rng.pick(fresh)] : []
  const rest = pool.filter((d) => !picked.includes(d))
  picked.push(...rng.sample(rest, COMMISSION_OFFER_SIZE - picked.length))
  // Shown in board order, whatever order they were drawn in.
  return pool.filter((d) => picked.includes(d)).map((d) => d.id)
}

// ---------------------------------------------------------------------------
// Judging a commission
// ---------------------------------------------------------------------------

export type TermState = 'met' | 'open' | 'failed'

export interface TermStatus {
  label: string
  state: TermState
  /** Where it stands, in a few words ("7/12", "Year 2", "none lost"). */
  detail: string
}

export interface CommissionVerdict {
  def: CommissionDef
  /** "Hold the settlement" first, then the commission's own terms. */
  terms: TermStatus[]
  /** Judged: the run has ended. */
  final: boolean
  /** The run was won and every term held. Only ever true once `final`. */
  met: boolean
}

/** The term in words, as the cards and the end screen list it. */
export function describeTerm(term: CommissionTerm): string {
  switch (term.kind) {
    case 'goal':
      return term.label ?? describeGoal(term.goal)
    case 'caravans':
      return `Welcome ${term.amount} caravans`
    case 'byYear':
      return `Do it by the end of Year ${term.year}`
    case 'maxLost':
      return term.amount === 0
        ? 'Lose no villagers'
        : `Lose no more than ${term.amount} villager${term.amount === 1 ? '' : 's'}`
    case 'decrees':
      return `Meet ${term.amount} royal decrees`
    case 'warmHearth':
      return 'Never let the hearth go cold in a Storm'
    case 'calmCourt':
      return `End with the Queen's impatience at ${Math.round(term.share * 100)}% or less`
    case 'calmForest':
      return `End with the forest's hostility at ${term.max} or less`
  }
}

function goalTarget(goal: OrderGoal): number {
  return 'amount' in goal ? goal.amount : 'value' in goal ? goal.value : 1
}

/** A count against a target: met at the target, else open (or failed once judged). */
function counted(have: number, need: number, final: boolean): Pick<TermStatus, 'state' | 'detail'> {
  const n = Math.floor(have)
  return {
    state: n >= need ? 'met' : final ? 'failed' : 'open',
    detail: `${Math.min(n, need)}/${need}`,
  }
}

/** A rule that must hold all run: kept while playing, met once judged. */
function guard(holds: boolean, final: boolean, detail: string): Pick<TermStatus, 'state' | 'detail'> {
  return { state: !holds ? 'failed' : final ? 'met' : 'open', detail }
}

export function termStatus(term: CommissionTerm, run: RunState): TermStatus {
  const final = run.phase !== 'playing'
  const label = describeTerm(term)
  switch (term.kind) {
    case 'goal': {
      const need = goalTarget(term.goal)
      return { label, ...counted(evaluateGoal(term.goal, run) * need + 1e-9, need, final) }
    }
    case 'caravans':
      return { label, ...counted(run.caravan?.visits ?? 0, term.amount, final) }
    case 'byYear': {
      const year = run.season.year
      if (year > term.year) return { label, state: 'failed', detail: `Year ${year}` }
      const state: TermState = !final ? 'open' : run.phase === 'won' ? 'met' : 'failed'
      return { label, state, detail: `Year ${year} of ${term.year}` }
    }
    case 'maxLost': {
      const lost = run.stats.villagersLost
      return { label, ...guard(lost <= term.amount, final, lost === 0 ? 'none lost' : `${lost} lost`) }
    }
    case 'decrees':
      return { label, ...counted(run.feats?.decreesMet ?? 0, term.amount, final) }
    case 'warmHearth': {
      const cold = run.feats?.hearthWentCold === true
      return { label, ...guard(!cold, final, cold ? 'went cold' : 'kept burning') }
    }
    case 'calmCourt': {
      const limit = Math.floor(run.maxImpatience * term.share)
      const now = Math.floor(run.impatience)
      const calm = now <= limit
      // Impatience can be soothed back down, so it is only failed once judged.
      const state: TermState = calm ? (final ? 'met' : 'open') : final ? 'failed' : 'open'
      return { label, state, detail: `${now}/${limit}` }
    }
    case 'calmForest': {
      const now = Math.floor(run.hostility)
      // A firekeeper's offerings can calm it again, so this too waits for the end.
      const state: TermState = now <= term.max ? (final ? 'met' : 'open') : final ? 'failed' : 'open'
      return { label, state, detail: `${now}/${term.max}` }
    }
  }
}

/** The run's commission and how it stands, or null when it has none. */
export function judgeCommission(run: RunState): CommissionVerdict | null {
  const def = run.commission ? COMMISSIONS[run.commission] : undefined
  if (!def) return null
  const final = run.phase !== 'playing'
  const hold: TermStatus = {
    label: 'Hold the settlement',
    state: run.phase === 'won' ? 'met' : run.phase === 'lost' ? 'failed' : 'open',
    detail: `${run.reputation}/${run.maxReputation} reputation`,
  }
  const terms = [hold, ...def.terms.map((t) => termStatus(t, run))]
  return { def, terms, final, met: final && terms.every((t) => t.state === 'met') }
}
