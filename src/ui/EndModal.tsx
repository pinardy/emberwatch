import {
  DECREE_REWARD_STEP,
  MAX_DECREE,
  decreeLabel,
  supplyBreakdown,
} from '../game/content/meta'
import { useGameStore, useRun } from '../game/store'
import { Overlay } from './ChoiceModal'

export function EndModal() {
  const run = useRun()
  const finishRun = useGameStore((s) => s.finishRun)
  const decreeUnlocked = useGameStore((s) => s.meta.decreeUnlocked)
  if (!run || run.phase === 'playing') return null

  const won = run.phase === 'won'
  const breakdown = supplyBreakdown(run)
  const reward = breakdown.total
  // Winning at the highest decree earned so far opens the next rung.
  const opensDecree =
    won && breakdown.decree >= decreeUnlocked && breakdown.decree < MAX_DECREE
      ? breakdown.decree + 1
      : null

  return (
    <Overlay>
      <div className={`modal modal-end ${won ? 'is-won' : 'is-lost'}`}>
        <header>
          <span className="modal-icon">{won ? '👑' : '🌫️'}</span>
          <div>
            <h2>{won ? 'The settlement holds' : 'The settlement is lost'}</h2>
            <small>
              {won
                ? 'The Queen is satisfied. Your name goes in the ledger.'
                : "The Queen's patience ran out before the forest did."}
            </small>
          </div>
        </header>

        <dl className="end-stats">
          <div>
            <dt>Years survived</dt>
            <dd>{run.season.year}</dd>
          </div>
          <div>
            <dt>Reputation</dt>
            <dd>
              {run.reputation}/{run.maxReputation}
            </dd>
          </div>
          <div>
            <dt>Villagers</dt>
            <dd>{Object.keys(run.villagers).length}</dd>
          </div>
          <div>
            <dt>Glades cleared</dt>
            <dd>{run.stats.gladesCleared}</dd>
          </div>
          <div>
            <dt>Orders completed</dt>
            <dd>{run.stats.ordersCompleted}</dd>
          </div>
          <div>
            <dt>Villagers lost</dt>
            <dd>{run.stats.villagersLost}</dd>
          </div>
          <div>
            <dt>Buildings raised</dt>
            <dd>{run.stats.buildingsBuilt}</dd>
          </div>
          <div>
            <dt>Goods produced</dt>
            <dd>{Math.floor(run.stats.resourcesProduced)}</dd>
          </div>
        </dl>

        <section className="reward-breakdown" aria-label="Citadel supplies">
          <h3>Supplies sent home</h3>
          <ul>
            {breakdown.lines.map((line) => (
              <li key={line.label}>
                <span>{line.label}</span>
                <span>+{line.amount}</span>
              </li>
            ))}
            {breakdown.decree > 0 && (
              <li className="is-good">
                <span>
                  Queen's {decreeLabel(breakdown.decree)} (+
                  {Math.round(breakdown.decree * DECREE_REWARD_STEP * 100)}%)
                </span>
                <span>+{breakdown.decreeBonus}</span>
              </li>
            )}
            <li className="reward-total">
              <span>Total</span>
              <span>📦 {reward}</span>
            </li>
          </ul>
          {opensDecree !== null && (
            <p className="is-good">
              📜 Victory under these terms unlocks {decreeLabel(opensDecree)}.
            </p>
          )}
        </section>

        <p className="modal-flavour">
          Seed <code>{run.seed}</code> — reuse it from the menu to replay this map.
        </p>

        <footer className="modal-foot">
          <button type="button" className="primary" onClick={finishRun}>
            Return to the Citadel (+{reward} supplies)
          </button>
        </footer>
      </div>
    </Overlay>
  )
}
