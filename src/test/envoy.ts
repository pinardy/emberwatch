import { sendEnvoy } from '../game/engine/reputation'
import type { RunState } from '../game/types'

/**
 * Fills reputation and puts the run at the very end of the envoy's Storm, the
 * way play gets there: the next tick she arrives and the run is won. For tests
 * that need a won run through the real end-of-run path.
 */
export function envoyArrivesNextTick(s: RunState): void {
  s.reputation = s.maxReputation
  s.reputationProgress = 0
  sendEnvoy(s)
  if (s.envoy) s.envoy.finalStorm = true
  s.season.season = 'storm'
  s.season.elapsed = Math.max(0, s.season.length - 0.01)
  // A hearth with wood for the last moments of the Storm.
  s.stock.wood = Math.max(s.stock.wood ?? 0, 20)
}
