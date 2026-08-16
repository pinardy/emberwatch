import { useEffect, useRef, useState } from 'react'
import { SEASON_INFO } from '../game/engine/balance'
import { MAX_HOSTILITY } from '../game/engine/tick'
import { computeModifiers } from '../game/engine/modifiers'
import { idleVillagers, population, totalHousing } from '../game/engine/queries'
import { resolveBreakdowns } from '../game/engine/society'
import { SPECIES } from '../game/content/species'
import { useGameStore, useRun } from '../game/store'
import { SPEED_OPTIONS } from '../game/engine/balance'

interface Float {
  id: number
  text: string
  tone: 'good' | 'bad'
}

/**
 * Floating "+1"s over a meter when its integer value moves. Purely cosmetic —
 * the number that matters is already on the meter.
 */
function useFloaters(value: number, direction: 'up-good' | 'up-bad'): Float[] {
  const [floats, setFloats] = useState<Float[]>([])
  const prev = useRef(value)
  const counter = useRef(0)

  useEffect(() => {
    const delta = value - prev.current
    prev.current = value
    if (delta === 0) return
    const tone: Float['tone'] =
      (delta > 0) === (direction === 'up-good') ? 'good' : 'bad'
    const float: Float = {
      id: counter.current++,
      text: `${delta > 0 ? '+' : ''}${delta}`,
      tone,
    }
    // Cap the stack; each float removes itself when its animation ends. No
    // cleanup here — cancelling the timer on the next change would strand the
    // previous float on screen.
    setFloats((fs) => [...fs.slice(-3), float])
    window.setTimeout(
      () => setFloats((fs) => fs.filter((f) => f.id !== float.id)),
      1400,
    )
  }, [value, direction])

  return floats
}

export function TopBar() {
  const run = useRun()
  const speed = useGameStore((s) => s.speed)
  const setSpeed = useGameStore((s) => s.setSpeed)
  const goToScreen = useGameStore((s) => s.goToScreen)
  const sound = useGameStore((s) => s.settings.sound)
  const renderer = useGameStore((s) => s.settings.renderer)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const repFloats = useFloaters(run?.reputation ?? 0, 'up-good')
  const impFloats = useFloaters(run?.impatience ?? 0, 'up-bad')
  if (!run) return null

  const info = SEASON_INFO[run.season.season]
  const seasonPct = run.season.elapsed / run.season.length
  const pop = population(run)
  const housing = totalHousing(run)
  const idle = idleVillagers(run).length
  const mods = computeModifiers(run)
  const breakdowns = resolveBreakdowns(run, mods)

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="icon-btn"
          onClick={() => goToScreen('menu')}
          title="Menu"
        >
          ☰
        </button>

        <div className={`season season-${run.season.season}`}>
          <div className="season-ring" style={{ ['--pct' as string]: seasonPct }}>
            <span>{info.icon}</span>
          </div>
          <div className="season-text">
            <strong>{info.name}</strong>
            <small>
              Year {run.season.year} · {Math.ceil(run.season.length - run.season.elapsed)}s
            </small>
          </div>
        </div>

        <div className="speed-group" role="group" aria-label="Game speed">
          {SPEED_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={speed === option ? 'is-active' : ''}
              onClick={() => setSpeed(option)}
              title={option === 0 ? 'Pause (space)' : `${option}× speed`}
            >
              {option === 0 ? '⏸' : `${option}×`}
            </button>
          ))}
        </div>
      </div>

      <div className="topbar-meters">
        <Meter
          label="Reputation"
          icon="👑"
          value={run.reputation}
          max={run.maxReputation}
          fraction={run.reputationProgress}
          tone="good"
          hint="Win at maximum reputation. Earned from high resolve and completed orders."
          floats={repFloats}
        />
        <Meter
          label="Impatience"
          icon="⏳"
          value={run.impatience}
          max={run.maxImpatience}
          fraction={run.impatienceProgress}
          tone="bad"
          hint="You lose if this fills. Grows over time, and faster when villagers leave."
          floats={impFloats}
          pulseKey={run.impatience}
        />
        <Meter
          label="Hostility"
          icon="🌩️"
          value={Math.round(run.hostility)}
          max={MAX_HOSTILITY}
          fraction={0}
          tone="warn"
          hint="Lowers resolve for everyone. Rises with time, population and cleared glades."
        />
      </div>

      <div className="topbar-right">
        <button
          type="button"
          className="icon-btn"
          onClick={() => updateSettings({ renderer: renderer === '3d' ? '2d' : '3d' })}
          title={renderer === '3d' ? 'Switch to 2D map' : 'Switch to 3D map'}
          aria-label={renderer === '3d' ? 'Switch to 2D map' : 'Switch to 3D map'}
        >
          {renderer === '3d' ? '🗺️' : '🏔️'}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => updateSettings({ sound: !sound })}
          title={sound ? 'Mute sound' : 'Unmute sound'}
          aria-label={sound ? 'Mute sound' : 'Unmute sound'}
        >
          {sound ? '🔊' : '🔇'}
        </button>
        <div className="stat" title="Population and housing">
          <span>🧑‍🤝‍🧑</span>
          <strong className={pop > housing ? 'is-bad' : ''}>
            {pop}/{housing}
          </strong>
        </div>
        <div className="stat" title="Idle villagers — they also act as builders">
          <span>💤</span>
          <strong className={idle > 0 ? 'is-warn' : ''}>{idle}</strong>
        </div>
        <div className="resolve-chips">
          {breakdowns.map((b) => (
            <div
              key={b.species}
              className="resolve-chip"
              title={`${SPECIES[b.species].name}: resolve ${b.current.toFixed(
                1,
              )} (target ${b.target.toFixed(1)}, reputation above ${b.threshold})`}
            >
              <span>{SPECIES[b.species].icon}</span>
              <strong
                className={
                  b.current < 0 ? 'is-bad' : b.current >= b.threshold ? 'is-good' : ''
                }
              >
                {Math.round(b.current)}
              </strong>
            </div>
          ))}
        </div>
      </div>
    </header>
  )
}

interface MeterProps {
  label: string
  icon: string
  value: number
  max: number
  fraction: number
  tone: 'good' | 'bad' | 'warn'
  hint: string
  floats?: Float[]
  /** Changing this key replays the pulse animation (impatience ticking up). */
  pulseKey?: number
}

function Meter({ label, icon, value, max, fraction, tone, hint, floats, pulseKey }: MeterProps) {
  const pct = ((value + Math.min(1, fraction)) / max) * 100
  return (
    <div className={`meter meter-${tone}`} title={hint} key={pulseKey !== undefined ? `p${pulseKey}` : undefined}>
      <div className="meter-head">
        <span>{icon}</span>
        <span className="meter-label">{label}</span>
        <strong className={pulseKey !== undefined ? 'pulse-once' : undefined}>
          {value}
          <small>/{max}</small>
        </strong>
      </div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {floats && floats.length > 0 && (
        <div className="floaters" aria-hidden>
          {floats.map((f) => (
            <span key={f.id} className={`floater is-${f.tone}`}>
              {f.text}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
