import { BUILDINGS } from '../game/content/buildings'
import { CHARTERS } from '../game/content/charters'
import { useGameStore } from '../game/store'
import type { PendingChoice } from '../game/types'
import { Icon } from './Icon'
import { charterArt } from '../game/content/art'

/**
 * The Queen's one-time charter: a run-shaping perk, breathing room with the
 * Queen, or a guaranteed blueprint. Rendered inside the choice modal overlay.
 */
export function CharterChoice({ choice }: { choice: PendingChoice }) {
  const chooseOption = useGameStore((s) => s.chooseOption)
  const blueprint = choice.blueprintId ? BUILDINGS[choice.blueprintId] : undefined
  return (
    <div className="modal modal-charter">
      <header>
        <span className="modal-icon">
          <Icon id="reputation" emoji="👑" />
        </span>
        <div>
          <h2>The Queen's Charter</h2>
          <small>
            Your settlement has caught the Crown's eye. Choose one charter — it is
            granted once, and it is permanent.
          </small>
        </div>
      </header>
      <div className="option-list option-grid">
        {choice.options.map((id) => {
          const def = CHARTERS[id]
          if (!def) return null
          return (
            <button
              key={id}
              type="button"
              className={`option charter-${def.family}`}
              onClick={() => chooseOption(id)}
            >
              <span className="option-icon">
                <Icon id={charterArt(def)} emoji={def.icon} />
              </span>
              <strong>{def.name}</strong>
              <em className="rarity-tag">{FAMILY_LABEL[def.family]}</em>
              <small>{def.description}</small>
              {def.grantsBlueprint && blueprint && (
                <small className="is-good">
                  Grants: <Icon of={blueprint} /> {blueprint.name}
                </small>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const FAMILY_LABEL = {
  perk: 'run-shaping perk',
  patience: "the Queen's patience",
  blueprint: 'guaranteed blueprint',
} as const
