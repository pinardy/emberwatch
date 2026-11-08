import { RESOURCES } from '../game/content/resources'
import { supplyReward } from '../game/engine/meta'
import {
  PETITION_AMBER,
  PETITION_BROKEN_IMPATIENCE,
  PETITION_FROM_YEAR,
  PETITION_RELIEF,
  PETITION_VOW_REPUTATION,
  PETITION_VOW_SECONDS,
  PETITION_WITHIN,
} from '../game/engine/balance'
import { formatDuration } from '../game/engine/forecast'
import {
  petitionBlocked,
  petitionOpen,
  petitionVowLeft,
  queensCourt,
  retreatOffered,
  type CourtLever,
  type CourtState,
} from '../game/engine/levers'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { Bar } from './Bar'
import { Icon } from './Icon'
import './levers.css'
import './errands.css'
import { againWord, useConfirm } from './useConfirm'

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
      <div id="grand-petition" className={`order-card petition-card is-${p.outcome ?? 'live'}`} data-testid="grand-petition">
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
      <p id="grand-petition" className="panel-hint" data-testid="grand-petition-later" tabIndex={-1}>
        Once a run, when her patience is within {PETITION_WITHIN} of running out (from Year 2), the Queen will hear a
        Grand Petition.
      </p>
    )
  }
  const short = petitionBlocked(run) === 'amber'
  return (
    <div id="grand-petition" className="order-card petition-card" data-testid="grand-petition">
      <strong>
        <Icon id="dove" emoji="🕊️" /> The Grand Petition
      </strong>
      <small>
        Once a run. She forgives {PETITION_RELIEF} impatience and gives you a fresh hearing — on your vow of{' '}
        {PETITION_VOW_REPUTATION} reputation within {PETITION_VOW_SECONDS / 60} minutes. Break it and her patience
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
    <div id="retreat" className="order-card retreat-card" data-testid="retreat">
      <strong>
        <Icon id="guildHouse" emoji="🏛️" /> Retreat to the Citadel
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
        {confirm.armed ? `${againWord()} to retreat — the run ends` : 'Retreat to the Citadel'}
      </button>
    </div>
  )
}

const COURT_STATE_WORDS: Record<CourtState, string> = {
  open: 'Open',
  short: 'Needs amber',
  later: 'Not yet',
  used: 'Used',
  closed: 'Closed',
}

const COURT_ART: Record<CourtLever['id'], { id: 'dove' | 'seal' | 'guildHouse'; emoji: string }> = {
  soothe: { id: 'dove', emoji: '🕊️' },
  petition: { id: 'seal', emoji: '📜' },
  retreat: { id: 'guildHouse', emoji: '🏛️' },
}

/** The control each court lever summarises (in the "Petition the Queen" section below). */
const COURT_TARGET: Record<CourtLever['id'], string> = {
  soothe: 'soothe-button',
  petition: 'grand-petition',
  retreat: 'retreat',
}

/** Brings a lever's control into view and focuses it (or its section when it is not shown). */
function showLever(id: CourtLever['id']): void {
  const target = document.getElementById(COURT_TARGET[id]) ?? document.getElementById('queen-levers')
  if (!target) return
  target.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  const control = target.matches('button') ? target : target.querySelector<HTMLElement>('button')
  ;(control ?? target).focus({ preventScroll: true })
}

/**
 * "The Queen's court", in the Orders panel from Year 2: one entry naming the
 * three levers on her patience — Soothe the Queen, the Grand Petition, the
 * Retreat to the Citadel — with each one's state now and when (or why not) it
 * opens, so they are known before the run is desperate. Each row leads to
 * its control below; nothing here duplicates them.
 */
export function QueensCourt({ run }: { run: RunState }) {
  if (run.season.year < PETITION_FROM_YEAR || run.phase !== 'playing') return null
  const levers = queensCourt(run)
  const open = levers.filter((l) => l.state === 'open').length
  return (
    <div className="order-card court-card" data-testid="queens-court" role="group" aria-label="The Queen's court">
      <div className="row-between">
        <strong>
          <Icon id="castle" emoji="🏰" /> The Queen's court
        </strong>
        <span className="order-reward">{open === 0 ? 'none open' : `${open} open`}</span>
      </div>
      <small className="muted">Three levers on her patience. Learn them before you need them.</small>
      <ul className="court-levers">
        {levers.map((lever) => (
          <li key={lever.id} className="court-lever" data-testid={`court-${lever.id}`}>
            <span className="court-lever-name">
              <Icon id={COURT_ART[lever.id].id} emoji={COURT_ART[lever.id].emoji} />
              <button type="button" className="link-button" onClick={() => showLever(lever.id)}>
                {lever.name}
              </button>
            </span>
            <span className={`court-state is-${lever.state}`}>{COURT_STATE_WORDS[lever.state]}</span>
            <small>{lever.note}</small>
          </li>
        ))}
      </ul>
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
