import { AUTO_PAUSE_OPTIONS } from '../game/autoPause'
import { useGameStore } from '../game/store'

/** The opt-in auto-pause triggers, shared by the menu and the in-game popover. */
export function AutoPauseFields() {
  const autoPause = useGameStore((s) => s.settings.autoPause)
  const updateSettings = useGameStore((s) => s.updateSettings)
  return (
    <fieldset className="auto-pause-fields">
      <legend>Auto-pause when…</legend>
      {AUTO_PAUSE_OPTIONS.map((option) => (
        <label key={option.id}>
          <input
            type="checkbox"
            checked={autoPause[option.id]}
            onChange={(e) =>
              updateSettings({ autoPause: { ...autoPause, [option.id]: e.target.checked } })
            }
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  )
}

/** Pause-on-hidden: the oldest pause setting, shown beside the triggers. */
export function PauseOnBlurField() {
  const pauseOnBlur = useGameStore((s) => s.settings.pauseOnBlur)
  const updateSettings = useGameStore((s) => s.updateSettings)
  return (
    <label>
      <input
        type="checkbox"
        checked={pauseOnBlur}
        onChange={(e) => updateSettings({ pauseOnBlur: e.target.checked })}
      />
      Pause when you switch to another tab or app
    </label>
  )
}
