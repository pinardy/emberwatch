import { DECREES } from '../game/content/decrees'
import { decreeGoal } from '../game/engine/structure'
import { describeTimedGoal } from '../game/engine/goals'
import { useGameStore, useHudRun } from '../game/store'
import { formatClock } from '../game/engine/forecast'
import type { ActiveCondition } from '../game/types'
import { conditionArt } from '../game/content/artFamilies'
import { Bar } from './Bar'
import { Icon } from './Icon'
import { IconText } from './IconText'
import { outcomeWords } from './threatText'

/**
 * Lingering glade conditions and the live royal decree, shown beside the
 * threat bar: what each one costs, what lifts it, and how far along that is.
 */
export function ConditionsBar() {
  const run = useHudRun()
  const setPanel = useGameStore((s) => s.setPanel)
  const focusCamera = useGameStore((s) => s.focusCamera)
  if (!run) return null
  const decree = run.decree
  const decreeDef = decree ? DECREES[decree.defId] : undefined
  if (run.conditions.length === 0 && !decreeDef) return null

  return (
    <div className="conditions-bar" role="group" aria-label="Conditions and decrees">
      {decree && decreeDef && (
        <button
          type="button"
          className={`condition-card is-decree ${decree.timeLeft < 60 ? 'is-urgent' : ''}`}
          onClick={() => setPanel('orders')}
          title="Open the Queen's orders"
        >
          <span className="condition-icon">
            <Icon id="horn" emoji="📯" />
          </span>
          <span className="condition-text">
            <strong>
              {decreeDef.name}
              <em className="condition-clock">⏱ {formatClock(decree.timeLeft)}</em>
            </strong>
            <small>{describeTimedGoal(decreeGoal(decree) ?? decreeDef.goal)}</small>
            <Progress value={decree.progress} />
          </span>
        </button>
      )}
      {run.conditions.map((condition) => {
        const glade = run.glades[condition.gladeId]
        return (
          <button
            type="button"
            key={condition.id}
            className={`condition-card ${condition.breaksWithStorm ? 'is-blight ' : ''}${condition.timeLeft !== undefined && condition.timeLeft < 60 ? 'is-urgent' : ''}`}
            onClick={() => glade && focusCamera(glade.center)}
            title={glade ? `Left behind at ${glade.name}` : undefined}
          >
            <span className="condition-icon">
              <Icon id={conditionArt(condition)} emoji={condition.icon} />
            </span>
            <span className="condition-text">
              <strong>
                {condition.name}
                {condition.timeLeft !== undefined && (
                  <em className="condition-clock">⏱ {formatClock(condition.timeLeft)}</em>
                )}
              </strong>
              <small>{condition.description}</small>
              <small className="condition-goal">
                To lift: {describeTimedGoal(condition.resolveBy)}
                {condition.consume ? ' (handed over)' : ''}
                <IconText text={outcomeText(condition)} anywhere />
              </small>
              <Progress value={condition.progress} />
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Progress({ value }: { value: number }) {
  return <Bar value={value} className="condition-progress" aria-label={`${Math.floor(value * 100)}%`} />
}

function outcomeText(c: ActiveCondition): string {
  const win = outcomeWords(c.onResolve)
  const lose = outcomeWords(c.onFail)
  return `${win ? ` · reward ${win}` : ''}${lose ? ` · fail ${lose}` : ''}`
}
