import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IMPATIENCE_HOSTILITY_THRESHOLD, SEASON_INFO } from '../game/engine/balance'
import { MAX_HOSTILITY } from '../game/engine/tick'
import {
  RUNWAY_WARNING_SECONDS,
  deadlineForecast,
  formatDuration,
  hearthForecast,
  meterRates,
  secondsUntilStorm,
  type DeadlineForecast,
} from '../game/engine/forecast'
import { computeModifiers } from '../game/engine/modifiers'
import {
  idleVillagers,
  population,
  secondsUntilDeparture,
  totalHousing,
} from '../game/engine/queries'
import { resolveBreakdowns } from '../game/engine/society'
import { SPECIES } from '../game/content/species'
import { useGameStore, useRun } from '../game/store'
import { SPEED_OPTIONS } from '../game/engine/balance'
import type { RunState, SpeciesId } from '../game/types'
import { AutoPauseFields, PauseOnBlurField, SoundFields } from './SettingsFields'
import { useEscapeLayer } from './useGameLoop'

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

/** Share of the Queen's patience at which the impatience meter turns urgent. */
const IMPATIENCE_CRITICAL_SHARE = 0.8

interface StatusAlert {
  id: string
  icon: string
  text: string
  severity: 'danger' | 'caution'
}

type Popover = 'status' | 'settings' | 'speed' | null

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
  const [popover, setPopover] = useState<Popover>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const speedRef = useRef<HTMLDivElement>(null)
  // Modifiers and resolve walk the whole settlement: once per sim step only.
  const derived = useMemo(() => {
    if (!run) return null
    const mods = computeModifiers(run)
    return {
      breakdowns: resolveBreakdowns(run, mods),
      rates: meterRates(run, mods),
      hearth: hearthForecast(run, mods),
      departures: secondsUntilDeparture(run),
      deadline: deadlineForecast(run, mods),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, version])

  useEscapeLayer(popover !== null, () => setPopover(null))

  // A tap anywhere outside the open popover (and its button) closes it.
  useEffect(() => {
    if (!popover) return
    const onPointer = (e: PointerEvent) => {
      const host = {
        status: statusRef.current,
        settings: settingsRef.current,
        speed: speedRef.current,
      }[popover]
      if (host && !host.contains(e.target as Node)) setPopover(null)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [popover])

  if (!run || !derived) return null

  const info = SEASON_INFO[run.season.season]
  const seasonPct = run.season.elapsed / run.season.length
  const seasonLeft = formatDuration(run.season.length - run.season.elapsed)
  const pop = population(run)
  const housing = totalHousing(run)
  const idle = idleVillagers(run).length
  const { breakdowns, rates, hearth, departures, deadline } = derived
  const untilStorm = secondsUntilStorm(run)
  const storm = run.season.season === 'storm'
  const hearthDanger = run.coldHearth || hearth.runway < RUNWAY_WARNING_SECONDS
  const hearthCaution =
    !hearthDanger && hearth.stormShortfall > 0 && run.season.season !== 'drizzle'
  const impatienceCritical =
    run.impatience + run.impatienceProgress >= run.maxImpatience * IMPATIENCE_CRITICAL_SHARE

  const alerts = statusAlerts({
    run,
    hearthDanger,
    hearthCaution,
    impatienceCritical,
    overcrowded: pop > housing,
    departures,
    breakdowns,
    untilStorm,
  })
  const dangers = alerts.filter((a) => a.severity === 'danger').length
  const alertIcons = [...new Set(alerts.map((a) => a.icon))].slice(0, 2)
  const statusLabel = [
    'Settlement status',
    `${idle} idle`,
    alerts.length > 0
      ? `${alerts.length} alert${alerts.length > 1 ? 's' : ''}: ${alerts.map((a) => a.text).join('; ')}`
      : 'all well',
  ].join(', ')

  const toggle = (which: Exclude<Popover, null>) =>
    setPopover((open) => (open === which ? null : which))

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="icon-btn"
          onClick={() => goToScreen('menu')}
          title="Menu"
          aria-label="Menu"
        >
          ☰
        </button>

        <div className={`season season-${run.season.season}`}>
          <div
            className="season-ring"
            style={{ ['--pct' as string]: seasonPct }}
            title={`${info.name}, Year ${run.season.year}: ${seasonLeft} left${
              untilStorm !== null ? `. Storm in ${formatDuration(untilStorm)}` : ''
            }`}
          >
            <span>{info.icon}</span>
          </div>
          <div className="season-text">
            <strong>{info.name}</strong>
            <small>
              Year {run.season.year} · {seasonLeft} left
            </small>
            {untilStorm !== null && (
              <small className={`season-next ${untilStorm <= 60 ? 'is-warn' : ''}`}>
                {SEASON_INFO.storm.icon} Storm in {formatDuration(untilStorm)}
              </small>
            )}
          </div>
        </div>

        <div className="topbar-anchor speed-anchor" ref={speedRef}>
          {/* Phones fold the six speeds behind this; desktop hides it. */}
          <button
            type="button"
            className={`speed-toggle ${speed === 0 ? 'is-paused' : ''} ${
              popover === 'speed' ? 'is-open' : ''
            }`}
            onClick={() => toggle('speed')}
            aria-expanded={popover === 'speed'}
            aria-controls="speed-group"
            aria-label={`Game speed: ${speed === 0 ? 'paused' : `${speed}×`}`}
            title="Game speed"
          >
            {speed === 0 ? '⏸' : `${speed}×`}
            <span className="speed-chevron" aria-hidden>
              ▾
            </span>
          </button>
          <div
            id="speed-group"
            className={`speed-group ${popover === 'speed' ? 'is-open' : ''}`}
            role="group"
            aria-label="Game speed"
          >
            {SPEED_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={speed === option ? 'is-active' : ''}
                onClick={() => {
                  setSpeed(option)
                  if (popover === 'speed') setPopover(null)
                }}
                title={option === 0 ? 'Pause (Space)' : `${option}× speed (key ${option})`}
              >
                {option === 0 ? '⏸' : `${option}×`}
              </button>
            ))}
          </div>
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
          critical={impatienceCritical}
          rate={`+${rates.impatiencePerMinute.toFixed(2)}/min`}
          hint={`You lose if this fills. Grows ${rates.impatiencePerMinute.toFixed(
            2,
          )} per minute right now — faster each year, once hostility passes ${IMPATIENCE_HOSTILITY_THRESHOLD}, and with every villager who leaves.${deadlineHint(
            deadline,
          )}`}
          floats={impFloats}
          pulseKey={run.impatience}
          note={<DeadlineNote deadline={deadline} />}
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

      <div className="topbar-tools">
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
          className="icon-btn sound-btn"
          onClick={() => updateSettings({ sound: !sound })}
          title={sound ? 'Mute sound' : 'Unmute sound'}
          aria-label={sound ? 'Mute sound' : 'Unmute sound'}
        >
          {sound ? '🔊' : '🔇'}
        </button>
        <div className="topbar-anchor" ref={settingsRef}>
          <button
            type="button"
            className={`icon-btn settings-btn ${popover === 'settings' ? 'is-open' : ''}`}
            onClick={() => toggle('settings')}
            title="Game settings: sound, volume and auto-pause"
            aria-label="Game settings"
            aria-expanded={popover === 'settings'}
            aria-controls="game-settings"
          >
            ⚙️
          </button>
          {popover === 'settings' && (
            <div
              id="game-settings"
              className="topbar-popover settings-popover"
              role="group"
              aria-label="Game settings"
            >
              <SoundFields />
              <PauseOnBlurField />
              <AutoPauseFields />
            </div>
          )}
        </div>
      </div>

      <div className="topbar-status-wrap" ref={statusRef}>
        {/* Phones and narrow tablets fold the chips behind this; desktop hides it. */}
        <button
          type="button"
          className={`status-toggle ${
            dangers > 0 ? 'is-danger' : alerts.length > 0 ? 'is-caution' : ''
          } ${popover === 'status' ? 'is-open' : ''}`}
          onClick={() => toggle('status')}
          aria-expanded={popover === 'status'}
          aria-controls="topbar-status"
          aria-label={statusLabel}
          title={statusLabel}
        >
          {alertIcons.map((icon) => (
            <span key={icon} className="status-toggle-alert" aria-hidden>
              {icon}
            </span>
          ))}
          <span className="status-toggle-idle" aria-hidden>
            💤<strong className={idle > 0 ? 'is-warn' : ''}>{idle}</strong>
          </span>
          {alerts.length > 0 && (
            <span className="status-badge" aria-hidden>
              {alerts.length}
            </span>
          )}
          <span className="status-chevron" aria-hidden>
            ▾
          </span>
        </button>
        <div
          id="topbar-status"
          className={`topbar-status ${popover === 'status' ? 'is-open' : ''}`}
        >
          {/* The season line only shows where the top bar has no room for it. */}
          <p className="status-season" aria-hidden>
            {info.icon} {info.name} · Year {run.season.year} · {seasonLeft} left
            {untilStorm !== null && (
              <span className={untilStorm <= 60 ? 'is-warn' : ''}>
                {' '}
                · {SEASON_INFO.storm.icon} in {formatDuration(untilStorm)}
              </span>
            )}
          </p>
          {alerts.length > 0 && (
            <ul className="status-alerts">
              {alerts.map((a) => (
                <li key={a.id} className={`is-${a.severity}`}>
                  {a.icon} {a.text}
                </li>
              ))}
            </ul>
          )}
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
      </div>
    </header>
  )
}

