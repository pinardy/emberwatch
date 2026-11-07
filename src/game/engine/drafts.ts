import { BLUEPRINT_POOL, BUILDINGS } from '../content/buildings'
import { CORNERSTONES, RARITY_WEIGHTS } from '../content/cornerstones'
import type { RunState, ServiceNeed } from '../types'
import {
  DRAFT_PITY,
  REROLL_BASE_COST,
  REROLL_COST_GROWTH,
  REWARD_MILESTONES,
  TARGETED_REDRAW_SURCHARGE,
} from './balance'
import { blueprintDraftSize, cornerstoneDraftSize, cornerstonePool, freeRerollsLeft } from './citadel'
import { spend } from './queries'
import { makeRng } from './rng'
import { pushLog } from './runLog'
import { chainPieceFor, relevantBlueprints, serviceDemand } from './serviceChains'
import { refreshCharterOffer, takeCharter, takeQueenChoice } from './structure'
import { recordEvent } from './timeline'

/**
 * Drafts and choices: the blueprint and cornerstone picks at reputation
 * milestones, taking any queued choice, and the rerolls and targeted
 * redraws that reshape an open draft.
 */

// ---------------------------------------------------------------------------
// Reputation milestones
// ---------------------------------------------------------------------------

/**
 * Reputation milestones alternate cornerstone and blueprint picks, which keeps
 * the run feeling like it is compounding in two directions at once.
 */
export function checkMilestones(s: RunState): void {
  const reached = REWARD_MILESTONES.filter((m) => s.reputation >= m).length
  // A pick laid as the run ends is noise: within a point of victory, the
  // milestones pass without a draft.
  if (s.reputation >= s.maxReputation - 1) {
    s.cornerstonesTaken = Math.max(s.cornerstonesTaken, reached)
    return
  }
  while (s.cornerstonesTaken < reached) {
    const index = s.cornerstonesTaken
    s.cornerstonesTaken++
    // Lead with a blueprint: early on, options matter more than multipliers.
    if (index % 2 === 0) offerBlueprint(s)
    else offerCornerstone(s)
  }
}

export function offerCornerstone(s: RunState, commonOnly = false): void {
  const rng = makeRng(s.seed, s.rngCursor)
  const options = drawCornerstones(s, rng, cornerstoneDraftSize(s), [], commonOnly)
  s.rngCursor = rng.cursor()
  if (options.length === 0) return
  s.pendingChoices.push({ kind: 'cornerstone', options })
}

/** Up to `size` cornerstones not yet laid (nor in `exclude`), by rarity weight. */
function drawCornerstones(
  s: RunState,
  rng: ReturnType<typeof makeRng>,
  size: number,
  exclude: string[] = [],
  commonOnly = false,
): string[] {
  const remaining = cornerstonePool(s).filter(
    (c) =>
      !s.cornerstones.includes(c.id) &&
      !exclude.includes(c.id) &&
      (!commonOnly || c.rarity === 'common'),
  )
  const options: string[] = []
  for (let i = 0; i < size && remaining.length > 0; i++) {
    const pickDef = rng.weighted(remaining, (c) => RARITY_WEIGHTS[c.rarity])
    options.push(pickDef.id)
    remaining.splice(remaining.indexOf(pickDef), 1)
  }
  return options
}

/** True when a draft is owed a piece of a wanted service chain (the pity rule). */
export function draftOwesChain(s: RunState): boolean {
  return (s.draftDrought ?? DRAFT_PITY) >= DRAFT_PITY
}

/**
 * A blueprint draft's options, drawn at random from the locked pool and laid
 * out in random order. Nothing is guaranteed — except that after `DRAFT_PITY`
 * drafts in a row with nothing toward a wanted service, the next one carries
 * the most useful chain piece, so a needed service is never starved for good
 * (the run's first draft is owed one too). A `mixed` draft trades one
 * blueprint slot for a cornerstone, so "finish the chain" competes with a
 * run-long perk.
 */
function buildBlueprintOptions(
  s: RunState,
  mixed: boolean,
  {
    exclude = [],
    pity = true,
    force,
  }: {
    exclude?: string[]
    pity?: boolean
    /** A blueprint that must be among the options (a targeted redraw). */
    force?: string
  } = {},
): string[] {
  const rng = makeRng(s.seed, s.rngCursor)
  const pool = BLUEPRINT_POOL.filter(
    (id) => !s.unlockedBuildings.includes(id) && !exclude.includes(id),
  )
  if (pool.length === 0) {
    s.rngCursor = rng.cursor()
    return []
  }
  const size = blueprintDraftSize(s)
  const cornerstone = mixed ? drawCornerstones(s, rng, 1, exclude) : []
  const blueprintSlots = Math.max(1, size - cornerstone.length)
  const options: string[] = []
  // `relevantBlueprints` is priority-ordered, so take from the front.
  const relevant = relevantBlueprints(s).filter((id) => !exclude.includes(id))
  if (force && pool.includes(force)) options.push(force)
  else if (pity && relevant.length > 0 && draftOwesChain(s)) options.push(relevant[0])
  for (const id of rng.shuffle(pool)) {
    if (options.length >= blueprintSlots) break
    if (!options.includes(id)) options.push(id)
  }
  const out = rng.shuffle([...options, ...cornerstone])
  s.rngCursor = rng.cursor()
  return out
}

