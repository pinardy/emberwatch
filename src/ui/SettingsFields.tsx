import { AUTO_PAUSE_OPTIONS } from '../game/autoPause'
import type { VolumeChannel } from '../game/persistence'
import { useGameStore } from '../game/store'
import './sound-fields.css'

const VOLUME_SLIDERS: { id: VolumeChannel; label: string; hint: string }[] = [
  { id: 'master', label: 'Master volume', hint: 'Everything at once' },
  { id: 'music', label: 'Music', hint: 'The ambient score' },
  { id: 'effects', label: 'Effects', hint: 'Event cues and clicks' },
  { id: 'ambience', label: 'Rain', hint: 'The rain ambience' },
]

/**
 * The mute switch and the mixer, shared by the menu and the in-game popover.
 * Sliders are native range inputs, so keyboard, touch and screen readers all
 * work; each announces its level as a percentage, and says so when muted.
 */
export function SoundFields() {
  const sound = useGameStore((s) => s.settings.sound)
  const volume = useGameStore((s) => s.settings.volume)
  const updateSettings = useGameStore((s) => s.updateSettings)
  return (
    <fieldset className="sound-fields">
      <legend>Sound</legend>
      <label>
        <input
          type="checkbox"
          checked={sound}
          onChange={(e) => updateSettings({ sound: e.target.checked })}
        />
        Sound, music & rain ambience
      </label>
      {VOLUME_SLIDERS.map((slider) => {
        const percent = Math.round(volume[slider.id] * 100)
        return (
          <label key={slider.id} className="volume-slider" title={slider.hint}>
            <span className="volume-name">{slider.label}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={percent}
              aria-valuetext={sound ? `${percent}%` : `${percent}%, muted`}
              onChange={(e) =>
                updateSettings({
                  volume: { ...volume, [slider.id]: Number(e.target.value) / 100 },
                })
              }
            />
            <output aria-hidden>{percent}%</output>
          </label>
        )
      })}
    </fieldset>
  )
}

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

/**
 * The opt-in performance readout (fps, frame time and the 3D map's draw
 * calls), for checking the game on real hardware. Off by default.
 */
export function PerfField() {
  const showPerf = useGameStore((s) => s.settings.showPerf)
  const updateSettings = useGameStore((s) => s.updateSettings)
  return (
    <label>
      <input
        type="checkbox"
        checked={showPerf}
        onChange={(e) => updateSettings({ showPerf: e.target.checked })}
      />
      Show performance (fps, frame time, draw calls)
    </label>
  )
}
