import { COMMISSIONS, describeTerm } from '../content/commissions'
import { CORNERSTONE_LIST } from '../content/cornerstones'
import { GLADE_EVENTS } from '../content/gladeEvents'
import { CITADEL_EVENT_OPTIONS } from '../content/meta'
import { MAX_RUN_MODIFIERS, RUN_MODIFIERS } from '../content/runModifiers'
import type { CornerstoneDef, GladeEventDef, GladeEventOptionDef, ResourceId, RunState } from '../types'
import { hashInt, makeRng } from './rng'
import { pushLog } from './runLog'
import { modifiersClash, runModifierDefs } from './runModifiers'

/**
 * In-run reads of the Citadel's perks (`RunState.citadel`). Kept apart from
 * `events.ts` so the draft and event code only asks one-line questions.
 *
 * Every read tolerates a missing `citadel` field: hand-built test states and
 * any save that slipped past `loadRun`'s defaults behave like a run with no
 * upgrades at all.
 */

/** Options in a draft before any Citadel upgrade. */
export const BASE_DRAFT_OPTIONS = 3

/** Cornerstones that may be drafted this run: the open pool plus any the Citadel admitted. */
export function cornerstonePool(s: RunState): CornerstoneDef[] {
  const admitted = s.citadel?.cornerstones ?? []
  return CORNERSTONE_LIST.filter(
    (c) =>
      (!c.citadelLocked || admitted.includes(c.id)) &&
      (!c.species || s.speciesPool.includes(c.species)),
  )
}

export function blueprintDraftSize(s: RunState): number {
  return BASE_DRAFT_OPTIONS + (s.citadel?.blueprintOptions ?? 0)
}

export function cornerstoneDraftSize(s: RunState): number {
  return BASE_DRAFT_OPTIONS + (s.citadel?.cornerstoneOptions ?? 0)
}

export function freeRerollsLeft(s: RunState): number {
  return s.citadel?.freeRerolls ?? 0
}

/** The settlement's own glade, the centre of the first ring. */
const HOME_GLADE = 'glade0'

/**
 * The Scouts' Report on a glade: its waiting event, `null` when the scouts
 * found nothing, or `undefined` when there is no report — the upgrade is not
 * owned, the glade is outside the first ring, or it is already cleared.
 * Reads only what map generation placed; it never touches the RNG.
 */
export function scoutedEvent(s: RunState, gladeId: string): GladeEventDef | null | undefined {
  if (!s.citadel?.scoutReport) return undefined
  const glade = s.glades[gladeId]
  const home = s.glades[HOME_GLADE]
  if (!glade || !home || glade.cleared || !home.neighbors.includes(gladeId)) return undefined
  return glade.eventId ? (GLADE_EVENTS[glade.eventId] ?? null) : null
}

/**
 * A glade event's options as this run sees them: the event's own, then any
 * the Citadel adds. Appending keeps the original indices stable.
 */
export function gladeEventOptions(s: RunState, def: GladeEventDef): GladeEventOptionDef[] {
  const extra = (s.citadel?.eventOptions ?? [])
    .map((id) => CITADEL_EVENT_OPTIONS[id])
    .filter((o): o is GladeEventOptionDef => !!o)
  return extra.length > 0 ? [...def.options, ...extra] : def.options
}

// ---------------------------------------------------------------------------
// Commissions: the twist applied at the founding
// ---------------------------------------------------------------------------

/** Id of the ongoing effect a commission records, so the UI can tell it apart. */
export const COMMISSION_ONGOING_ID = 'commission'

/**
 * The land a run gets under a commission: the commission's own modifier
 * first, then whatever of the drawn land does not clash with it, capped as
 * every land is. Without a commission land the draw is returned untouched.
 */
export function commissionLand(drawn: readonly string[], commission: string | undefined): string[] {
  const id = commission ? COMMISSIONS[commission]?.land : undefined
  const land = id ? RUN_MODIFIERS[id] : undefined
  if (!land) return [...drawn]
  const rest = runModifierDefs(drawn).filter((d) => d.id !== land.id && !modifiersClash(d, land))
  return [land.id, ...rest.map((d) => d.id)].slice(0, MAX_RUN_MODIFIERS)
}

/** Salt for the royal cornerstone's own stream, so the run RNG never moves. */
const ROYAL_STONE_STREAM = 0x726f7961

/**
 * Applies a commission's twist to a run being founded: records it on the run,
 * folds its run-long effects in like a pact, and lands its one-off grants.
 * Unknown ids (and none) leave the run exactly as it was.
 */
export function applyCommission(s: RunState, commission: string | undefined): void {
  const def = commission ? COMMISSIONS[commission] : undefined
  if (!def) return
  s.commission = def.id
  if (def.effects && def.effects.length > 0) {
    s.ongoing.push({
      id: COMMISSION_ONGOING_ID,
      name: `Commission: ${def.name}`,
      icon: def.icon,
      description: def.twist,
      effects: def.effects,
    })
  }
  if (def.startStockPercent) {
    for (const [id, amount] of Object.entries(s.stock)) {
      s.stock[id as ResourceId] = Math.round((amount ?? 0) * (1 + def.startStockPercent / 100))
    }
  }
  for (const [id, amount] of Object.entries(def.startStock ?? {})) {
    const key = id as ResourceId
    s.stock[key] = Math.max(0, (s.stock[key] ?? 0) + (amount ?? 0))
  }
  if (def.startHostility) s.hostility = Math.max(s.hostility, def.startHostility)
  for (const id of def.startBlueprints ?? []) {
    if (!s.unlockedBuildings.includes(id)) s.unlockedBuildings.push(id)
  }
  if (def.royalCornerstone) {
    const pool = cornerstonePool(s).filter(
      (c) => c.rarity === 'rare' && !s.cornerstones.includes(c.id),
    )
    if (pool.length > 0) {
      const stone = makeRng(hashInt((s.seed ^ ROYAL_STONE_STREAM) >>> 0, 0), 0).pick(pool)
      s.cornerstones.push(stone.id)
      pushLog(s, `👑 The Queen lays ${stone.name} at the founding: ${stone.description}`, 'good')
    }
  }
  const goals = def.terms.map(describeTerm).join('; ')
  pushLog(s, `${def.icon} Commission — ${def.name}: hold the settlement; ${goals}.`, 'info')
}
