import type { IconId } from '../../art/icons'
import { IMPATIENCE_STAGNATION_GRACE } from '../engine/balance'
import type { ErrandReward, ResourceCategory, ResourceId } from '../types'

/**
 * Errands: small, concrete, optional tasks the settlement turns up while
 * reputation stands still — something to do while the orders in hand wait on
 * a chain that is not built yet. At most one or two are open at a time, each
 * lasts about a minute, and one left alone simply lapses.
 *
 * Each template names its goal kind and what it is drawn against (a glade
 * being cleared, a construction site, an empty workplace, the caravan); the
 * engine (`engine/errands.ts`) offers only templates the settlement can meet
 * right now, sizes them, and fills in the words.
 */

/** What a template is drawn against, and how its goal is measured. */
export type ErrandSpec =
  /** Carry goods to a glade's clearing crew: the clearing jumps ahead. */
  | { kind: 'deliver'; to: 'clearers'; resource: ResourceId; amount: number }
  /** Send food to a construction site's builders: the site jumps ahead. */
  | { kind: 'deliver'; to: 'builders'; category: ResourceCategory; amount: number }
  /** Keep a good in the stockpile above a mark for `seconds` in all. */
  | { kind: 'hold'; resource: ResourceId; above: number; seconds: number }
  /** Put someone in an empty workplace (or at the hearth) for `seconds`. */
  | { kind: 'staff'; at: 'workplace' | 'hearth'; seconds: number }
  /** Leave `idle` villagers free to build while a site is open. */
  | { kind: 'builders'; idle: number; seconds: number }
  /** Sell a lot to the caravan while it is here. */
  | { kind: 'sell' }
  /** Finish a glade whose clearing was started and left. */
  | { kind: 'finishGlade' }
  /** Raise one more home. */
  | { kind: 'raiseHome' }

export interface ErrandDef {
  id: string
  /** Glyph for plain-text places (the log, toasts). */
  icon: string
  art: IconId
  /**
   * The card's words. `{n}` is the amount, `{good}` the resource, `{place}`
   * the glade or building it is about; all are filled in when it is drawn.
   */
  title: string
  spec: ErrandSpec
  /** Seconds it stays open before it lapses. */
  seconds: number
  reward: ErrandReward
  /** Relative odds among the templates that suit the settlement now. */
  weight: number
}

export const ERRAND_LIST: ErrandDef[] = [
  {
    id: 'haulToClearers',
    icon: '🪵',
    art: 'cart',
    title: 'Carry {n} {good} to the {place} clearers',
    spec: { kind: 'deliver', to: 'clearers', resource: 'wood', amount: 10 },
    seconds: 75,
    reward: { reputation: 0.35 },
    weight: 3,
  },
  {
    id: 'feedBuilders',
    icon: '🧺',
    art: 'bread',
    title: 'Send {n} {good} to the builders at the {place}',
    spec: { kind: 'deliver', to: 'builders', category: 'rawFood', amount: 8 },
    seconds: 75,
    reward: { reputation: 0.3 },
    weight: 3,
  },
  {
    id: 'keepHearth',
    icon: '🪵',
    art: 'ancientHearth',
    title: 'Stack the woodpile: keep {n} {good} in store for a minute',
    spec: { kind: 'hold', resource: 'wood', above: 20, seconds: 60 },
    seconds: 90,
    reward: { reputation: 0.3 },
    weight: 2,
  },
  {
    id: 'staffWorkplace',
    icon: '🧑‍🏭',
    art: 'worker',
    title: 'Staff the {place}',
    spec: { kind: 'staff', at: 'workplace', seconds: 20 },
    seconds: 60,
    reward: { reputation: 0.3 },
    weight: 3,
  },
  {
    id: 'firekeeper',
    icon: '🔥',
    art: 'lantern',
    title: 'Keep a firekeeper at the hearth for 20 seconds',
    spec: { kind: 'staff', at: 'hearth', seconds: 20 },
    seconds: 60,
    reward: { reputation: 0.25 },
    weight: 1,
  },
  {
    id: 'lendBuilders',
    icon: '🔨',
    art: 'scaffold',
    title: 'Have {n} idle villagers help the builders',
    spec: { kind: 'builders', idle: 3, seconds: 30 },
    seconds: 75,
    reward: { reputation: 0.25 },
    weight: 2,
  },
  {
    id: 'sellToCaravan',
    icon: '⚖️',
    art: 'coins',
    title: 'Sell {n} {good} to the caravan',
    spec: { kind: 'sell' },
    seconds: 75,
    reward: { reputation: 0.25 },
    weight: 3,
  },
  {
    id: 'finishGlade',
    icon: '🌲',
    art: 'trees',
    title: 'Finish clearing {place}',
    spec: { kind: 'finishGlade' },
    seconds: 90,
    reward: { reputation: 0.4 },
    weight: 2,
  },
  {
    id: 'raiseHome',
    icon: '🏠',
    art: 'houses',
    title: 'Build or upgrade one more home',
    spec: { kind: 'raiseHome' },
    seconds: 90,
    reward: { reputation: 0.3 },
    weight: 2,
  },
]

export const ERRANDS: Record<string, ErrandDef> = Object.fromEntries(ERRAND_LIST.map((e) => [e.id, e]))

/**
 * When errands turn up. They are tied to the Queen's stagnation count
 * (`secondsSinceReputation` in `society.ts`): most appear once reputation
 * has stood still long enough for her to notice, and only now and then
 * otherwise.
 */
export const ERRAND_PACING = {
  /** No errands in the opening: the first steps and the founding writ come first. */
  firstAt: 240,
  /**
   * Seconds without a reputation point before errands start turning up: the
   * moment the Queen's stagnation impatience starts to climb.
   */
  stallAfter: IMPATIENCE_STAGNATION_GRACE,
  /** A stall this long opens a second slot. */
  secondAfter: 150,
  /** Without a stall, at most one errand in this many seconds. */
  quietGap: 360,
  /** Seconds after an errand is offered or closes before the next is offered. */
  gap: 25,
  /**
   * Errands paying reputation per stall (per stretch since the last whole
   * point); the rest of that stall's errands pay amber instead, so errands
   * nudge a stalled settlement over the line rather than farm the meter.
   */
  reputationPerStall: 2,
  /** A stall this long before an errand pays reputation; earlier ones pay amber. */
  reputationAfter: 90,
  /**
   * The longer the flat stretch, the more a reputation errand pays: its
   * template's reward once more for every this many seconds past
   * `reputationAfter`…
   */
  stallBonusEvery: 75,
  /** …up to this many times over (×3 at most). */
  stallBonusSteps: 2,
  /** Errands pay reputation only while at least this many points short of victory. */
  reputationShortOf: 2,
  /** Amber an errand pays in place of each whole point of reputation. */
  amberPerPoint: 30,
}
