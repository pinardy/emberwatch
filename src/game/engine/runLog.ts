import type { RunState } from '../types'

/**
 * Adds a line to the run's log (newest first, the last 80 kept). Kept apart
 * from `createRun` so the running game does not pull in the run factory and
 * the map generator, which load only when a new run is created.
 */
export function pushLog(
  s: RunState,
  text: string,
  tone: 'info' | 'good' | 'bad' = 'info',
): void {
  s.log.unshift({
    id: s.logCounter++,
    year: s.season.year,
    season: s.season.season,
    text,
    tone,
  })
  if (s.log.length > 80) s.log.length = 80
}
