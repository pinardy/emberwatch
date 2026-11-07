import { RESOURCES } from '../game/content/resources'
import { supplyReward } from '../game/content/meta'
import {
  PETITION_AMBER,
  PETITION_BROKEN_IMPATIENCE,
  PETITION_RELIEF,
  PETITION_VOW_REPUTATION,
  PETITION_VOW_SECONDS,
  PETITION_WITHIN,
} from '../game/engine/balance'
import { formatDuration } from '../game/engine/forecast'
import { petitionBlocked, petitionOpen, petitionVowLeft, retreatOffered } from '../game/engine/levers'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { Bar } from './Bar'
import { Icon } from './Icon'
import './levers.css'
import { useConfirm } from './useConfirm'

/**
 * The Grand Petition, in the Orders panel: once per run, when the Queen's
 * patience is nearly spent, a costly plea that buys back impatience on a vow
 * of reputation within a time limit. Shows the offer, then the live vow.
 */
export function GrandPetitionCard({ run }: { run: RunState }) {
  const petition = useGameStore((s) => s.petition)
  const p = run.petition
  if (p) {
    const left = petitionVowLeft(run)
    const start = p.target - PETITION_VOW_REPUTATION
    const done = Math.max(0, Math.min(PETITION_VOW_REPUTATION, run.reputation - start))
    return (
      <div className={`order-card petition-card is-${p.outcome ?? 'live'}`} data-testid="grand-petition">
        <strong>
          <Icon id="dove" emoji="🕊️" /> Grand Petition —{' '}
          {p.outcome === 'kept' ? 'vow kept' : p.outcome === 'broken' ? 'vow broken' : 'your vow'}
        </strong>
        {!p.outcome && (
          <>
            <small>
              Earn {PETITION_VOW_REPUTATION} reputation within the time, or her patience snaps (+
              {PETITION_BROKEN_IMPATIENCE} impatience). {done}/{PETITION_VOW_REPUTATION} · {formatDuration(left)} left
            </small>
            <Bar value={done / PETITION_VOW_REPUTATION} />
          </>
        )}
      </div>
    )
  }
  if (!petitionOpen(run)) {
    return (
      <p className="panel-hint" data-testid="grand-petition-later">
        Once a run, when her patience is within {PETITION_WITHIN} of running out (from Year 2), the Queen will hear a
        Grand Petition.
      </p>
    )
  }
  const short = petitionBlocked(run) === 'amber'
  return (
    <div className="order-card petition-card" data-testid="grand-petition">
      <strong>
        <Icon id="dove" emoji="🕊️" /> The Grand Petition
      </strong>
      <small>
        Once a run. She forgives {PETITION_RELIEF} impatience and gives you a fresh hearing — on your vow of{' '}
        {PETITION_VOW_REPUTATION} reputation within {formatDuration(PETITION_VOW_SECONDS)}. Break it and her patience
        snaps: +{PETITION_BROKEN_IMPATIENCE} impatience.
      </small>
      <button type="button" className="wide-button" disabled={short} onClick={() => petition()}>
        <Icon id="dove" emoji="🕊️" /> Make the Grand Petition — {PETITION_AMBER}{' '}
        <Icon of={RESOURCES.amber} label="amber" />
      </button>
    </div>
  )
}

/**
 * The Retreat to the Citadel: offered once a run is lost in all but name.
 * Two clicks end the run now as a loss and send home what it has earned.
 */
export function RetreatCard({ run }: { run: RunState }) {
  const retreat = useGameStore((s) => s.retreat)
  const confirm = useConfirm('retreat', retreat)
  if (!retreatOffered(run)) return null
  const supplies = supplyReward({ ...run, phase: 'lost' })
  return (
    <div className="order-card retreat-card" data-testid="retreat">
      <strong>
        <Icon id="warehouse" emoji="🏰" /> Retreat to the Citadel
      </strong>
      <small>
        The run looks lost. End it now and lead the settlers home: the Citadel receives the {supplies} supplies this
        settlement has earned so far, as for any loss.
      </small>
      <button
        type="button"
        className={`wide-button danger ${confirm.armed ? 'is-armed' : ''}`}
        onClick={confirm.trigger}
      >
        {confirm.armed ? 'Click again to retreat — the run ends' : 'Retreat to the Citadel'}
      </button>
    </div>
  )
}

/**
 * On the end screen: the levers the run pulled — the architect's plans, the
 * Grand Petition and how its vow ended. Nothing when none was used.
 */
export function LeversEnd({ run }: { run: RunState }) {
  const plans = run.architectPlans ?? 0
  const p = run.petition
  if (plans === 0 && !p) return null
  const vow =
    p?.outcome === 'kept'
      ? 'made, and the vow kept'
      : p?.outcome === 'broken'
        ? 'made, and the vow broken'
        : 'made; the run ended before the vow fell due'
  return (
    <section className="end-levers" aria-label="Levers pulled" data-testid="end-levers">
      <h3>Levers pulled</h3>
      <ul>
        {plans > 0 && (
          <li>
            <Icon id="setSquare" emoji="📐" /> The Queen's Architect: {plans} set{plans === 1 ? '' : 's'} of plans
          </li>
        )}
        {p && (
          <li className={p.outcome === 'broken' ? 'is-bad' : p.outcome === 'kept' ? 'is-good' : undefined}>
            <Icon id="dove" emoji="🕊️" /> The Grand Petition: {vow}
          </li>
        )}
      </ul>
    </section>
  )
}
