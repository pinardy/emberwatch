import { CORNERSTONE_LIST } from '../content/cornerstones'
import { GLADE_EVENTS } from '../content/gladeEvents'
import { CITADEL_EVENT_OPTIONS } from '../content/meta'
import type { CornerstoneDef, GladeEventDef, GladeEventOptionDef, RunState } from '../types'

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
