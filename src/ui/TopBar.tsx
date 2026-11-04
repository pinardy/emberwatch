import { useEffect, useMemo, useRef, useState } from 'react'
import { IMPATIENCE_HOSTILITY_THRESHOLD, SEASON_INFO } from '../game/engine/balance'
import { MAX_HOSTILITY } from '../game/engine/tick'
import {
  RUNWAY_WARNING_SECONDS,
  formatDuration,
  hearthForecast,
  meterRates,
  secondsUntilStorm,
} from '../game/engine/forecast'
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
  const version = useGameStore((s) => s.version)
  // Modifiers and resolve walk the whole settlement: once per sim step only.
  const derived = useMemo(() => {
    if (!run) return null
    const mods = computeModifiers(run)
    return {
      breakdowns: resolveBreakdowns(run, mods),
      rates: meterRates(run, mods),
      hearth: hearthForecast(run, mods),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, version])
  if (!run || !derived) return null

  const info = SEASON_INFO[run.season.season]
  const seasonPct = run.season.elapsed / run.season.length
  const pop = population(run)
  const housing = totalHousing(run)
  const idle = idleVillagers(run).length
  const { breakdowns, rates, hearth } = derived
  const untilStorm = secondsUntilStorm(run)
  const storm = run.season.season === 'storm'
  const hearthDanger = run.coldHearth || hearth.runway < RUNWAY_WARNING_SECONDS
  const hearthCaution =
    !hearthDanger && hearth.stormShortfall > 0 && run.season.season !== 'drizzle'

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
              Year {run.season.year} · {formatDuration(run.season.length - run.season.elapsed)}{' '}
              left
            </small>
            {untilStorm !== null && (
              <small className={`season-next ${untilStorm <= 60 ? 'is-warn' : ''}`}>
                {SEASON_INFO.storm.icon} Storm in {formatDuration(untilStorm)}
              </small>
            )}
          </div>
        </div>

        <div className="speed-group" role="group" aria-label="Game speed">
          {SPEED_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={speed === option ? 'is-active' : ''}
              onClick={() => setSpeed(option)}
              title={option === 0 ? 'Pause (Space)' : `${option}× speed (key ${option})`}
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
          rate={`+${rates.impatiencePerMinute.toFixed(2)}/min`}
          hint={`You lose if this fills. Grows ${rates.impatiencePerMinute.toFixed(
            2,
          )} per minute right now — faster each year, once hostility passes ${IMPATIENCE_HOSTILITY_THRESHOLD}, and with every villager who leaves.`}
          floats={impFloats}
          pulseKey={run.impatience}
        />
        <Meter
          label="Hostility"
          icon="🌩️"
          value={Math.floor(run.hostility)}
          max={MAX_HOSTILITY}
          fraction={run.hostility - Math.floor(run.hostility)}
          tone="warn"
          rate={`+${rates.hostilityPerMinute.toFixed(1)}/min`}
          hint={`Lowers resolve for everyone. Rises ${rates.hostilityPerMinute.toFixed(
            1,
          )} per minute right now, plus each cleared glade, threat strike and Storm. Above ${IMPATIENCE_HOSTILITY_THRESHOLD} it also wears on the Queen.`}
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
        <div
          className={`stat hearth-stat ${hearthDanger ? 'is-bad' : hearthCaution ? 'is-warn' : ''}`}
          title={hearthTitle(hearth, storm, run.coldHearth)}
          aria-label={`Hearth fuel: ${run.coldHearth ? 'out' : formatDuration(hearth.runway)}`}
        >
          <span>🔥</span>
          <strong>
            {(hearthDanger || hearthCaution) && <em className="stat-alert">!</em>}
            {run.coldHearth ? 'Out' : formatDuration(hearth.runway)}
          </strong>
          {!storm && !run.coldHearth && (
            <small className="hearth-storm">
              {SEASON_INFO.storm.icon}
              {formatDuration(hearth.stormRunway)}
            </small>
          )}
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
              )} (heading for ${b.target.toFixed(1)}). Earns reputation above ${b.threshold}.`}
            >
              <span>{SPECIES[b.species].icon}</span>
              <strong
                className={
                  b.current < 0 ? 'is-bad' : b.current >= b.threshold ? 'is-good' : ''
                }
              >
                {Math.round(b.current)}
              </strong>
              <small className="resolve-chip-threshold">/{b.threshold}</small>
              {Math.abs(b.target - b.current) >= 0.5 && (
                <em
                  className={`resolve-trend ${b.target > b.current ? 'is-up' : 'is-down'}`}
                  aria-label={b.target > b.current ? 'rising' : 'falling'}
                >
                  {b.target > b.current ? '▲' : '▼'}
                </em>
              )}
            </div>
          ))}
        </div>
      </div>
    </header>
  )
}

function hearthTitle(
  hearth: ReturnType<typeof hearthForecast>,
  storm: boolean,
  cold: boolean,
): string {
  if (cold) return 'The hearth is out of wood. Villagers are cold and resolve is falling.'
  const now = `${Math.floor(hearth.wood)} wood burns at ${hearth.rate.toFixed(
    2,
  )}/s — about ${formatDuration(hearth.runway)} of fuel.`
  if (storm) return `Hearth: ${now}`
  const shortfall =
    hearth.stormShortfall > 0
      ? ` About ${Math.ceil(hearth.stormShortfall)} more wood is needed to see out the next Storm.`
      : ''
  return `Hearth: ${now} In the Storm it burns ${hearth.stormRate.toFixed(
    2,
  )}/s, so this lasts ${formatDuration(hearth.stormRunway)}.${shortfall}`
}

interface MeterProps {
  label: string
  icon: string
  value: number
  max: number
  /** Progress toward the next whole point, 0..1. */
  fraction: number
  tone: 'good' | 'bad' | 'warn'
  hint: string
  /** Compact growth rate shown beside the label, e.g. "+0.2/min". */
  rate?: string
  floats?: Float[]
  /** Changing this key replays the pulse animation (impatience ticking up). */
  pulseKey?: number
}

function Meter({
  label,
  icon,
  value,
  max,
  fraction,
  tone,
  hint,
  rate,
  floats,
  pulseKey,
}: MeterProps) {
  const pct = ((value + Math.min(1, Math.max(0, fraction))) / max) * 100
  return (
    <div className={`meter meter-${tone}`} title={hint}>
      <div className="meter-head">
        <span>{icon}</span>
        <span className="meter-label">
          {label}
          {rate && <small className="meter-rate"> {rate}</small>}
        </span>
        {/* Only the number remounts to replay its pulse; the bar keeps its transition. */}
        <strong
          key={pulseKey !== undefined ? `p${pulseKey}` : undefined}
          className={pulseKey !== undefined ? 'pulse-once' : undefined}
        >
          {value}
          <small>/{max}</small>
        </strong>
      </div>
      <div
        className="meter-track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round((pct / 100) * max * 10) / 10}
      >
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
