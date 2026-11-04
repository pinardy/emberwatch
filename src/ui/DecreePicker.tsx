import {
  DECREES,
  DECREE_REWARD_STEP,
  MAX_DECREE,
  decreeLabel,
} from '../game/content/meta'

/**
 * The Queen's Decree ladder. Each rung adds its own condition on top of every
 * rung below it. Used as a picker on the setup screen and as a read-only
 * overview in the Citadel (omit `onPick`).
 */
export function DecreePicker({
  unlocked,
  value,
  onPick,
}: {
  /** Highest level that may be chosen. */
  unlocked: number
  /** Currently chosen level (setup screen only). */
  value?: number
  onPick?: (level: number) => void
}) {
  const levels = Array.from({ length: MAX_DECREE + 1 }, (_, i) => i)
  return (
    <div className="decree-ladder" role={onPick ? 'radiogroup' : undefined}>
      {levels.map((level) => {
        const def = DECREES.find((d) => d.level === level)
        const locked = level > unlocked
        const picked = value === level
        const bonus = Math.round(level * DECREE_REWARD_STEP * 100)
        const body = (
          <>
            <strong>
              {def ? `${def.icon} ` : '🕊️ '}
              {decreeLabel(level)}
            </strong>
            <small>{def ? `${def.name}: ${def.description}` : 'The standard terms.'}</small>
            <em>{locked ? '🔒 Win the rung below' : bonus > 0 ? `+${bonus}% supplies` : 'Base supplies'}</em>
          </>
        )
        const className = `decree-step ${picked ? 'is-picked' : ''} ${locked ? 'is-locked' : ''}`
        return onPick ? (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={picked}
            className={className}
            disabled={locked}
            onClick={() => onPick(level)}
          >
            {body}
          </button>
        ) : (
          <div key={level} className={className}>
            {body}
          </div>
        )
      })}
    </div>
  )
}
