import { BUILDINGS } from '../content/buildings'
import { NEED_LABELS } from '../content/species'
import type { RunState, ServiceNeed, SpeciesId } from '../types'
import {
  ARCHITECT_PLANS_GROWTH,
  ARCHITECT_PLANS_PRICE,
  PETITION_AMBER,
  PETITION_BROKEN_IMPATIENCE,
  PETITION_FROM_YEAR,
  PETITION_KEPT_RELIEF,
  PETITION_RELIEF,
  PETITION_VOW_REPUTATION,
  PETITION_VOW_SECONDS,
  PETITION_WITHIN,
  RETREAT_IMPATIENCE_SHARE,
  RETREAT_REPUTATION_SHORT,
} from './balance'
import { chainPieceFor, relevantBlueprints, serviceDemand } from './serviceChains'
import { spend } from './queries'
import { SOOTHE_ENVOY_REFUSAL, sootheCost } from './actions'
import { pushLog } from './runLog'
import { addImpatience } from './society'

/**
 * The player's levers on a run that is going wrong, all paid for:
 *
 *  - **The Queen's Architect** (at the hearth) sells plans — the next
 *    blueprint of a service the settlement needs, named by the player — at a
 *    price that climbs with every set. It is the amber sink every run has,
 *    caravans or not, and the way to steer a draft that keeps missing. (A
 *    redraw toward a named service, on an open draft, is `redrawToward` in
 *    `drafts.ts`.)
 *  - **The Grand Petition**, once per run when the Queen's patience is nearly
 *    spent: a costly plea that buys back impatience on a vow of reputation
 *    within a time limit. Break the vow and her patience snaps back harder.
 *  - **The Retreat to the Citadel**, offered once a run is lost in all but
 *    name: end it now and send home what it has earned, rather than wait for
 *    the Queen's patience to run out.
 */

// ---------------------------------------------------------------------------
// The Queen's Architect
// ---------------------------------------------------------------------------

export interface ArchitectOffer {
  need: ServiceNeed
  /** The blueprint the plans would be for (see `chainPieceFor`). */
  piece: string
  /** The run's species that want this service. */
  species: SpeciesId[]
}

/** Amber for the next set of plans. */
export function architectPrice(s: RunState): number {
  return ARCHITECT_PLANS_PRICE + (s.architectPlans ?? 0) * ARCHITECT_PLANS_GROWTH
}

/**
 * What the architect can draw up: one set of plans per service the run's
 * species want whose chain still has a locked piece — the most useful first
 * (the order the draft ranks pieces in), then the rest by how many species
 * want them.
 */
export function architectOffers(s: RunState): ArchitectOffer[] {
  const ranked = relevantBlueprints(s)
  const rank = (id: string) => {
    const i = ranked.indexOf(id)
    return i < 0 ? ranked.length : i
  }
  const offers: ArchitectOffer[] = []
  for (const [need, species] of serviceDemand(s.speciesPool)) {
    const piece = chainPieceFor(s, need)
    if (piece) offers.push({ need, piece, species })
  }
  return offers.sort((a, b) => rank(a.piece) - rank(b.piece) || b.species.length - a.species.length)
}

/** Why plans cannot be bought right now, or `null`. */
export function architectBlocked(s: RunState, need?: ServiceNeed): string | null {
  if (s.phase !== 'playing') return 'The run is over.'
  if (s.pendingChoices.some((c) => c.kind === 'blueprint')) return 'Finish the open blueprint draft first.'
  const offers = architectOffers(s)
  if (offers.length === 0) return 'Every service your settlers want can already be built.'
  if (need && !offers.some((o) => o.need === need)) return 'Nothing more of that service can be drafted.'
  if ((s.stock.amber ?? 0) < architectPrice(s)) return 'Not enough amber.'
  return null
}

/** Buys the architect's plans for `need`: its next blueprint, unlocked at once. */
export function buyArchitectPlans(s: RunState, need: ServiceNeed): string | null {
  const blocked = architectBlocked(s, need)
  if (blocked) return blocked
  const offer = architectOffers(s).find((o) => o.need === need)
  if (!offer) return 'Nothing more of that service can be drafted.'
  const price = architectPrice(s)
  spend(s.stock, { amber: price })
  s.architectPlans = (s.architectPlans ?? 0) + 1
  s.unlockedBuildings.push(offer.piece)
  pushLog(
    s,
    `📐 The Queen's architect hands over plans for a ${BUILDINGS[offer.piece]?.name ?? offer.piece} (${NEED_LABELS[need]?.name ?? need}), for ${price} amber.`,
    'good',
  )
  return null
}

