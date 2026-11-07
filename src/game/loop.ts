import { autoPauseHits, watchRun, type AutoPauseHit, type AutoPauseSettings, type RunWatch } from './autoPause'
import { SPEED_OPTIONS, TICK_SECONDS } from './engine/balance'
import { tick } from './engine/tick'
import type { RunState } from './types'

/**
 * The game loop's clock: how much simulated time a real frame buys, the
 * fixed ticks it runs, the auto-pause triggers checked between them, and the
 * throttle that keeps the HUD clock near 8 Hz however fast the sim steps.
 *
 * The store owns the state React renders from and calls `advanceLoop` from
 * its `advance` action; the per-frame bookkeeping here lives outside the
 * store because it changes every frame and nothing renders from it.
 */

/** Fewest simulated seconds a single frame may consume, at any speed. */
const MAX_FRAME_BUDGET = 2
const MAX_STEPS_PER_FRAME = 64
/**
 * Longest real frame the loop feeds the sim; mirrors the clamp in
 * `useGameLoop`, so anything longer is a backgrounded or frozen tab.
 */
export const MAX_FRAME_REAL_SECONDS = 0.5

/**
 * Most simulated seconds one frame may owe. It scales with speed so a slow
 * device at 5× (a frame of up to half a second) still gets all its time,
 * with one tick of headroom for the carry, while a tab returning from the
 * background still cannot fast-forward more than one long frame's worth.
 */
export function frameBudget(speed: number): number {
  return Math.max(MAX_FRAME_BUDGET, speed * MAX_FRAME_REAL_SECONDS + TICK_SECONDS)
}

// The step cap must never be what slows the top speed down.
if (MAX_STEPS_PER_FRAME * TICK_SECONDS < frameBudget(Math.max(...SPEED_OPTIONS))) {
  throw new Error('MAX_STEPS_PER_FRAME cannot cover a full frame at top speed')
}

/**
 * Real milliseconds between HUD refreshes while the game loop runs: the HUD
 * clock (`hudVersion`) ticks at about 8 Hz however fast the sim steps.
 */
export const HUD_INTERVAL_MS = 125

/** Simulated seconds owed to the world but not yet ticked. */
let simCarry = 0

/**
 * What the auto-pause triggers last saw of the run, to compare against after
 * the next step. Keyed by the run object, so a new or resumed run starts fresh.
 */
let watched: { run: RunState; snapshot: RunWatch } | null = null

/** `performance.now()` of the game loop's last HUD refresh. */
let lastHudFrame = Number.NEGATIVE_INFINITY

/** True while `advanceLoop` publishes a sim step that leaves the HUD clock alone. */
let quietStep = false

/** True while the loop publishes a step that must not tick the HUD clock. */
export function isQuietStep(): boolean {
  return quietStep
}

/** Drops any simulated time owed, so nothing carries into the next frame. */
export function dropCarry(): void {
  simCarry = 0
}

/** Drops the carry and the auto-pause snapshot (a run reloaded or abandoned). */
export function forgetRun(): void {
  simCarry = 0
  watched = null
}

/** Clears all of the loop's module-level state (tests, via the store). */
export function resetLoopState(): void {
  simCarry = 0
  watched = null
  lastHudFrame = Number.NEGATIVE_INFINITY
  quietStep = false
}

/**
 * The things that refresh the HUD at once when a sim step changes them,
 * rather than at the next HUD tick: a season turning, the run ending, a
 * choice or a threat appearing, a building finishing, a new log line.
 */
function hudMark(run: RunState): string {
  return `${run.season.season}|${run.season.year}|${run.phase}|${run.pendingChoices.length}|${run.threats.length}|${run.stats.buildingsBuilt}|${run.log[0]?.id ?? -1}`
}

/** What the loop asks of the store as a frame plays out. */
export interface LoopHost {
  /** Stops the game for these auto-pause hits (the carry is already dropped). */
  pause: (hits: AutoPauseHit[]) => void
  /**
   * Publishes the frame's sim steps; `hud` says whether the HUD clock ticks
   * with them or only the per-step `version` moves.
   */
  publish: (hud: boolean) => void
}

/**
 * Feeds `realSeconds` of a frame to the run at `speed`, in fixed ticks, and
 * tells `host` what came of it. `now` is the frame time that throttles the
 * HUD clock; without it (tests, scripts) every step refreshes the HUD.
 */
export function advanceLoop(
  run: RunState | null,
  speed: number,
  autoPauseSettings: AutoPauseSettings,
  realSeconds: number,
  now: number | undefined,
  host: LoopHost,
): void {
  const watching = Object.values(autoPauseSettings).some(Boolean)
  const autoPause = (hits: AutoPauseHit[]) => {
    simCarry = 0
    host.pause(hits)
  }
  if (!run || speed === 0 || run.phase !== 'playing' || run.pendingChoices.length > 0) {
    // Nothing is running, so nothing may carry into the next frame.
    simCarry = 0
    // Whatever happens while the player has paused (a choice answered, a
    // trigger switched on) is not news when they resume. A choice that
    // halts a running game is different: if answering it unleashes a
    // threat, that should still pause once the world moves again.
    if (run && watching && (speed === 0 || run.phase !== 'playing')) {
      watched = { run, snapshot: watchRun(run) }
    }
    return
  }

  let before: RunWatch | null = null
  if (watching) {
    before = watched?.run === run ? watched.snapshot : watchRun(run)
    // Transitions since the last frame — e.g. a threat from a choice.
    const seen = watchRun(run)
    const hits = autoPauseHits(before, seen, run, autoPauseSettings)
    watched = { run, snapshot: seen }
    if (hits.length > 0) {
      autoPause(hits)
      return
    }
    before = seen
  } else {
    watched = null
  }

  /*
   * A frame at 60 Hz is ~0.017 s, far shorter than one fixed tick, so the
   * unspent remainder carries into the next frame. Without the carry no
   * frame ever reaches a whole tick and the world stands still on any
   * display faster than 8 fps. The clamp stops a backgrounded tab from
   * fast-forwarding on return; it grows with speed (see `frameBudget`) so a
   * low frame rate at 4× or 5× is not silently slowed to the 1× budget.
   */
  simCarry = Math.min(simCarry + realSeconds * speed, frameBudget(speed))
  const mark = simCarry >= TICK_SECONDS ? hudMark(run) : ''
  let steps = 0
  while (simCarry >= TICK_SECONDS && steps < MAX_STEPS_PER_FRAME) {
    tick(run, TICK_SECONDS)
    simCarry -= TICK_SECONDS
    steps++
    if (before) {
      // Checked every tick, so a pause lands on the moment, not a frame late.
      const seen = watchRun(run)
      const hits = autoPauseHits(before, seen, run, autoPauseSettings)
      before = seen
      watched = { run, snapshot: seen }
      if (hits.length > 0) {
        autoPause(hits)
        return
      }
    }
    if (run.phase !== 'playing' || run.pendingChoices.length > 0) {
      simCarry = 0
      break
    }
  }
  if (steps === 0) return
  if (now === undefined || now - lastHudFrame >= HUD_INTERVAL_MS || hudMark(run) !== mark) {
    if (now !== undefined) lastHudFrame = now
    host.publish(true)
  } else {
    quietStep = true
    try {
      host.publish(false)
    } finally {
      quietStep = false
    }
  }
}
