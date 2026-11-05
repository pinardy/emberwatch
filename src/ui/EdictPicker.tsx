import {
  EDICTS,
  EDICT_REWARD_STEP,
  MAX_EDICT,
  edictLabel,
} from '../game/content/meta'
import { edictArt } from '../game/content/art'
import { Icon } from './Icon'

/**
 * The Queen's Edict ladder. Each rung adds its own condition on top of every
 * rung below it. Used as a picker on the setup screen and as a read-only
 * overview in the Citadel (omit `onPick`).
 */
export function EdictPicker({
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
  const levels = Array.from({ length: MAX_EDICT + 1 }, (_, i) => i)
  return (
    <div className="edict-ladder" role={onPick ? 'radiogroup' : undefined}>
      {levels.map((level) => {
        const def = EDICTS.find((d) => d.level === level)
        const locked = level > unlocked
        const picked = value === level
        const bonus = Math.round(level * EDICT_REWARD_STEP * 100)
        const body = (
          <>
            <strong>
              {def ? <Icon id={edictArt(level)} emoji={def.icon} /> : <Icon id="dove" emoji="🕊️" />}{' '}
              {edictLabel(level)}
            </strong>
            <small>{def ? `${def.name}: ${def.description}` : 'The standard terms.'}</small>
            <em>{locked ? <><Icon id="lock" emoji="🔒" /> Win the rung below</> : bonus > 0 ? `+${bonus}% supplies` : 'Base supplies'}</em>
          </>
        )
        const className = `edict-step ${picked ? 'is-picked' : ''} ${locked ? 'is-locked' : ''}`
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