// ---------------------------------------------------------------------------
// The Grand Petition
// ---------------------------------------------------------------------------

/** Impatience at which the petition opens. */
export function petitionThreshold(s: RunState): number {
  return s.maxImpatience - PETITION_WITHIN
}

/**
 * Why the Grand Petition cannot be made right now, or `null`. `'used'` and
 * `'early'` say it is not on offer at all (the UI hides it); the rest are
 * shortfalls worth showing.
 */
export function petitionBlocked(s: RunState): 'used' | 'early' | 'amber' | null {
  // While the envoy rides the Queen's patience no longer matters: nothing to petition.
  if (s.petition || s.phase !== 'playing' || s.envoy) return 'used'
  if (s.season.year < PETITION_FROM_YEAR) return 'early'
  if (s.impatience + s.impatienceProgress < petitionThreshold(s)) return 'early'
  if ((s.stock.amber ?? 0) < PETITION_AMBER) return 'amber'
  return null
}

/** True while the petition is on offer (affordable or not). */
export function petitionOpen(s: RunState): boolean {
  const blocked = petitionBlocked(s)
  return blocked === null || blocked === 'amber'
}

/**
 * Makes the Grand Petition: pays its price; the Queen forgives
 * `PETITION_RELIEF` impatience and restarts her count of reputation standing
 * still, on a vow of `PETITION_VOW_REPUTATION` reputation within
 * `PETITION_VOW_SECONDS`.
 */
export function grandPetition(s: RunState): string | null {
  const blocked = petitionBlocked(s)
  if (blocked === 'used') return 'The Queen hears one Grand Petition a run.'
  if (blocked === 'early') return 'The Queen will not hear a Grand Petition yet.'
  if (blocked === 'amber') return 'Not enough amber.'
  spend(s.stock, { amber: PETITION_AMBER })
  addImpatience(s, -PETITION_RELIEF)
  // A fresh hearing: the stagnation count starts again from now.
  s.reputationRise = { at: s.clock, level: s.reputation }
  s.petition = {
    at: s.clock,
    deadline: s.clock + PETITION_VOW_SECONDS,
    target: Math.min(s.maxReputation, s.reputation + PETITION_VOW_REPUTATION),
  }
  pushLog(
    s,
    `🕊️ The Queen grants your Grand Petition: −${PETITION_RELIEF} impatience, on your vow of ${PETITION_VOW_REPUTATION} reputation within ${PETITION_VOW_SECONDS / 60} minutes.`,
    'good',
  )
  return null
}

/** Seconds left on a live vow (0 when there is none). */
export function petitionVowLeft(s: RunState): number {
  const p = s.petition
  return p && !p.outcome ? Math.max(0, p.deadline - s.clock) : 0
}

/** Judges a live vow: kept the moment reputation reaches it, broken when time runs out. */
export function stepPetition(s: RunState): void {
  const p = s.petition
  if (!p || p.outcome) return
  if (s.reputation >= p.target) {
    p.outcome = 'kept'
    addImpatience(s, -PETITION_KEPT_RELIEF)
    pushLog(s, `🕊️ Your vow to the Queen is kept. She is gracious: −${PETITION_KEPT_RELIEF} impatience.`, 'good')
  } else if (s.clock >= p.deadline) {
    p.outcome = 'broken'
    addImpatience(s, PETITION_BROKEN_IMPATIENCE)
    pushLog(s, `💢 Your vow to the Queen is broken. Her patience snaps: +${PETITION_BROKEN_IMPATIENCE} impatience.`, 'bad')
  }
}

// ---------------------------------------------------------------------------
// The Retreat to the Citadel
// ---------------------------------------------------------------------------

/** True once the run is lost in all but name, and the Retreat is offered. */
export function retreatOffered(s: RunState): boolean {
  if (s.phase !== 'playing' || s.clock <= 0) return false
  const impatience = s.impatience + s.impatienceProgress
  return (
    impatience >= s.maxImpatience * RETREAT_IMPATIENCE_SHARE &&
    s.maxReputation - s.reputation >= RETREAT_REPUTATION_SHORT
  )
}

/**
 * Retreats to the Citadel: the run ends now, as a loss, and sends home the
 * supplies it has earned so far.
 */
export function retreatToCitadel(s: RunState): string | null {
  if (!retreatOffered(s)) return 'The settlement can still be held.'
  s.phase = 'lost'
  s.retreated = true
  s.pendingChoices = []
  s.orderOffers = []
  pushLog(s, `🏰 You lead the settlers home to the Citadel. The settlement is given back to the forest.`, 'info')
  return null
}

