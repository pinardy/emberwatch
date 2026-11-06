import { useEffect, useRef, useState } from 'react'
import {
  frameDerived,
  shallowEqual,
  subscribeHud,
  useGameStore,
  useRunSelector,
} from '../game/store'
import type { RunState } from '../game/types'
import { population } from '../game/engine/queries'
import {
  cue,
  setMusicHeld,
  setMusicMood,
  setMuted,
  setRainSeason,
  setVolume,
  unlockAudio,
  type MusicMood,
} from './audio'

/** Share of the Queen's patience past which the score darkens. */
export const MUSIC_TENSE_IMPATIENCE_SHARE = 0.7

/** What the score should play for a run: its season, shaded when trouble is loose. */
export function musicMoodFor(run: RunState): MusicMood | null {
  if (run.phase !== 'playing') return null
  const tense =
    run.threats.length > 0 ||
    (run.maxImpatience > 0 && run.impatience / run.maxImpatience >= MUSIC_TENSE_IMPATIENCE_SHARE)
  return { season: run.season.season, tense, seed: run.seed }
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  useEffect(() => {
    const onChange = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return hidden
}

/**
 * Watches the run on every HUD tick and turns state transitions into sound:
 * seasons turning, orders landing, villagers leaving, threats waking. The sim
 * stays pure — sound is derived here, in the UI, from what changed. It
 * subscribes to the store rather than re-rendering the screen per sim step.
 */
export function useAudioCues(run: RunState | null): void {
  const sound = useGameStore((s) => s.settings.sound)
  const volume = useGameStore((s) => s.settings.volume)
  const speed = useGameStore((s) => s.speed)
  const hidden = useDocumentHidden()
  const prev = useRef<{
    season: string
    orders: number
    built: number
    sites: number
    lost: number
    pop: number
    choices: number
    threats: number
    /** Seconds to the next strike, per threat id; a jump upward is a strike. */
    threatTimers: Record<string, number>
    glades: number
    storageFull: boolean
    caravanHere: boolean
    phase: string
  } | null>(null)

  // Rejected commands surface as notices; give them a physical refusal too.
  const notice = useGameStore((s) => s.notice)
  useEffect(() => {
    if (run && notice) cue('placeError')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice])

  // The context can only start from a user gesture. Every gesture is offered
  // (not just the first) so a context the browser suspended, as iOS does on
  // an interruption, resumes on the next tap.
  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    setMuted(!sound)
  }, [sound])

  useEffect(() => {
    setVolume(volume)
  }, [volume])

  // The score follows the season and the mood, and holds while the game is
  // paused or the tab is hidden (timers are throttled there anyway).
  const mood = useRunSelector(musicMoodFor, shallowEqual) ?? null
  useEffect(() => {
    setMusicMood(mood)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mood?.season, mood?.tense, mood?.seed, mood === null])
  useEffect(() => () => setMusicMood(null), [])
  useEffect(() => {
    setMusicHeld(speed === 0 || hidden)
  }, [speed, hidden])

  // Rain ambience follows the season while a run is on screen.
  const season = useRunSelector((r) => r.season.season)
  useEffect(() => {
    if (!run || !season) return
    setRainSeason(season)
    return () => setRainSeason(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, run === null])

  useEffect(() => {
    if (!run) {
      prev.current = null
      return
    }
    listen(run)
    return subscribeHud(listen)
  }, [run])

  /** Compares this HUD tick's run with the last one and plays what changed. */
  function listen(run: RunState): void {
    const now = {
      season: run.season.season,
      orders: run.stats.ordersCompleted,
      built: run.stats.buildingsBuilt,
      sites: Object.keys(run.buildings).length,
      lost: run.stats.villagersLost,
      pop: population(run),
      choices: run.pendingChoices.length,
      threats: run.threats.length,
      threatTimers: Object.fromEntries(run.threats.map((t) => [t.id, t.timer])),
      glades: run.stats.gladesCleared,
      // Shared with the stockpile strip and the toasts, once per sim step.
      storageFull: frameDerived(run, useGameStore.getState().version).storageBlocked.length > 0,
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
    else if (!now.caravanHere && before.caravanHere) cue('caravanLeaving')
    const struck = run.threats.some((t) => {
      const was = before.threatTimers[t.id]
      return was !== undefined && t.timer > was + 0.5
    })
    if (struck) cue('threatStrike')
    if (now.glades > before.glades) cue('gladeCleared')
    if (now.storageFull && !before.storageFull) cue('storageFull')
  }
}
