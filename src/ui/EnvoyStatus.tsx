import {
  ENVOY_COLD_HEARTH_SECONDS,
  ENVOY_UNREST_MARGIN,
  ENVOY_UNREST_SECONDS,
} from '../game/engine/balance'
import {
  COLLAPSE_TEXT,
  envoyArrivesIn,
  envoyPopulationFloor,
  envoyRiding,
  lastStandBlights,
} from '../game/engine/climax'
import { formatDuration } from '../game/engine/forecast'
import type { Modifiers } from '../game/engine/modifiers'
import { population, stormReachFloor } from '../game/engine/queries'
import {
  describeProfile,
  formatReputation,
  REPUTATION_SOURCE_LABEL,
  REPUTATION_SOURCES,
} from '../game/engine/reputation'
import type { ReputationProfile, RunState } from '../game/types'
import { Icon } from './Icon'
import './climax.css'

/**
 * The Envoy's approach in the top bar: in place of the impatience meter (the
 * Queen is satisfied, so it no longer matters) a countdown to the envoy's
 * arrival, filling as she nears, with what would still lose the run in its
 * tooltip. Rendered only while she rides.
 */
export function EnvoyMeter({ run, mods }: { run: RunState; mods: Modifiers }) {
  const left = envoyArrivesIn(run, mods)
  if (left === null || !run.envoy) return null
  const e = run.envoy
  const elapsed = Math.max(0, run.clock - e.setOutAt)
  const pct = Math.min(100, (elapsed / Math.max(1, elapsed + left)) * 100)
  const time = formatClock(left)
  const lastStand = e.finalStorm && run.season.season === 'storm'
  const floor = envoyPopulationFloor(e)
  const coldLeft = Math.max(0, ENVOY_COLD_HEARTH_SECONDS - e.coldSeconds)
  const reach = Math.round(stormReachFloor(run, true) * 100)
  const unrest = e.unrestSeconds > 0
  const hint = [
    `The Queen is satisfied: her impatience no longer matters. Her envoy arrives in ${time}, as ${
      lastStand ? 'this' : 'the next'
    } Storm ends — hold until then.`,
    lastStand
      ? `The forest is making its last stand: hostility surged, a dread weighs on everyone, threats strike faster and the hearth's warm ring pulls in to ${reach}% by the Storm's end.`
      : `In that Storm the forest makes its last stand: ${lastStandBlights(run.hostility)} certain blight${
          lastStandBlights(run.hostility) > 1 ? 's' : ''
        } at this hostility, a dread on everyone's resolve, bolder threats and a warm ring pulled in to about ${reach}%.`,
    `The run is lost if fewer than ${floor} villagers remain (${population(run)} now), the hearth stands cold ${ENVOY_COLD_HEARTH_SECONDS} s in all (${Math.ceil(coldLeft)} s left), or most villagers are discontented (${ENVOY_UNREST_MARGIN}+ resolve below their reputation threshold) for ${ENVOY_UNREST_SECONDS} s straight.`,
    'Reputation earned meanwhile is Glory.',
  ].join(' ')
  return (
    <div
      className={`meter meter-envoy ${lastStand || unrest ? 'is-critical' : ''}`}
      title={hint}
      data-testid="envoy-meter"
    >
      <div className="meter-head">
        <span className="meter-icon">
          <Icon id="horse" emoji="🐎" />
        </span>
        <span className="meter-label">
          <span className="meter-label-long">The envoy</span>
          <span className="meter-label-short" aria-hidden>
            Envoy
          </span>
        </span>
        <strong>{time}</strong>
      </div>
      <div
        className="meter-track"
        role="meter"
        aria-label={`The envoy arrives in ${time}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="meter-sub">
        <small className="meter-note envoy-note" role="status">
          <span className="deadline-note-long">
            {unrest
              ? `Unrest ${Math.floor(e.unrestSeconds)}/${ENVOY_UNREST_SECONDS}s · `
              : lastStand
                ? 'Last stand · '
                : ''}
            The envoy arrives in {time}
          </span>
          <span className="deadline-note-short" aria-hidden>
            in {time}
          </span>
        </small>
      </div>
    </div>
  )
}

/** "3:20": a countdown as a clock reads, rounded up to the second. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Under the reputation meter while the envoy rides: the Glory earned so far. */
export function GloryNote({ run }: { run: RunState }) {
  if (!envoyRiding(run)) return null
  return (
    <small className="meter-note glory-note" title="Reputation earned past the maximum while the envoy rides">
      Glory +{formatReputation(Math.floor(run.envoy.glory * 10) / 10)}
    </small>
  )
}

/**
 * The end screen's account of the approach: held for the envoy (how long,
 * the Glory earned, by source) or how the settlement collapsed before she
 * arrived. Nothing for a run that never filled its reputation.
 */
export function EnvoyEnd({ run }: { run: RunState }) {
  const e = run.envoy
  if (!e) return null
  const held = e.outcome === 'arrived' && run.phase === 'won'
  const minutes = Math.max(0, run.clock - e.setOutAt)
  const by = run.reputationBy ?? {}
  return (
    <section className={`end-envoy ${held ? 'is-held' : 'is-fell'}`} aria-label="The envoy's approach">
      <h3>
        <Icon id="horse" emoji="🐎" /> {held ? 'Held for the envoy' : 'The envoy found ruins'}
      </h3>
      <p>
        {held
          ? `The envoy set out in Year ${e.year} and the settlement held ${formatDuration(minutes)} through the forest's last stand until she arrived.`
          : run.phase === 'lost'
            ? `The envoy set out in Year ${e.year}, but ${
                e.collapse ? COLLAPSE_TEXT[e.collapse] : 'the last villager left'
              } before she arrived.`
            : `The envoy set out in Year ${e.year}.`}
      </p>
      <p className="end-glory">
        <strong>Glory {formatReputation(Math.round(e.glory * 10) / 10)}</strong>
        <small> — reputation earned past the maximum while she rode</small>
      </p>
      <ul className="end-rep-sources" aria-label="Reputation by source">
        {REPUTATION_SOURCES.filter((src) => (by[src] ?? 0) >= 0.05).map((src) => (
          <li key={src}>
            <span>{REPUTATION_SOURCE_LABEL[src]}</span>
            <span>{formatReputation(Math.round((by[src] ?? 0) * 10) / 10)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * "Here the Queen values: reclaimed land ×2 · completed orders ×0.75" — a
 * land's or commission's reputation profile, or a whole run's. Nothing when
 * the profile changes nothing.
 */
export function ReputationProfileLine({
  profile,
  className = 'rep-profile',
}: {
  profile: ReputationProfile | undefined
  className?: string
}) {
  const parts = describeProfile(profile ?? {})
  if (parts.length === 0) return null
  return <small className={className}>Here the Queen values: {parts.join(' · ')}</small>
}
