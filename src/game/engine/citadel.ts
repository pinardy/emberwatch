import { CORNERSTONE_LIST } from '../content/cornerstones'
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
  return CORNERSTONE_LIST.filter((c) => !c.citadelLocked || admitted.includes(c.id))
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
