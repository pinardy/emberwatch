import { DECREES } from '../game/content/decrees'
import { RESOURCES } from '../game/content/resources'
import { formatClock } from '../game/engine/forecast'
import {
  decreeGoal,
  decreeMissImpatience,
  decreeReputation,
  decreeStreakBonus,
  describeTimedGoal,
} from '../game/engine/structure'
import { useHudRun } from '../game/store'
import type { RunState } from '../game/types'
import { Icon } from './Icon'

/** The impatience a lapse would cost now, to two decimals. */
export function decreeMissCost(run: RunState): number {
  return Math.round(decreeMissImpatience(run) * 100) / 100
}

/**
 * The live royal decree in the Orders panel: a timed order with a richer
 * reward, a countdown, and the price of missing it. Between decrees it shows
 * when the next one is due.
 */
export function DecreeCard() {
  const run = useHudRun()
  if (!run) return null
  const decree = run.decree
  const def = decree ? DECREES[decree.defId] : undefined
  const goal = decree ? decreeGoal(decree) : undefined

  if (!decree || !def || !goal) {
    return (
      <p className="muted decree-next">
        <Icon id="horn" emoji="📯" /> The next royal decree arrives in about {formatClock(run.decreeTimer)}.
      </p>
    )
  }

  const urgent = decree.timeLeft < 60
  const reputation = decreeReputation(run, def)
  return (
    <div className={`order-card decree-card ${urgent ? 'is-urgent' : ''}`}>
      <div className="row-between">
        <strong>
          <Icon id="horn" emoji="📯" /> {def.name}
        </strong>
        <span className="order-reward">
          {reputation > 0 ? (
            <>
              <Icon id="reputation" label="reputation" /> +{reputation}
            </>
          ) : null}
          {def.impatienceRelief ? (
            <>
              {' '}
              <Icon id="impatience" label="impatience" /> −{def.impatienceRelief}
            </>
          ) : null}
          {def.reward?.amber ? (
            <>
              {' · '}
              <Icon of={RESOURCES.amber} label="amber" /> {def.reward.amber}
            </>
          ) : null}
        </span>
      </div>
      <small>{describeTimedGoal(goal)}</small>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${decree.progress * 100}%` }} />
      </div>
      <div className="row-between">
        <small className="muted">{Math.floor(decree.progress * 100)}%</small>
        <small className={`decree-clock ${urgent ? 'is-bad' : ''}`}>
          ⏱ {formatClock(decree.timeLeft)} left · miss it: <Icon id="impatience" label="impatience" /> +{decreeMissCost(run)}
        </small>
      </div>
      <StreakLine streak={run.decreeStreak ?? 0} />
    </div>
  )
}

/** The streak this decree would extend, and what meeting it adds. */
function StreakLine({ streak }: { streak: number }) {
  if (streak <= 0) return null
  const purse = decreeStreakBonus(streak + 1)
  return (
    <small className="muted decree-streak">
      {streak} met in a row
      {purse > 0 ? ` · meet this one for +${purse} amber more` : ''}
    </small>
  )
}
