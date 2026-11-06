import { offerDecrees, takeQueenChoice } from '../game/engine/structure'
import type { RunState } from '../game/types'

/**
 * Puts a decree live the way play does: the herald's offer, then the first
 * option taken. The offer is settled here, ahead of anything else queued.
 * False when nothing suits the settlement.
 */
export function proclaimFirstDecree(s: RunState): boolean {
  if (!offerDecrees(s)) return false
  const choice = s.pendingChoices.pop()!
  return takeQueenChoice(s, choice, choice.options[0])
}
