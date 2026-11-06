import { DECREES } from '../game/content/decrees'
import { ORDERS } from '../game/content/orders'
import { RESOURCES } from '../game/content/resources'
import { DECREE_DECLINE_IMPATIENCE, ORDER_DECLINE_IMPATIENCE } from '../game/engine/balance'
import { formatClock, productionRate } from '../game/engine/forecast'
import { computeModifiers } from '../game/engine/modifiers'
import {
  DECLINE_CHOICE,
  describeOrder,
  isWritChoice,
  orderDeclineBlocked,
  orderGoal,
  orderReputation,
} from '../game/engine/orders'
import {
  decreeGoal,
  decreeReputation,
  decreeStreakBonus,
  describeTimedGoal,
} from '../game/engine/structure'
import { useGameStore } from '../game/store'
import type { Order, PendingChoice, RoyalDecree, RunState } from '../game/types'
import { decreeMissCost } from './DecreeCard'
import { Icon } from './Icon'
import './queen-choice.css'

/**
 * The Queen's offers, rendered inside the choice modal overlay: a choice of
 * two orders for an empty slot (or the founding writ's three), and a choice
 * of two royal decrees. Every card says what it pays, what it asks and how far
 * along the settlement already is.
 */
export function OrderChoice({ run, choice }: { run: RunState; choice: PendingChoice }) {
  const chooseOption = useGameStore((s) => s.chooseOption)
  const writ = isWritChoice(choice)
  const blocked = orderDeclineBlocked(run, choice)
  return (
    <div className="modal modal-queen">
      <header>
        <span className="modal-icon">
          <Icon id="scroll" emoji="📜" />
        </span>
        <div>
          <h2>{writ ? 'The Founding Writ' : "The Queen's Orders"}</h2>
          <small>
            {writ
              ? 'Your first charge from the Crown. Choose one small goal — meeting it earns your first reputation.'
              : 'An order slot is open. Choose which of these the settlement takes on; it stands until met.'}
          </small>
        </div>
      </header>
      <div className="option-list option-grid">
        {(choice.orders ?? []).map((order) => (
          <OrderOption key={order.id} run={run} order={order} onPick={() => chooseOption(order.id)} />
        ))}
      </div>
      {!writ && (
        <footer className="modal-foot queen-foot">
          <button
            type="button"
            className="reroll-button"
            disabled={blocked !== null}
            title={blocked ?? undefined}
            onClick={() => chooseOption(DECLINE_CHOICE)}
          >
            Ask for different orders — <Icon id="impatience" label="impatience" /> +{ORDER_DECLINE_IMPATIENCE}
          </button>
          <small className="muted">{blocked ?? 'Once a year.'}</small>
        </footer>
      )}
    </div>
  )
}

function OrderOption({ run, order, onPick }: { run: RunState; order: Order; onPick: () => void }) {
  const def = ORDERS[order.defId]
  const goal = orderGoal(order)
  if (!def || !goal) return null
  const counting = order.baseline !== undefined
  return (
    <button type="button" className="option queen-option" onClick={onPick}>
      <strong>{def.name}</strong>
      {order.writ ? (
        <em className="rarity-tag">founding writ</em>
      ) : def.consume ? (
        <em className="rarity-tag">Citadel shipment</em>
      ) : counting ? (
        <em className="rarity-tag">counts from now</em>
      ) : null}
      <small>{describeOrder(order)}</small>
      {def.consume && <small>The goods are handed over when it is met.</small>}
      <Progress value={order.progress} />
      <div className="option-effects">
        <span className="is-good">
          <Icon id="reputation" label="reputation" /> +
          {order.writ ? def.reputationReward : orderReputation(run, def.reputationReward)}
        </span>
        {def.reward?.amber ? (
          <span className="is-good">
            <Icon of={RESOURCES.amber} label="amber" /> +{def.reward.amber}
          </span>
        ) : null}
      </div>
    </button>
  )
}

export function DecreeChoice({ run, choice }: { run: RunState; choice: PendingChoice }) {
  const chooseOption = useGameStore((s) => s.chooseOption)
  const streak = run.decreeStreak ?? 0
  return (
    <div className="modal modal-queen">
      <header>
        <span className="modal-icon">
          <Icon id="horn" emoji="📯" />
        </span>
        <div>
          <h2>A Royal Decree</h2>
          <small>
            The Queen's herald brings two decrees. Choose one to answer before its countdown
            ends — or beg off both.
          </small>
        </div>
      </header>
      {streak > 0 && (
        <p className="queen-streak">
          <Icon id="reputation" label="" /> {streak} decree{streak === 1 ? '' : 's'} met in a row.{' '}
          <StreakNext streak={streak + 1} />
        </p>
      )}
      <div className="option-list option-grid">
        {(choice.decrees ?? []).map((decree) => (
          <DecreeOption
            key={decree.id}
            run={run}
            decree={decree}
            onPick={() => chooseOption(decree.id)}
          />
        ))}
      </div>
      <footer className="modal-foot queen-foot">
        <button type="button" className="reroll-button" onClick={() => chooseOption(DECLINE_CHOICE)}>
          Beg off both — <Icon id="impatience" label="impatience" /> +{DECREE_DECLINE_IMPATIENCE}
        </button>
        {streak > 0 && <small className="muted">Ends your streak.</small>}
      </footer>
    </div>
  )
}

function StreakNext({ streak }: { streak: number }) {
  const purse = decreeStreakBonus(streak)
  return purse > 0 ? <span className="is-good">Meet the next for +{purse} amber more.</span> : null
}

function DecreeOption({ run, decree, onPick }: { run: RunState; decree: RoyalDecree; onPick: () => void }) {
  const def = DECREES[decree.defId]
  const goal = decreeGoal(decree)
  if (!def || !goal) return null
  const reputation = decreeReputation(run, def)
  // What the staffed producers make in the time allowed, at today's pace.
  const pace =
    goal.kind === 'produced'
      ? Math.floor(productionRate(run, computeModifiers(run), goal.resource) * decree.timeLimit)
      : null
  return (
    <button type="button" className="option queen-option" onClick={onPick}>
      <strong>{def.name}</strong>
      <small>
        {describeTimedGoal(goal)} within {formatClock(decree.timeLimit)}
      </small>
      {pace !== null && <small>Your producers make about {pace} in that time now.</small>}
      <Progress value={decree.progress} />
      <div className="option-effects">
        {reputation > 0 && (
          <span className="is-good">
            <Icon id="reputation" label="reputation" /> +{reputation}
          </span>
        )}
        {def.impatienceRelief ? (
          <span className="is-good">
            <Icon id="impatience" label="impatience" /> −{def.impatienceRelief}
          </span>
        ) : null}
        {def.reward?.amber ? (
          <span className="is-good">
            <Icon of={RESOURCES.amber} label="amber" /> +{def.reward.amber}
          </span>
        ) : null}
        <span className="is-bad">
          Miss it: <Icon id="impatience" label="impatience" /> +{decreeMissCost(run)}
        </span>
      </div>
    </button>
  )
}

function Progress({ value }: { value: number }) {
  const pct = Math.floor(Math.max(0, Math.min(1, value)) * 100)
  return (
    <span className="queen-progress" aria-label={`${pct}% done`}>
      <span className="bar">
        <span className="bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <small>{pct}% done now</small>
    </span>
  )
}