/**
 * Everything the status chips would shout about, so the folded phone toggle
 * can still show a danger without being opened.
 */
function statusAlerts(input: {
  run: RunState
  hearthDanger: boolean
  hearthCaution: boolean
  impatienceCritical: boolean
  overcrowded: boolean
  departures: Partial<Record<SpeciesId, number>>
  breakdowns: { species: SpeciesId; current: number }[]
  untilStorm: number | null
}): StatusAlert[] {
  const { run } = input
  const out: StatusAlert[] = []
  if (run.coldHearth) {
    out.push({ id: 'hearth', icon: '🔥', text: 'The hearth is out', severity: 'danger' })
  } else if (input.hearthDanger) {
    out.push({ id: 'hearth', icon: '🔥', text: 'Hearth wood is running out', severity: 'danger' })
  } else if (input.hearthCaution) {
    out.push({
      id: 'hearth',
      icon: '🔥',
      text: 'Not enough wood for the Storm',
      severity: 'caution',
    })
  }
  if (run.starving) {
    out.push({ id: 'starving', icon: '🍽️', text: 'Villagers are starving', severity: 'danger' })
  }
  for (const [sp, seconds] of Object.entries(input.departures)) {
    out.push({
      id: `leaving-${sp}`,
      icon: '🚪',
      text: `${SPECIES[sp as SpeciesId].name} leave in ${Math.ceil(seconds ?? 0)}s`,
      severity: 'danger',
    })
  }
  if (input.impatienceCritical) {
    out.push({
      id: 'impatience',
      icon: '⏳',
      text: "The Queen's patience is nearly gone",
      severity: 'danger',
    })
  }
  if (input.overcrowded) {
    out.push({ id: 'housing', icon: '🏚️', text: 'Not enough housing', severity: 'caution' })
  }
  for (const b of input.breakdowns) {
    if (b.current < 0 && input.departures[b.species] === undefined) {
      out.push({
        id: `resolve-${b.species}`,
        icon: SPECIES[b.species].icon,
        text: `${SPECIES[b.species].name} resolve is below zero`,
        severity: 'caution',
      })
    }
  }
  if (input.untilStorm !== null && input.untilStorm <= 60) {
    out.push({
      id: 'storm',
      icon: SEASON_INFO.storm.icon,
      text: `The Storm arrives in ${formatDuration(input.untilStorm)}`,
      severity: 'caution',
    })
  }
  return out
}

