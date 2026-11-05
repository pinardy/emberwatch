import { defaultFeats } from '../content/achievements'
import type { RunFeats, RunState } from '../types'

/**
 * The run's achievement bookkeeping, created on first use so hand-built test
 * states and older saves work unchanged. Callers set a field at the moment it
 * happens; nothing scans the run per tick.
 */
export function feats(s: RunState): RunFeats {
  return (s.feats ??= defaultFeats())
}
