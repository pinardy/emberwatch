import {
  EDICT_REWARD_STEP,
  MAX_EDICT,
  edictLabel,
  supplyBreakdown,
} from '../game/content/meta'
import { useGameStore, useRun } from '../game/store'
import { Overlay } from './ChoiceModal'
import { RunModifierList } from './RunModifierList'
import { RunTimelineChart } from './RunTimeline'

export function EndModal() {
  const run = useRun()
  const finishRun = useGameStore((s) => s.finishRun)
  const edictUnlocked = useGameStore((s) => s.meta.edictUnlocked)
  if (!run || run.phase === 'playing') return null

  const won = run.phase === 'won'
  const breakdown = supplyBreakdown(run)
  const reward = breakdown.total
  // Winning at the highest edict earned so far opens the next rung.
  const opensEdict =
    won && breakdown.edict >= edictUnlocked && breakdown.edict < MAX_EDICT
      ? breakdown.edict + 1
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

        <div className="end-layout">
          <RunTimelineChart run={run} />

          <div className="end-side">
            {(run.runModifiers ?? []).length > 0 && (
              <section className="end-land" aria-label="Lay of the land">
                <h3>The land</h3>
                <RunModifierList ids={run.runModifiers} compact />
              </section>
            )}

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
                {breakdown.edict > 0 && (
                  <li className="is-good">
                    <span>
                      Queen's {edictLabel(breakdown.edict)} (+
                      {Math.round(breakdown.edict * EDICT_REWARD_STEP * 100)}%)
                    </span>
                    <span>+{breakdown.edictBonus}</span>
                  </li>
                )}
                <li className="reward-total">
                  <span>Total</span>
                  <span>📦 {reward}</span>
                </li>
              </ul>
              {opensEdict !== null && (
                <p className="is-good">
                  📜 Victory under these terms unlocks {edictLabel(opensEdict)}.
                </p>
              )}
            </section>
          </div>
        </div>

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