// ---------------------------------------------------------------------------
// The Queen's court: the three levers on her patience, in one summary
// ---------------------------------------------------------------------------

/**
 * Open now; open but short of amber; not yet (or not now); spent for the
 * run; closed while the envoy rides (impatience no longer matters).
 */
export type CourtState = 'open' | 'short' | 'later' | 'used' | 'closed'

export interface CourtLever {
  id: 'soothe' | 'petition' | 'retreat'
  name: string
  state: CourtState
  /** What it does and why it is (or is not) open, in a line. */
  note: string
}

/** Whole points of impatience, as the meter shows them. */
const impatienceNow = (s: RunState) => Math.floor(s.impatience + s.impatienceProgress)

/**
 * The Queen's court, as the Orders panel summarises it from Year 2: Soothe
 * the Queen, the Grand Petition and the Retreat to the Citadel, each with
 * its state now and when (or why not) it opens — so a player meets all three
 * before the run is desperate. The controls themselves stay where they are.
 */
export function queensCourt(s: RunState): CourtLever[] {
  const amber = Math.floor(s.stock.amber ?? 0)
  const now = impatienceNow(s)

  const cost = sootheCost(s)
  const soothe: CourtLever = { id: 'soothe', name: 'Soothe the Queen', state: 'open', note: '' }
  if (s.impatience < 1) {
    soothe.state = 'later'
    soothe.note = 'Her patience is whole: nothing to soothe yet.'
  } else if (amber < cost) {
    soothe.state = 'short'
    soothe.note = `${cost} amber buys back a point of patience — you have ${amber}.`
  } else {
    soothe.note = `${cost} amber buys back a point of patience; dearer each time.`
  }

  const terms = `${PETITION_AMBER} amber for −${PETITION_RELIEF} impatience, on a vow of ${PETITION_VOW_REPUTATION} reputation in ${PETITION_VOW_SECONDS / 60} minutes`
  const petition: CourtLever = { id: 'petition', name: 'The Grand Petition', state: 'open', note: '' }
  const p = s.petition
  const blocked = petitionBlocked(s)
  if (p) {
    petition.state = 'used'
    petition.note =
      p.outcome === 'kept'
        ? 'Made — the vow was kept.'
        : p.outcome === 'broken'
          ? 'Made — the vow was broken.'
          : `Made — your vow: ${Math.max(0, s.reputation - (p.target - PETITION_VOW_REPUTATION))}/${PETITION_VOW_REPUTATION} reputation, ${Math.ceil(petitionVowLeft(s) / 60)} min left.`
  } else if (blocked === null) {
    petition.note = `Open once a run: ${terms}.`
  } else if (blocked === 'amber') {
    petition.state = 'short'
    petition.note = `Open, but needs ${PETITION_AMBER} amber — you have ${amber}.`
  } else if (blocked === 'used') {
    petition.state = 'used'
    petition.note = 'Not while the run is over.'
  } else if (s.season.year < PETITION_FROM_YEAR) {
    petition.state = 'later'
    petition.note = `From Year ${PETITION_FROM_YEAR}: ${terms}.`
  } else {
    petition.state = 'later'
    petition.note = `Opens when impatience reaches ${Math.ceil(petitionThreshold(s))} (now ${now}): ${terms}.`
  }

  const short = s.maxReputation - s.reputation
  const line = Math.ceil(s.maxImpatience * RETREAT_IMPATIENCE_SHARE)
  const retreat: CourtLever = { id: 'retreat', name: 'Retreat to the Citadel', state: 'later', note: '' }
  if (retreatOffered(s)) {
    retreat.state = 'open'
    retreat.note = 'Offered: end the run now as a loss and send home what it has earned.'
  } else if (short < RETREAT_REPUTATION_SHORT) {
    retreat.note = `Not while victory is within ${RETREAT_REPUTATION_SHORT} points.`
  } else {
    retreat.note = `Offered if impatience reaches ${line} (now ${now}) with ${RETREAT_REPUTATION_SHORT}+ reputation still to earn: the run ends, and pays what it has earned.`
  }

  // The envoy rides: reputation is full and her patience stands still, so the
  // levers on it are closed, and the run is held rather than given up.
  if (s.envoy) {
    soothe.state = 'closed'
    soothe.note = SOOTHE_ENVOY_REFUSAL
    if (!p) {
      petition.state = 'closed'
      petition.note = 'The Queen is satisfied: her envoy is on her way, and there is nothing to petition.'
    }
    retreat.state = 'closed'
    retreat.note = 'Not while the envoy rides: hold the settlement until she arrives.'
  }

  return [soothe, petition, retreat]
}
