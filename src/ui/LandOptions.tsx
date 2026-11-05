import { modifierPool, type LandChoice, type LandPowers } from '../game/engine/runModifiers'
import './replay.css'

/**
 * Setup-screen controls for the Citadel's land upgrades: the Second Survey's
 * re-roll and Chosen Ground's pick. Renders nothing for a Citadel without them.
 * Both need a fixed seed to preview, so using either pins a random seed first.
 */
export function LandOptions({
  powers,
  choice,
  onChange,
  ensureSeed,
}: {
  powers: LandPowers
  choice: LandChoice
  onChange: (next: LandChoice) => void
  /** Called before a change, so the preview has a seed to draw from. */
  ensureSeed: () => void
}) {
  const canReroll = powers.landRerolls > 0
  if (!canReroll && !powers.chooseModifier) return null
  const pool = modifierPool(powers.unlockModifiers)

  return (
    <div className="land-options">
      {canReroll && (
        <button
          type="button"
          aria-pressed={!!choice.reroll}
          onClick={() => {
            ensureSeed()
            onChange({ ...choice, reroll: !choice.reroll })
          }}
        >
          {choice.reroll ? "↩ Back to the seed's own land" : '🔭 Re-roll the land (Second Survey)'}
        </button>
      )}
      {powers.chooseModifier && (
        <label>
          <span>📌 Chosen ground</span>
          <select
            value={choice.chosen ?? ''}
            onChange={(e) => {
              ensureSeed()
              onChange({ ...choice, chosen: e.target.value || undefined })
            }}
          >
            <option value="">Let the seed decide</option>
            {pool.map((d) => (
              <option key={d.id} value={d.id}>
                {d.icon} {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
