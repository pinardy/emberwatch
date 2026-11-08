import { STARTING_SPECIES } from '../game/content/species'
import { createRun } from '../game/engine/createRun'
import { takeChoice } from '../game/engine/drafts'
import { defaultMeta } from '../game/engine/meta'
import { useGameStore } from '../game/store'
import type { MetaState, RunState, SpeciesId } from '../game/types'

/*
 * A run as it stands once the player has set out and made the founding picks,
 * put straight into the store, for UI tests that are about what comes after:
 * they render the screen or component they test on it rather than clicking
 * through the menu, the setup screen and the founding every time. The
 * founding flow itself is tested through the real app (App.test.tsx,
 * Onboarding.test.tsx).
 */

export interface TestRunOptions {
  /** The map seed (default 7171). */
  seed?: number
  /** Default: the setup screen's picks, the three starting species. */
  species?: SpeciesId[]
  /** Map modifiers; by default drawn from the seed, as for a run set out from the setup screen. */
  modifiers?: string[]
  /** The Citadel the run sets out from (default: a fresh one). */
  meta?: MetaState
}

/** A new run, before its founding picks, as the setup screen's Set out makes it. */
export function newTestRun({ seed = 7171, species = STARTING_SPECIES, modifiers, meta }: TestRunOptions = {}): RunState {
  return createRun({ seed, species: [...species], modifiers, meta: meta ?? defaultMeta() })
}

/** Makes every founding pick, the first option of each, as the founding panel takes them in order. */
export function makeFoundingPicks(run: RunState): void {
  for (let guard = 0; run.pendingChoices.length > 0 && guard < 20; guard++) {
    takeChoice(run, run.pendingChoices[0].options[0])
  }
  if (run.pendingChoices.length > 0) throw new Error('the founding picks did not settle')
}

/** A run with its founding made: the clock is free to start. */
export function foundedRun(options: TestRunOptions = {}): RunState {
  const run = newTestRun(options)
  makeFoundingPicks(run)
  return run
}

type StoreState = ReturnType<typeof useGameStore.getState>

export interface ShowRunOptions {
  /**
   * Plays the first half second at 1× and pauses again, so the clock has
   * started (the run's opening is over). Without it the run waits at 1× with
   * its clock at 0, as a run does the moment its founding is made.
   */
  started?: boolean
  /** Other store fields to set with it (the open panel, a selection…). */
  store?: Partial<StoreState>
}

/**
 * Puts `run` in the store on the game screen, with nothing selected and the
 * Build panel open, the way the store starts a run. Returns the run.
 */
export function showRun(run: RunState, { started = false, store = {} }: ShowRunOptions = {}): RunState {
  const { version, hudVersion } = useGameStore.getState()
  useGameStore.setState({
    screen: 'game',
    run,
    activeSlot: null,
    version: version + 1,
    hudVersion: hudVersion + 1,
    speed: 1,
    notice: null,
    saveError: null,
    crash: null,
    buildMode: null,
    roadAnchor: null,
    roadErase: false,
    selectedBuilding: null,
    selectedDeposit: null,
    selectedGlade: null,
    cameraFocus: null,
    panel: 'build',
    ...store,
  })
  if (started) startClock()
  return run
}

/** Plays half a second at 1× and pauses: the clock has started. */
export function startClock(): void {
  const store = useGameStore.getState()
  store.setSpeed(1)
  store.advance(0.5)
  store.setSpeed(0)
  if (!(useGameStore.getState().run!.clock > 0)) throw new Error('the clock did not start')
}

/** A founded run in the store (see `foundedRun` and `showRun`). Returns the run. */
export function showFoundedRun(options: TestRunOptions & ShowRunOptions = {}): RunState {
  return showRun(foundedRun(options), options)
}
