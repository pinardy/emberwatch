import { DECREES } from './content/decrees'
import { SPECIES } from './content/species'
import { secondsUntilDeparture } from './engine/queries'
import type { RunState, Season, SpeciesId } from './types'

/**
 * Auto-pause: moments the player may want to stop and think about. Each is
 * detected by comparing what the run exposes before and after the store moves
 * the world on — the engine is not told about any of this.
 */
export type AutoPauseTrigger = 'threat' | 'decree' | 'departure' | 'storm' | 'caravan'

export type AutoPauseSettings = Record<AutoPauseTrigger, boolean>

/** Threats default on: they strike on a countdown the player should see start. */
export function defaultAutoPause(): AutoPauseSettings {
  return { threat: true, decree: false, departure: false, storm: false, caravan: false }
}

/** Order and wording for the settings toggles. */
export const AUTO_PAUSE_OPTIONS: { id: AutoPauseTrigger; label: string }[] = [
  { id: 'threat', label: 'A threat is unleashed' },
  { id: 'decree', label: 'The Queen issues a decree' },
  { id: 'departure', label: 'A species starts to despair (villagers about to leave)' },
  { id: 'storm', label: 'The Storm begins' },
  { id: 'caravan', label: 'A caravan arrives' },
]

/** Merges whatever an older or hand-edited save holds over the defaults. */
export function migrateAutoPause(raw: unknown): AutoPauseSettings {
  const out = defaultAutoPause()
  if (!raw || typeof raw !== 'object') return out
  for (const key of Object.keys(out) as AutoPauseTrigger[]) {
    const value = (raw as Record<string, unknown>)[key]
    if (typeof value === 'boolean') out[key] = value
  }
  return out
}

/** The slice of a run the triggers watch. Cheap enough to take every tick. */
export interface RunWatch {
  threats: string[]
  decree: string | null
  departing: SpeciesId[]
  season: Season
  caravanHere: boolean
}

export function watchRun(run: RunState): RunWatch {
  return {
    threats: run.threats.map((t) => t.id),
    decree: run.decree?.id ?? null,
    departing: Object.keys(secondsUntilDeparture(run)) as SpeciesId[],
    season: run.season.season,
    caravanHere: run.caravan.here,
  }
}

export interface AutoPauseHit {
  trigger: AutoPauseTrigger
  /** Finishes "Paused: …". */
  reason: string
}

/** Enabled triggers that fired between two snapshots of the same run. */
export function autoPauseHits(
  before: RunWatch,
  after: RunWatch,
  run: RunState,
  enabled: AutoPauseSettings,
): AutoPauseHit[] {
  const hits: AutoPauseHit[] = []

  if (enabled.threat) {
    const fresh = run.threats.filter((t) => !before.threats.includes(t.id))
    if (fresh.length === 1) {
      hits.push({ trigger: 'threat', reason: `${fresh[0].name} is loose` })
    } else if (fresh.length > 1) {
      hits.push({ trigger: 'threat', reason: `${fresh.length} threats are loose` })
    }
  }

  if (enabled.decree && after.decree !== null && after.decree !== before.decree) {
    const name = run.decree ? DECREES[run.decree.defId]?.name : undefined
    hits.push({
      trigger: 'decree',
      reason: name ? `the Queen decrees "${name}"` : 'the Queen has issued a decree',
    })
  }

  if (enabled.departure) {
    const fresh = after.departing.filter((sp) => !before.departing.includes(sp))
    if (fresh.length > 0) {
      const names = fresh.map((sp) => SPECIES[sp]?.name ?? sp).join(' and ')
      hits.push({
        trigger: 'departure',
        reason: `${names} are in despair and will start leaving`,
      })
    }
  }

  if (enabled.storm && after.season === 'storm' && before.season !== 'storm') {
    hits.push({ trigger: 'storm', reason: 'the Storm has begun' })
  }

  if (enabled.caravan && after.caravanHere && !before.caravanHere) {
    hits.push({ trigger: 'caravan', reason: 'a caravan has arrived' })
  }

  return hits
}

/** "Paused: the Storm has begun · a caravan has arrived." */
export function autoPauseNotice(hits: AutoPauseHit[]): string {
  return `Paused: ${hits.map((h) => h.reason).join(' · ')}.`
}
