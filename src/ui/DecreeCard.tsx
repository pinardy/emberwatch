import { DECREES } from '../game/content/decrees'
import { RESOURCES } from '../game/content/resources'
import { DECREE_MISS_IMPATIENCE } from '../game/engine/balance'
import { describeTimedGoal } from '../game/engine/structure'
import { useRun } from '../game/store'

/** Seconds as m:ss. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The live royal decree in the Orders panel: a timed order with a richer
 * reward, a countdown, and the price of missing it. Between decrees it shows
 * when the next one is due.
 */
export function DecreeCard() {
  const run = useRun()
  if (!run) return null
  const decree = run.decree
  const def = decree ? DECREES[decree.defId] : undefined

  if (!decree || !def) {
    return (
      <p className="muted decree-next">
        📯 The next royal decree arrives in about {clockText(run.decreeTimer)}.
      </p>
    )
  }

  const urgent = decree.timeLeft < 60
  return (
    <div className={`order-card decree-card ${urgent ? 'is-urgent' : ''}`}>
      <div className="row-between">
        <strong>📯 {def.name}</strong>
        <span className="order-reward">
          👑 +{def.reputationReward}
          {def.reward?.amber ? ` · ${RESOURCES.amber.icon} ${def.reward.amber}` : ''}
        </span>
      </div>
      <small>{describeTimedGoal(def.goal)}</small>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${decree.progress * 100}%` }} />
      </div>
      <div className="row-between">
        <small className="muted">{Math.floor(decree.progress * 100)}%</small>
        <small className={`decree-clock ${urgent ? 'is-bad' : ''}`}>
          ⏱ {clockText(decree.timeLeft)} left · miss it: ⏳ +{DECREE_MISS_IMPATIENCE}
        </small>
      </div>
    </div>
  )
}
