import { useEffect, useRef } from 'react'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { population } from '../game/engine/queries'
import { cue, setMuted, setRainSeason, unlockAudio } from './audio'

/**
 * Watches the run between renders and turns state transitions into sound:
 * seasons turning, orders landing, villagers leaving, threats waking. The sim
 * stays pure — sound is derived here, in the UI, from what changed.
 */
export function useAudioCues(run: RunState | null): void {
  const sound = useGameStore((s) => s.settings.sound)
  const prev = useRef<{
    season: string
    orders: number
    built: number
    sites: number
    lost: number
    pop: number
    choices: number
    threats: number
    caravanHere: boolean
    phase: string
  } | null>(null)

  // Rejected commands surface as notices; give them a physical refusal too.
  const notice = useGameStore((s) => s.notice)
  useEffect(() => {
    if (run && notice) cue('placeError')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice])

  // The context can only start from a user gesture.
  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    setMuted(!sound)
  }, [sound])

  // Rain ambience follows the season while a run is on screen.
  useEffect(() => {
    if (!run) return
    setRainSeason(run.season.season)
    return () => setRainSeason(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.season.season, run === null])

  useEffect(() => {
    if (!run) {
      prev.current = null
      return
    }
    const now = {
      season: run.season.season,
      orders: run.stats.ordersCompleted,
      built: run.stats.buildingsBuilt,
      sites: Object.keys(run.buildings).length,
      lost: run.stats.villagersLost,
      pop: population(run),
      choices: run.pendingChoices.length,
      threats: run.threats.length,
      caravanHere: run.caravan.here,
      phase: run.phase,
    }
    const before = prev.current
    prev.current = now
    if (!before) return

    if (now.phase !== before.phase) {
      if (now.phase === 'won') cue('won')
      else if (now.phase === 'lost') cue('lost')
      return
    }
    if (now.season !== before.season) {
      if (now.season === 'storm') cue('seasonStorm')
      else if (now.season === 'drizzle') cue('seasonDrizzle')
      else cue('seasonClearance')
    }
    if (now.orders > before.orders) cue('orderComplete')
    if (now.sites > before.sites) cue('place')
    if (now.built > before.built) cue('buildComplete')
    if (now.lost > before.lost) cue('villagerLeft')
    else if (now.pop > before.pop) cue('villagerArrived')
    if (now.choices > before.choices) cue('draftOpen')
    if (now.threats > before.threats) cue('threat')
    if (now.caravanHere && !before.caravanHere) cue('caravan')
  })
}