/** Tooltip sentence on the impatience meter about the Queen's deadline. */
function deadlineHint(deadline: DeadlineForecast): string {
  if (deadline.passed) {
    return ` The Queen's deadline has passed: it adds ${deadline.overtimePerMinute.toFixed(
      2,
    )} per minute of that, and more every minute.`
  }
  if (!deadline.imminent) return ''
  const where = deadline.landsIn
    ? ` (Year ${deadline.landsIn.year}, ${SEASON_INFO[deadline.landsIn.season].name})`
    : ''
  return ` The Queen's deadline falls in ${formatDuration(
    deadline.secondsLeft,
  )}${where}; from then her impatience climbs ${deadline.startPerMinute.toFixed(
    2,
  )} per minute faster, and steeper every minute.`
}

/**
 * The deadline under the impatience meter: a countdown through its last year,
 * then the overtime it adds. Phones get the short form.
 */
function DeadlineNote({ deadline }: { deadline: DeadlineForecast }) {
  if (deadline.passed) {
    const rate = `+${deadline.overtimePerMinute.toFixed(2)}/min`
    return (
      <small className="meter-note deadline-note is-passed">
        <span aria-hidden>👑 </span>
        <span className="deadline-note-long">Deadline passed · {rate}</span>
        <span className="deadline-note-short" aria-hidden>
          Past +{deadline.overtimePerMinute.toFixed(2)}/m
        </span>
      </small>
    )
  }
  if (!deadline.imminent) return null
  const left = formatDuration(deadline.secondsLeft)
  return (
    <small
      className={`meter-note deadline-note ${
        deadline.secondsLeft <= RUNWAY_WARNING_SECONDS ? 'is-urgent' : ''
      }`}
    >
      <span aria-hidden>👑 </span>
      <span className="deadline-note-long">Queen's deadline in {left}</span>
      <span className="deadline-note-short" aria-hidden>
        in {left}
      </span>
    </small>
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
  /** Close to losing: the meter turns urgent so it reads at a glance. */
  critical?: boolean
  hint: string
  /** Compact growth rate shown beside the label, e.g. "+0.2/min". */
  rate?: string
  floats?: Float[]
  /** Changing this key replays the pulse animation (impatience ticking up). */
  pulseKey?: number
  /** A line under the bar (the Queen's deadline on the impatience meter). */
  note?: ReactNode
}

function Meter({
  label,
  icon,
  value,
  max,
  fraction,
  tone,
  critical,
  hint,
  rate,
  floats,
  pulseKey,
  note,
}: MeterProps) {
  const pct = ((value + Math.min(1, Math.max(0, fraction))) / max) * 100
  return (
    <div className={`meter meter-${tone} ${critical ? 'is-critical' : ''}`} title={hint}>
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
      {note}
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