/**
 * Offers a blueprint draft. Milestone drafts are `mixed` (one option is a
 * cornerstone); the opening drafts, dealt before the clock starts, are not.
 */
export function offerBlueprint(s: RunState, mixed = s.clock > 0): void {
  const options = buildBlueprintOptions(s, mixed)
  if (options.length === 0) {
    // Nothing left to unlock — hand out a cornerstone instead.
    offerCornerstone(s)
    return
  }
  s.pendingChoices.push({ kind: 'blueprint', options, ...(mixed ? { mixed } : {}) })
}

/** Lays a cornerstone (the caller retires the choice). */
function layCornerstone(s: RunState, optionId: string): void {
  s.cornerstones.push(optionId)
  recordEvent(s, 'cornerstone', CORNERSTONES[optionId]?.name ?? optionId)
  pushLog(s, `Cornerstone laid: ${CORNERSTONES[optionId]?.name ?? optionId}.`, 'good')
}

/**
 * Counts blueprint drafts that passed without a piece of a wanted chain on
 * offer (judged before the pick changes what is wanted), for the pity rule.
 */
function noteDraftOffer(s: RunState, options: string[]): void {
  const relevant = relevantBlueprints(s)
  if (relevant.length === 0 || options.some((id) => relevant.includes(id))) s.draftDrought = 0
  else s.draftDrought = (s.draftDrought ?? DRAFT_PITY) + 1
}

/**
 * Applies a pick from a queued choice — the front one unless `index` says
 * otherwise (the Founding panel takes its picks in any order).
 */
export function takeChoice(s: RunState, optionId: string, index = 0): void {
  const choice = s.pendingChoices[index]
  if (!choice) return
  if (choice.kind === 'cornerstone') {
    if (!choice.options.includes(optionId)) return
    if (s.cornerstones.includes(optionId)) return
    layCornerstone(s, optionId)
  } else if (choice.kind === 'blueprint') {
    if (!choice.options.includes(optionId)) return
    noteDraftOffer(s, choice.options)
    if (!BUILDINGS[optionId] && CORNERSTONES[optionId]) {
      // A mixed draft's cornerstone.
      if (s.cornerstones.includes(optionId)) return
      layCornerstone(s, optionId)
    } else {
      if (!s.unlockedBuildings.includes(optionId)) s.unlockedBuildings.push(optionId)
      pushLog(s, `Blueprint acquired: ${BUILDINGS[optionId]?.name ?? optionId}.`, 'good')
    }
  } else if (choice.kind === 'charter') {
    if (!takeCharter(s, choice, optionId)) return
  } else if (choice.kind === 'order' || choice.kind === 'decree') {
    if (!takeQueenChoice(s, choice, optionId)) return
  } else {
    return
  }
  s.pendingChoices.splice(index, 1)
  // Taken out of turn (a founding cornerstone or writ while a blueprint draft
  // is still showing), nothing the player can see is redrawn: only offers the
  // pick has made stale change.
  refreshQueuedChoices(s, index === 0 || choice.kind === 'blueprint')
}

/**
 * Re-rolls the options of any *still queued* draft.
 *
 * Drafts can be queued several deep — the opening draft is three picks, and a
 * milestone can land while one is open. Their options were computed before the
 * player chose, so without this the same building is offered (and granted) twice
 * and half a service chain never appears.
 */
function refreshQueuedChoices(s: RunState, redraw = true): void {
  const stale = s.pendingChoices
  for (let i = 0; i < stale.length; i++) {
    const choice = stale[i]
    if (choice.kind === 'blueprint') {
      if (!redraw && !choice.options.some((id) => s.unlockedBuildings.includes(id) || s.cornerstones.includes(id))) {
        continue
      }
      const fresh = buildBlueprintOptions(s, !!choice.mixed)
      if (fresh.length === 0) {
        // Nothing left to draft — swap in a cornerstone offer instead.
        stale.splice(i, 1)
        offerCornerstone(s)
        if (choice.founding && stale.length > 0) stale[stale.length - 1].founding = true
        i--
        continue
      }
      choice.options = fresh
    } else if (choice.kind === 'cornerstone') {
      choice.options = choice.options.filter((id) => !s.cornerstones.includes(id))
      if (choice.options.length === 0) {
        stale.splice(i, 1)
        i--
      }
    } else if (choice.kind === 'charter') {
      refreshCharterOffer(s, choice)
    }
  }
}

