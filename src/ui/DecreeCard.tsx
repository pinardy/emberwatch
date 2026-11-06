import { DECREES } from '../game/content/decrees'
import { RESOURCES } from '../game/content/resources'
import { computeModifiers } from '../game/engine/modifiers'
import {
  decreeGoal,
  decreeMissImpatience,
  decreeStreakBonus,
  describeTimedGoal,
} from '../game/engine/structure'
import { useHudRun } from '../game/store'
import { Icon } from './Icon'

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
  const run = useHudRun()
  if (!run) return null
  const decree = run.decree
  const def = decree ? DECREES[decree.defId] : undefined
  const goal = decree ? decreeGoal(decree) : undefined

  if (!decree || !def || !goal) {
    return (
      <p className="muted decree-next">
        <Icon id="horn" emoji="📯" /> The next royal decree arrives in about {clockText(run.decreeTimer)}.
      </p>
    )
  }

  const urgent = decree.timeLeft < 60
  const mods = computeModifiers(run)
  const missCost = Math.round(decreeMissImpatience(run) * 100) / 100
  return (
    <div className={`order-card decree-card ${urgent ? 'is-urgent' : ''}`}>
      <div className="row-between">
        <strong>
          <Icon id="horn" emoji="📯" /> {def.name}
        </strong>
        <span className="order-reward">
          {Math.max(0, def.reputationReward + mods.decreeReputation) > 0 ? (
            <>
              <Icon id="reputation" label="reputation" /> +{Math.max(0, def.reputationReward + mods.decreeReputation)}
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
          ⏱ {clockText(decree.timeLeft)} left · miss it: <Icon id="impatience" label="impatience" /> +{missCost}
        </small>
      </div>
      <StreakLine streak={run.decreeStreak ?? 0} />
    </div>
  )
}

/** The streak this decree would extend, and what meeting it adds. */
function StreakLine({ streak }: { streak: number }) {
  if (streak <= 0) return null
  const bonus = decreeStreakBonus(streak + 1)
  return (
    <small className="muted decree-streak">
      {streak} met in a row
      {bonus.reputation > 0
        ? ` · meet this one for +${bonus.reputation} reputation more`
        : bonus.amber > 0
          ? ` · meet this one for +${bonus.amber} amber more`
          : ''}
    </small>
  )
}
