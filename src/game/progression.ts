import { evaluateAchievements, type AchievementDef } from './content/achievements'
import { dailyResultOf, dailyStreak, recordDaily } from './content/daily'
import { bankRun, supplyReward } from './engine/meta'
import type { DailyResult, MetaState, RunState } from './types'

/**
 * Everything that happens to the meta save when a finished run is banked, in
 * one pure step: the Citadel payout and ledger (`bankRun`), the daily
 * expedition's result and streak, then achievements judged against both.
 *
 * The end screen calls this too, as a preview, so what it promises is exactly
 * what banking delivers.
 */
export interface RunSettlement {
  meta: MetaState
  /** Supplies from the run itself (`supplyReward`). */
  runSupplies: number
  /** Achievements this run earned, in list order. */
  achievements: AchievementDef[]
  /** Supplies those achievements pay. */
  achievementSupplies: number
  /** The run's daily result (before merging with earlier attempts), if a daily. */
  daily: DailyResult | null
  /** The daily streak once this run is recorded (0 when not a daily). */
  streak: number
}

export function settleRun(meta: MetaState, run: RunState, now = Date.now()): RunSettlement {
  let next = bankRun(meta, run, now)
  const daily = dailyResultOf(run, now)
  let streak = 0
  if (daily) {
    const ledger = recordDaily(next.daily, daily)
    streak = dailyStreak(ledger, daily.date)
    next = { ...next, daily: ledger }
  }
  const judged = evaluateAchievements(next.achievements, run, { dailyStreak: streak }, now)
  next = {
    ...next,
    achievements: judged.state,
    citadelSupplies: next.citadelSupplies + judged.supplies,
  }
  return {
    meta: next,
    runSupplies: supplyReward(run),
    achievements: judged.unlocked,
    achievementSupplies: judged.supplies,
    daily,
    streak,
  }
}
