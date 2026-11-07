import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IMPATIENCE_HOSTILITY_THRESHOLD, SEASON_INFO } from '../game/engine/balance'
import { MAX_HOSTILITY } from '../game/engine/tick'
import {
  RUNWAY_WARNING_SECONDS,
  formatDuration,
  hearthForecast,
  secondsUntilStorm,
  type DeadlineForecast,
} from '../game/engine/forecast'
import { isFounding } from '../game/engine/founding'
import { idleVillagers, population, totalHousing } from '../game/engine/queries'
import {
  impatienceParts,
  secondsSinceReputation,
  type ImpatienceParts,
} from '../game/engine/society'
import { computeModifiers } from '../game/engine/modifiers'
import { SPECIES } from '../game/content/species'
import { useFrameDerived } from '../game/frameDerived'
import { useGameStore, useHudRun } from '../game/store'
import { SPEED_OPTIONS } from '../game/engine/balance'
import type { RunState, SpeciesId } from '../game/types'
import type { IconId } from '../art/icons'
import { METER_ART, SEASON_ART } from '../game/content/art'
import { Icon } from './Icon'
import { AutoPauseFields, PauseOnBlurField, PerfField, SoundFields } from './SettingsFields'
import { useDismiss } from './useGameLoop'
import { HEARTH_KEY, inspectHearth } from './MapAids'
import { signed } from './threatText'

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
      text: signed(delta),
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
  /** Drawn icon; `icon` is the emoji fallback. */
  art?: IconId
  text: string
  severity: 'danger' | 'caution'
}

type Popover = 'status' | 'settings' | 'speed' | null

