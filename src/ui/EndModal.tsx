import { supplyReward } from '../game/content/meta'
import { useGameStore, useRun } from '../game/store'
import { Overlay } from './ChoiceModal'

export function EndModal() {
  const run = useRun()
  const finishRun = useGameStore((s) => s.finishRun)
  if (!run || run.phase === 'playing') return null

  const won = run.phase === 'won'
  const reward = supplyReward(run)

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
