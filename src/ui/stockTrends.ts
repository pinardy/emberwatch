import { useRef } from 'react'
import { commandStockTotals } from '../game/commandStock'
import { BUILDINGS } from '../game/content/buildings'
import { buildingStatus } from '../game/engine/forecast'
import { computeModifiers } from '../game/engine/modifiers'
import { storageUsed } from '../game/engine/queries'
import type { ResourceBag, ResourceId, RunState } from '../game/types'

/**
 * Which stocks are rising, which are falling (and how soon they run dry), and
 * which are holding up a building — presentation only, derived from the run as
 * it plays. The sim keeps no stock history, so the HUD keeps a short one of its
 * own: a snapshot every few game seconds over the last minute or so.
 */

/** Game seconds between snapshots. */
export const TREND_SAMPLE_SECONDS = 3
/** Snapshots older than this (game seconds) are dropped. */
export const TREND_WINDOW_SECONDS = 45
/** No trend until the history spans at least this many game seconds. */
export const TREND_MIN_SPAN = 15
/** A falling stock that runs dry sooner than this (game seconds) is flagged. */
export const FALLING_FAST_SECONDS = 120

export type TrendDirection = 'up' | 'down' | 'flat'

export interface StockTrend {
  /** Net change per game minute over the window. */
  perMinute: number
  direction: TrendDirection
  /** Game seconds until it runs out at this rate, when falling. */
  runway: number | null
  /** Falling fast enough to run dry within `FALLING_FAST_SECONDS`. */
  fallingFast: boolean
}

export interface StockTrends {
  trends: Partial<Record<ResourceId, StockTrend>>
  /** Goods some staffed building is waiting for, with the buildings' names. */
  blocking: Partial<Record<ResourceId, string[]>>
}

interface Snapshot {
  clock: number
  stock: ResourceBag
  /**
   * The player's command totals at the time (`commandStock.ts`): what was
   * spent or earned by hand between two snapshots is left out of the trend,
   * so a build paid for, a sale or an order filled never reads as a good
   * running dry. Absent counts as nothing.
   */
  commands?: ResourceBag
}

const EMPTY: StockTrends = { trends: {}, blocking: {} }

/** Change per minute big enough to call a direction: 2/min, or 4% of the stack. */
function threshold(amount: number): number {
  return Math.max(2, amount * 0.04)
}

/**
 * Pure: the trend of every stock between the oldest and newest snapshot — the
 * economy's own drift, without the player's one-off spends and earnings in
 * between. The runway is the stock on hand now at that drift.
 */
export function trendsBetween(
  oldest: Snapshot,
  newest: Snapshot,
): Partial<Record<ResourceId, StockTrend>> {
  const span = newest.clock - oldest.clock
  const out: Partial<Record<ResourceId, StockTrend>> = {}
  if (span < TREND_MIN_SPAN) return out
  const ids = new Set([
    ...Object.keys(oldest.stock),
    ...Object.keys(newest.stock),
  ]) as Set<ResourceId>
  for (const id of ids) {
    const now = newest.stock[id] ?? 0
    const byHand = (newest.commands?.[id] ?? 0) - (oldest.commands?.[id] ?? 0)
    const perMinute = ((now - (oldest.stock[id] ?? 0) - byHand) / span) * 60
    const cut = threshold(now)
    const direction: TrendDirection = perMinute >= cut ? 'up' : perMinute <= -cut ? 'down' : 'flat'
    const runway = perMinute < 0 ? (now / -perMinute) * 60 : null
    out[id] = {
      perMinute,
      direction,
      runway,
      fallingFast: direction === 'down' && runway !== null && runway < FALLING_FAST_SECONDS,
    }
  }
  return out
}

/** Goods that staffed buildings are waiting on, and who is waiting. */
export function blockingGoods(run: RunState): Partial<Record<ResourceId, string[]>> {
  const mods = computeModifiers(run)
  const used = storageUsed(run)
  const out: Partial<Record<ResourceId, string[]>> = {}
  for (const b of Object.values(run.buildings)) {
    const status = buildingStatus(run, b, mods, used)
    if (status.kind !== 'waitingInputs') continue
    const name = BUILDINGS[b.defId]?.name ?? b.defId
    for (const [id] of status.missing) {
      const list = (out[id] ??= [])
      if (!list.includes(name)) list.push(name)
    }
  }
  return out
}

/**
 * Stock trends for the resource bar. Re-derived only when a snapshot is taken
 * (every few game seconds), never per frame; a new or resumed run, or a clock
 * that went backwards, starts the history afresh.
 */
export function useStockTrends(run: RunState | null): StockTrends {
  const ref = useRef<{ run: RunState | null; history: Snapshot[]; result: StockTrends }>({
    run: null,
    history: [],
    result: EMPTY,
  })
  const state = ref.current
  if (!run) return EMPTY
  const last = state.history[state.history.length - 1]
  if (state.run !== run || (last && run.clock < last.clock)) {
    state.run = run
    state.history = []
    state.result = EMPTY
  }
  const newest = state.history[state.history.length - 1]
  if (!newest || run.clock - newest.clock >= TREND_SAMPLE_SECONDS) {
    state.history.push({ clock: run.clock, stock: { ...run.stock }, commands: commandStockTotals(run) })
    while (state.history.length > 2 && run.clock - state.history[0].clock > TREND_WINDOW_SECONDS) {
      state.history.shift()
    }
    state.result = {
      trends: trendsBetween(state.history[0], state.history[state.history.length - 1]),
      blocking: run.phase === 'playing' ? blockingGoods(run) : {},
    }
  }
  return state.result
}