/** Amber cost of the next draft reroll — it steepens with use. */
export function rerollCost(s: RunState): number {
  if (freeRerollsLeft(s) > 0) return 0
  return REROLL_BASE_COST + s.rerollsUsed * REROLL_COST_GROWTH
}

/**
 * Re-draws the options of the open draft for amber. A well-loved roguelite
 * lever: it converts a lucky economy into slightly better luck.
 */
export function rerollChoice(s: RunState, index = 0): string | null {
  const choice = s.pendingChoices[index]
  if (!choice) return 'Nothing to reroll.'
  if (choice.kind === 'gladeEvent') return 'The forest does not renegotiate.'
  if (choice.kind === 'charter') return 'A royal charter is not up for negotiation.'
  if (choice.kind === 'order' || choice.kind === 'decree') return 'The Queen does not haggle.'
  const cost = rerollCost(s)
  if ((s.stock.amber ?? 0) < cost) return 'Not enough amber.'

  if (choice.kind === 'blueprint') {
    // A redraw is a fresh hand: none of what was shown, and no pity piece.
    const fresh = buildBlueprintOptions(s, !!choice.mixed, {
      exclude: choice.options,
      pity: false,
    })
    if (fresh.length === 0) return 'There is nothing else to offer.'
    choice.options = fresh
  } else {
    const rng = makeRng(s.seed, s.rngCursor)
    const options = drawCornerstones(s, rng, cornerstoneDraftSize(s), choice.options)
    s.rngCursor = rng.cursor()
    if (options.length === 0) return 'There is nothing else to offer.'
    choice.options = options
  }

  if (cost === 0 && s.citadel && freeRerollsLeft(s) > 0) {
    // A Citadel favour: free, and it does not steepen the amber price.
    s.citadel.freeRerolls--
    pushLog(s, 'The offer is redrawn — a favour from the Citadel.', 'info')
    return null
  }
  spend(s.stock, { amber: cost })
  s.rerollsUsed++
  pushLog(s, `The offer is redrawn for ${cost} amber.`, 'info')
  return null
}

/**
 * Amber for a targeted redraw — asking the Queen's architect for a blueprint
 * toward one service. It rides the reroll ladder (and steepens it), plus a
 * surcharge, and a Citadel free reroll does not cover it.
 */
export function targetedRedrawCost(s: RunState): number {
  return REROLL_BASE_COST + s.rerollsUsed * REROLL_COST_GROWTH + TARGETED_REDRAW_SURCHARGE
}

/**
 * Services a targeted redraw of the draft at `index` could ask for: each need
 * of the run's species whose chain still has a locked piece that the draft
 * is not already showing, with that piece. Empty for anything but a
 * blueprint draft.
 */
export function redrawTargets(s: RunState, index = 0): { need: ServiceNeed; piece: string }[] {
  const choice = s.pendingChoices[index]
  if (!choice || choice.kind !== 'blueprint') return []
  const out: { need: ServiceNeed; piece: string }[] = []
  for (const need of serviceDemand(s.speciesPool).keys()) {
    const piece = chainPieceFor(s, need)
    if (piece && !choice.options.includes(piece)) out.push({ need, piece })
  }
  return out
}

/**
 * The targeted redraw: a fresh hand for the open blueprint draft, like a
 * reroll, except that one card is the next piece of `need`'s chain (see
 * `chainPieceFor`). The rest is drawn at random, so the draft is still a
 * choice — and the pick can still be something else.
 */
export function redrawToward(s: RunState, need: ServiceNeed, index = 0): string | null {
  const choice = s.pendingChoices[index]
  if (!choice || choice.kind !== 'blueprint') return 'Only a blueprint draft can be redrawn toward a service.'
  const target = redrawTargets(s, index).find((t) => t.need === need)
  if (!target) return 'Nothing more of that service can be drafted here.'
  const cost = targetedRedrawCost(s)
  if ((s.stock.amber ?? 0) < cost) return 'Not enough amber.'
  const fresh = buildBlueprintOptions(s, !!choice.mixed, {
    exclude: choice.options.filter((id) => id !== target.piece),
    pity: false,
    force: target.piece,
  })
  if (!fresh.includes(target.piece)) return 'There is nothing else to offer.'
  choice.options = fresh
  spend(s.stock, { amber: cost })
  s.rerollsUsed++
  pushLog(
    s,
    `📐 The Queen's architect redraws the offer around ${BUILDINGS[target.piece]?.name ?? target.piece}, for ${cost} amber.`,
    'info',
  )
  return null
}
