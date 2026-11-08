import { EDICT_REWARD_STEP, MAX_EDICT } from '../game/content/meta'
import { edictLabel, supplyBreakdown } from '../game/engine/meta'
import { useGameStore, useHudRun } from '../game/store'
import { Overlay } from './ChoiceModal'
import { CommissionEnd } from './Commissions'
import { EndExtras } from './EndExtras'
import { EnvoyEnd } from './EnvoyStatus'
import { RunModifierList } from './RunModifierList'
import { RunTimelineChart } from './RunTimeline'
import { Icon } from './Icon'
import { LeversEnd } from './QueenLevers'

export function EndModal() {
  const run = useHudRun()
  const finishRun = useGameStore((s) => s.finishRun)
  const edictUnlocked = useGameStore((s) => s.meta.edictUnlocked)
  if (!run || run.phase === 'playing') return null

  const won = run.phase === 'won'
  const retreated = !won && !!run.retreated
  const breakdown = supplyBreakdown(run)
  const reward = breakdown.total
  // Winning at the highest edict earned so far opens the next rung (a daily
  // is played under a fixed edict, so it opens none).
  const opensEdict =
    won && !run.daily && breakdown.edict >= edictUnlocked && breakdown.edict < MAX_EDICT
      ? breakdown.edict + 1
      : null

  return (
    <Overlay>
      <div className={`modal modal-end ${won ? 'is-won' : 'is-lost'}`}>
        <header>
          <span className="modal-icon">
            {won ? <Icon id="reputation" /> : retreated ? <Icon id="guildHouse" emoji="🏛️" /> : <Icon id="fog" emoji="🌫️" />}
          </span>
          <div>
            <h2>{won ? 'The settlement holds' : retreated ? 'Retreated to the Citadel' : 'The settlement is lost'}</h2>
            <small>
              {won
                ? run.envoy
                  ? "The Queen's envoy found the settlement standing. Your name goes in the ledger."
                  : 'The Queen is satisfied. Your name goes in the ledger.'
                : retreated
                  ? "You led the settlers home before the Queen's patience ran out. The run counts as lost; what it earned goes home."
                  : run.envoy
                    ? "The Queen was satisfied, but the settlement fell before her envoy arrived."
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

            <EnvoyEnd run={run} />
            <CommissionEnd run={run} breakdown={breakdown} />
            <LeversEnd run={run} />

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
                  <span>
                    <Icon id="warehouse" emoji="📦" /> {reward}
                  </span>
                </li>
              </ul>
              {opensEdict !== null && (
                <p className="is-good">
                  <Icon id="scroll" emoji="📜" /> Victory under these terms unlocks {edictLabel(opensEdict)}.
                </p>
              )}
            </section>

            <EndExtras run={run} />
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
