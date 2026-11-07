import type { PendingChoice, RunState } from '../types'
import { isWritChoice } from './orders'

/**
 * The founding: the picks a run opens on — its blueprint drafts, the founding
 * cornerstone (two with the Viceroy's Signet) and the founding writ. They are
 * dealt before the first tick and the clock waits until every one is made,
 * but they are made together from one panel beside the visible map, in any
 * order, rather than as a run of pop-ups.
 */

/** A founding pick still to make, with its place in the queue. */
export interface FoundingPick {
  choice: PendingChoice
  /** Index into `pendingChoices` (what `takeChoice`/`rerollChoice` take). */
  index: number
}

/** The founding picks still open, in queue order. */
export function foundingPicks(s: RunState): FoundingPick[] {
  const out: FoundingPick[] = []
  s.pendingChoices.forEach((choice, index) => {
    if (choice.founding) out.push({ choice, index })
  })
  return out
}

/** True while the run is still being founded (the clock waits on it). */
export function isFounding(s: RunState): boolean {
  return s.pendingChoices.some((c) => c.founding)
}

/** Which part of the founding a pick belongs to. */
export type FoundingPart = 'blueprint' | 'cornerstone' | 'writ'

export function foundingPart(choice: PendingChoice): FoundingPart | null {
  if (choice.kind === 'blueprint') return 'blueprint'
  if (choice.kind === 'cornerstone') return 'cornerstone'
  if (isWritChoice(choice)) return 'writ'
  return null
}

/** Marks every choice queued so far as part of the founding (run creation). */
export function markFounding(s: RunState): void {
  // Only what the Founding panel can show: anything else stays a pop-up.
  for (const choice of s.pendingChoices) if (foundingPart(choice)) choice.founding = true
}

/**
 * Saves made mid-opening, before choices carried the flag, resume in the
 * Founding panel: before the first tick every queued pick is a founding one.
 */
export function migrateFounding(run: RunState): void {
  if (run.clock !== 0 || !Array.isArray(run.pendingChoices)) return
  for (const choice of run.pendingChoices) {
    if (choice && foundingPart(choice) && !choice.mixed) choice.founding = true
  }
}