export function TopBar() {
  const run = useHudRun()
  const speed = useGameStore((s) => s.speed)
  const setSpeed = useGameStore((s) => s.setSpeed)
  const goToScreen = useGameStore((s) => s.goToScreen)
  const sound = useGameStore((s) => s.settings.sound)
  const renderer = useGameStore((s) => s.settings.renderer)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const repFloats = useFloaters(run?.reputation ?? 0, 'up-good')
  const impFloats = useFloaters(run?.impatience ?? 0, 'up-bad')
  const [popover, setPopover] = useState<Popover>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const speedRef = useRef<HTMLDivElement>(null)
  // Modifiers and resolve walk the whole settlement: once per sim step, shared.
  const frame = useFrameDerived()
  const derived = frame?.topBar ?? null

  useDismiss(
    popover !== null,
    popover === 'status' ? statusRef : popover === 'settings' ? settingsRef : speedRef,
    () => setPopover(null),
  )

  if (!run || !derived) return null

  const info = SEASON_INFO[run.season.season]
  const seasonPct = run.season.elapsed / run.season.length
  const seasonLeft = formatDuration(run.season.length - run.season.elapsed)
  const pop = population(run)
  const housing = totalHousing(run)
  const idle = idleVillagers(run).length
  const { breakdowns, rates, hearth, departures, deadline } = derived
  const impParts = impatienceParts(run, frame?.mods ?? computeModifiers(run))
  const stillFor = secondsSinceReputation(run)
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
  const alertIcons = alerts
    .filter((a, i) => alerts.findIndex((b) => b.icon === a.icon) === i)
    .slice(0, 2)
  const statusLabel = [
    'Settlement status',
    `${idle} idle`,
    alerts.length > 0
      ? `${alerts.length} alert${alerts.length > 1 ? 's' : ''}: ${alerts.map((a) => a.text).join('; ')}`
      : 'all well',
  ].join(', ')

  // The clock waits on the founding's picks, whatever speed is set: say so in
  // place of the speed buttons rather than lighting a speed that is not
  // running. The set speed returns with the buttons once the last pick is
  // made.
  const held = isFounding(run)

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
            <span>
              <Icon id={SEASON_ART[run.season.season]} />
            </span>
          </div>
          <div className="season-text">
            <strong>{info.name}</strong>
            <small>
              Year {run.season.year} · {seasonLeft} left
            </small>
            {untilStorm !== null && (
              <small className={`season-next ${untilStorm <= 60 ? 'is-warn' : ''}`}>
                <Icon id={SEASON_ART.storm} /> Storm in {formatDuration(untilStorm)}
              </small>
            )}
          </div>
        </div>

        <div className="topbar-anchor speed-anchor" ref={speedRef}>
          {/* Phones fold the six speeds behind this; desktop hides it. */}
          <button
            type="button"
            className={`speed-toggle ${speed === 0 || held ? 'is-paused' : ''} ${
              held ? 'is-held' : ''
            } ${popover === 'speed' ? 'is-open' : ''}`}
            onClick={() => toggle('speed')}
            aria-expanded={popover === 'speed'}
            aria-controls="speed-group"
            aria-label={`Game speed: ${
              held ? 'held for the founding' : speed === 0 ? 'paused' : `${speed}×`
            }`}
            title={held ? 'The clock waits until the founding picks are made' : 'Game speed'}
          >
            {held ? (
              <>
                <Icon id="pause" emoji="⏸" /> <span className="speed-held-word">Founding</span>
              </>
            ) : speed === 0 ? (
              <Icon id="pause" emoji="⏸" />
            ) : (
              `${speed}×`
            )}
            <span className="speed-chevron" aria-hidden>
              ▾
            </span>
          </button>
          <div
            id="speed-group"
            className={`speed-group ${popover === 'speed' ? 'is-open' : ''} ${held ? 'is-held' : ''}`}
            role="group"
            aria-label="Game speed"
          >
            {held ? (
              <span className="speed-held" role="status" title="The clock starts once every founding pick is made">
                <Icon id="pause" emoji="⏸" /> Founding — clock waits
              </span>
            ) : (
              SPEED_OPTIONS.map((option) => (
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
                  {option === 0 ? <Icon id="pause" emoji="⏸" label="Pause" /> : `${option}×`}
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="topbar-meters">
        <Meter
          label="Reputation"
          short="Rep."
          icon="👑"
          art={METER_ART.reputation}
          value={run.reputation}
          max={run.maxReputation}
          fraction={run.reputationProgress}
          tone="good"
          hint="Win at maximum reputation. Earned from high resolve and completed orders."
          floats={repFloats}
        />
        <Meter
          label="Impatience"
          short="Impat."
          icon="⏳"
          art={METER_ART.impatience}
          value={run.impatience}
          max={run.maxImpatience}
          fraction={run.impatienceProgress}
          tone="bad"
          critical={impatienceCritical}
          rate={`+${rates.impatiencePerMinute.toFixed(2)}/min`}
          hint={`You lose if this fills. Grows ${rates.impatiencePerMinute.toFixed(
            2,
          )} per minute right now${impatienceCauses(impParts, stillFor)}. It also jumps with every villager lost and every decree missed, and climbs faster each year, while reputation stands still, and once hostility passes ${IMPATIENCE_HOSTILITY_THRESHOLD}.${deadlineHint(
            deadline,
          )}`}
          floats={impFloats}
          pulseKey={run.impatience}
          note={
            deadline.passed || deadline.imminent ? (
              <DeadlineNote deadline={deadline} />
            ) : (
              <StagnationNote parts={impParts} stillFor={stillFor} />
            )
          }
        />
        <Meter
          label="Hostility"
          short="Host."
          icon="🌩️"
          art={METER_ART.hostility}
          value={Math.floor(run.hostility)}
          max={MAX_HOSTILITY}
          fraction={run.hostility - Math.floor(run.hostility)}
          tone="warn"
          rate={`${rates.hostilityPerMinute >= 0 ? '+' : '−'}${Math.abs(rates.hostilityPerMinute).toFixed(1)}/min`}
          hint={`Lowers resolve for everyone. ${
            rates.hostilityPerMinute >= 0 ? 'Rises' : 'Falls'
          } ${Math.abs(rates.hostilityPerMinute).toFixed(
            1,
          )} per minute right now, plus each cleared glade, threat strike and Storm. Every glade cleared makes it grow faster for good; glades left to the forest calm it. Above ${IMPATIENCE_HOSTILITY_THRESHOLD} it also wears on the Queen.`}
        />
      </div>

      <div className="topbar-tools">
        {/* The hearth's Architect, dumping and upgrades, without finding it on the map. */}
        <button
          type="button"
          className="icon-btn hearth-btn"
          onClick={inspectHearth}
          title={`Hearth: the Architect, dumping goods and upgrades (${HEARTH_KEY.label})`}
          aria-label="Hearth"
          aria-keyshortcuts={HEARTH_KEY.label}
        >
          <Icon id="ancientHearth" emoji="🔥" />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => updateSettings({ renderer: renderer === '3d' ? '2d' : '3d' })}
          title={renderer === '3d' ? 'Switch to 2D map' : 'Switch to 3D map'}
          aria-label={renderer === '3d' ? 'Switch to 2D map' : 'Switch to 3D map'}
        >
          {renderer === '3d' ? <Icon id="map" emoji="🗺️" /> : <Icon id="mountain" emoji="🏔️" />}
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
            <Icon id="part" emoji="⚙️" />
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
              <PerfField />
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
          {alertIcons.map((a) => (
            <span key={a.icon} className="status-toggle-alert" aria-hidden>
              <Icon id={a.art} emoji={a.icon} />
            </span>
          ))}
          <span className="status-toggle-idle" aria-hidden>
            <Icon id="zzz" emoji="💤" />
            <strong className={idle > 0 ? 'is-warn' : ''}>{idle}</strong>
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
            <Icon id={SEASON_ART[run.season.season]} /> {info.name} · Year {run.season.year} ·{' '}
            {seasonLeft} left
            {untilStorm !== null && (
              <span className={untilStorm <= 60 ? 'is-warn' : ''}>
                {' '}
                · <Icon id={SEASON_ART.storm} /> in {formatDuration(untilStorm)}
              </span>
            )}
          </p>
          {alerts.length > 0 && (
            <ul className="status-alerts">
              {alerts.map((a) => (
                <li key={a.id} className={`is-${a.severity}`}>
                  <Icon id={a.art} emoji={a.icon} /> {a.text}
                </li>
              ))}
            </ul>
          )}
          <div className="stat" title="Population and housing">
            <span aria-hidden>
              <Icon id="people" emoji="🧑‍🤝‍🧑" />
            </span>
            <span className="sr-only">
              Population {pop}, housing for {housing}
            </span>
            <strong className={pop > housing ? 'is-bad' : ''} aria-hidden>
              {pop}/{housing}
            </strong>
          </div>
          <div
            className={`stat hearth-stat ${hearthDanger ? 'is-bad' : hearthCaution ? 'is-warn' : ''}`}
            title={hearthTitle(hearth, storm, run.coldHearth)}
            role="img"
            aria-label={`Hearth fuel: ${run.coldHearth ? 'out' : formatDuration(hearth.runway)}${
              !storm && !run.coldHearth ? `, ${formatDuration(hearth.stormRunway)} in the Storm` : ''
            }`}
          >
            <span>
              <Icon id="ancientHearth" />
            </span>
            <strong>
              {(hearthDanger || hearthCaution) && <em className="stat-alert">!</em>}
              {run.coldHearth ? 'Out' : formatDuration(hearth.runway)}
            </strong>
            {!storm && !run.coldHearth && (
              <small className="hearth-storm">
                <Icon id={SEASON_ART.storm} />
                {formatDuration(hearth.stormRunway)}
              </small>
            )}
          </div>
          <div className="stat" title="Idle villagers — they also act as builders">
            <span aria-hidden>
              <Icon id="zzz" emoji="💤" />
            </span>
            <span className="sr-only">Idle villagers</span>
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
                <span aria-hidden>
                  <Icon of={SPECIES[b.species]} />
                </span>
                <span className="sr-only">{SPECIES[b.species].name} resolve</span>
                <strong
                  className={
                    b.current < 0 ? 'is-bad' : b.current >= b.threshold ? 'is-good' : ''
                  }
                >
                  {Math.round(b.current)}
                </strong>
                <small className="resolve-chip-threshold">
                  <span className="sr-only"> of </span>/{b.threshold}
                </small>
                {/* Not colour alone: a mark (and words) when it earns reputation. */}
                {b.current >= b.threshold && (
                  <em className="resolve-earning" title="Earning reputation">
                    <span aria-hidden>✓</span>
                    <span className="sr-only">, earning reputation</span>
                  </em>
                )}
                {b.current < 0 && <span className="sr-only">, below zero</span>}
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
    out.push({ id: 'hearth', icon: '🔥', art: 'ancientHearth', text: 'The hearth is out', severity: 'danger' })
  } else if (input.hearthDanger) {
    out.push({ id: 'hearth', icon: '🔥', art: 'ancientHearth', text: 'Hearth wood is running out', severity: 'danger' })
  } else if (input.hearthCaution) {
    out.push({
      id: 'hearth',
      icon: '🔥',
      art: 'ancientHearth',
      text: 'Not enough wood for the Storm',
      severity: 'caution',
    })
  }
  if (run.starving) {
    out.push({ id: 'starving', icon: '🍽️', art: 'plate', text: 'Villagers are starving', severity: 'danger' })
  }
  for (const [sp, seconds] of Object.entries(input.departures)) {
    out.push({
      id: `leaving-${sp}`,
      icon: '🚪',
      art: 'door',
      text: `${SPECIES[sp as SpeciesId].name} leave in ${Math.ceil(seconds ?? 0)}s`,
      severity: 'danger',
    })
  }
  if (input.impatienceCritical) {
    out.push({
      id: 'impatience',
      icon: '⏳',
      art: METER_ART.impatience,
      text: "The Queen's patience is nearly gone",
      severity: 'danger',
    })
  }
  if (input.overcrowded) {
    out.push({ id: 'housing', icon: '🏚️', art: 'bed', text: 'Not enough housing', severity: 'caution' })
  }
  for (const b of input.breakdowns) {
    if (b.current < 0 && input.departures[b.species] === undefined) {
      out.push({
        id: `resolve-${b.species}`,
        icon: SPECIES[b.species].icon,
        art: SPECIES[b.species].art,
        text: `${SPECIES[b.species].name} resolve is below zero`,
        severity: 'caution',
      })
    }
  }
  if (input.untilStorm !== null && input.untilStorm <= 60) {
    out.push({
      id: 'storm',
      icon: SEASON_INFO.storm.icon,
      art: SEASON_ART.storm,
      text: `The Storm arrives in ${formatDuration(input.untilStorm)}`,
      severity: 'caution',
    })
  }
  return out
}

/**
 * What the impatience rate is made of right now, largest first, for the
 * meter's tooltip: " — 0.25 because reputation has not risen for 3m 10s,
 * 0.16 from the calendar".
 */
function impatienceCauses(parts: ImpatienceParts, stillFor: number): string {
  const named: [number, string][] = [
    [parts.calendar, 'from the calendar'],
    [parts.stagnation, `because reputation has not risen for ${formatDuration(stillFor)}`],
    [parts.stalling, 'from species below their reputation threshold'],
    [parts.hostility, 'from the forest\'s hostility'],
    [parts.deadline, 'from the passed deadline'],
  ]
  const shown = named
    .filter(([rate]) => rate * 60 >= 0.005)
    .sort((a, b) => b[0] - a[0])
    .map(([rate, why]) => `${(rate * 60).toFixed(2)} ${why}`)
  return shown.length > 0 ? ` — ${shown.join(', ')}` : ''
}

/**
 * Under the impatience meter while no deadline note is up: how long
 * reputation has stood still, once the Queen has started to mind.
 */
function StagnationNote({ parts, stillFor }: { parts: ImpatienceParts; stillFor: number }) {
  if (parts.stagnation <= 0) return null
  const rate = `+${(parts.stagnation * 60).toFixed(2)}/min`
  return (
    <small className="meter-note deadline-note stagnation-note">
      <span className="deadline-note-long">
        No reputation for {formatDuration(stillFor)} · {rate}
      </span>
      <span className="deadline-note-short" aria-hidden>
        Still {formatDuration(stillFor)}
      </span>
    </small>
  )
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
        <span aria-hidden>
          <Icon id={METER_ART.reputation} />{' '}
        </span>
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
      <span aria-hidden>
          <Icon id={METER_ART.reputation} />{' '}
        </span>
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
  /** The label where the meter is too narrow for it (phones). */
  short?: string
  icon: string
  art?: IconId
  value: number
  max: number
  /** Progress toward the next whole point, 0..1. */
  fraction: number
  tone: 'good' | 'bad' | 'warn'
  /** Close to losing: the meter turns urgent so it reads at a glance. */
  critical?: boolean
  hint: string
  /** Compact growth rate on the line under the bar, e.g. "+0.2/min". */
  rate?: string
  floats?: Float[]
  /** Changing this key replays the pulse animation (impatience ticking up). */
  pulseKey?: number
  /** A line under the bar (the Queen's deadline on the impatience meter). */
  note?: ReactNode
}

function Meter({
  label,
  short,
  icon,
  art,
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
        <span className="meter-icon">
          <Icon id={art} emoji={icon} />
        </span>
        <span className="meter-label">
          <span className="meter-label-long">{label}</span>
          {short && (
            <span className="meter-label-short" aria-hidden>
              {short}
            </span>
          )}
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
      {/* Label, value and rate never share a line, so none is cut short. */}
      {(rate || note) && (
        <div className="meter-sub">
          {rate && (
            <small className="meter-rate" title={`${label} ${rate} right now`}>
              {rate}
            </small>
          )}
          {note}
        </div>
      )}
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
