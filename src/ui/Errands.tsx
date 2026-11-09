import { ERRANDS, ERRAND_PACING } from '../game/content/errands'
import { resourceName } from '../game/content/resources'
import {
  describeErrandReward,
  errandBlocked,
  errandHasAction,
  openErrands,
} from '../game/engine/errands'
import { formatClock } from '../game/engine/forecast'
import { TRADE_LOT } from '../game/engine/balance'
import { useGameStore, useHudRun } from '../game/store'
import type { Errand, RunState } from '../game/types'
import { Bar } from './Bar'
import { Icon } from './Icon'
import './errands.css'

/*
 * Errands in the UI: a section of the Orders panel with a card per open
 * errand (its words, what it pays, how far along, the time left, and a
 * button for the ones met by a hand-over or a sale), and a small chip in the
 * HUD's bottom stack that opens the panel. Never a dialog: errands are
 * optional and lapse without penalty.
 */

/** "Hand over 10 Wood", "Sell 5 Berries", "Send a worker": an errand's button. */
function actionLabel(e: Errand): string {
  if (e.goal.kind === 'deliver') return `Hand over ${e.goal.amount} ${resourceName(e.goal.resource)}`
  if (e.goal.kind === 'sell') return `Sell ${TRADE_LOT} ${resourceName(e.goal.resource)}`
  if (e.goal.kind === 'staff') return 'Send a worker'
  return ''
}

/** How an errand met by play is coming along, in words. */
function progressWords(e: Errand): string | null {
  const goal = e.goal
  switch (goal.kind) {
    case 'hold':
    case 'staff':
    case 'builders':
      return `${Math.floor(e.held ?? 0)}/${goal.seconds}s held`
    case 'clear':
      return `${Math.floor(e.progress * 100)}% cleared`
    case 'count':
      return e.progress >= 1 ? 'Done' : 'Not yet'
    default:
      return null
  }
}

function ErrandCard({ run, errand }: { run: RunState; errand: Errand }) {
  const runErrand = useGameStore((s) => s.runErrand)
  const dismiss = useGameStore((s) => s.dismissErrand)
  const focusCamera = useGameStore((s) => s.focusCamera)
  const def = ERRANDS[errand.defId]
  const action = errandHasAction(errand)
  const blocked = action ? errandBlocked(run, errand) : null
  const words = progressWords(errand)
  const where = errand.gladeId
    ? run.glades[errand.gladeId]?.center
    : errand.buildingId
      ? run.buildings[errand.buildingId]?.pos
      : undefined
  const whyId = `errand-why-${errand.id}`
  return (
    <div className={`order-card errand-card ${errand.timeLeft < 20 ? 'is-urgent' : ''}`} data-testid="errand">
      <div className="row-between">
        <strong>
          <Icon id={def?.art} emoji={def?.icon ?? '🧺'} /> {errand.title}
        </strong>
        <span className="order-reward">{describeErrandReward(errand.reward)}</span>
      </div>
      {(!action || errand.goal.kind === 'staff') && <Bar value={errand.progress} />}
      <small className="muted errand-meta">
        {words && <span>{words} · </span>}
        <span>⏱ {formatClock(errand.timeLeft)} left</span>
      </small>
      <div className="errand-actions">
        {action && (
          <button
            type="button"
            className="wide-button"
            disabled={blocked !== null}
            aria-describedby={blocked ? whyId : undefined}
            onClick={() => runErrand(errand.id)}
          >
            {actionLabel(errand)}
          </button>
        )}
        {where && (
          <button type="button" className="link-button" onClick={() => focusCamera(where)}>
            Show on map
          </button>
        )}
        <button type="button" className="link-button" onClick={() => dismiss(errand.id)}>
          Let it go
        </button>
      </div>
      {blocked && (
        <small id={whyId} className="muted soothe-why">
          {blocked}
        </small>
      )}
    </div>
  )
}

/** The Orders panel's errands: the open ones, or a line saying when they come. */
export function ErrandList({ run }: { run: RunState }) {
  const errands = openErrands(run)
  return (
    <section className="build-group" data-testid="errands" aria-label="Errands">
      <h3>Errands</h3>
      <p className="panel-hint">
        Small jobs the settlement turns up while reputation stands still. They are optional: one left alone lapses
        without penalty. The longer the stall, the more the Queen values them.
      </p>
      {errands.map((errand) => (
        <ErrandCard key={errand.id} run={run} errand={errand} />
      ))}
      {errands.length === 0 && (
        <p className="muted" data-testid="errands-none">
          {run.envoy
            ? 'None while the envoy rides: reputation is full.'
            : `None open. They turn up once reputation has stood still for ${Math.round(ERRAND_PACING.stallAfter)} seconds.`}
        </p>
      )}
    </section>
  )
}

/**
 * The HUD's errand chip, in the bottom stack: the first open errand with its
 * clock and progress (and how many more), opening the Orders panel.
 */
export function ErrandChip() {
  const run = useHudRun()
  const setPanel = useGameStore((s) => s.setPanel)
  if (!run || run.phase !== 'playing') return null
  const errands = openErrands(run)
  const first = errands[0]
  if (!first) return null
  const def = ERRANDS[first.defId]
  const more = errands.length - 1
  return (
    <button
      type="button"
      className={`condition-card is-errand ${first.timeLeft < 20 ? 'is-urgent' : ''}`}
      onClick={() => setPanel('orders')}
      title="An optional errand — open the Orders panel"
      data-testid="errand-chip"
    >
      <span className="condition-icon">
        <Icon id={def?.art} emoji={def?.icon ?? '🧺'} />
      </span>
      <span className="condition-text">
        <strong>
          <span className="errand-chip-title">{first.title}</span>
          <em className="condition-clock">⏱ {formatClock(first.timeLeft)}</em>
        </strong>
        <small>
          Errand · {describeErrandReward(first.reward)}
          {more > 0 ? ` · ${more} more in Orders` : ''}
        </small>
        <Bar className="condition-progress" value={first.progress} />
      </span>
    </button>
  )
}
