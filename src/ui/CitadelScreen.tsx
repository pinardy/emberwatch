import {
  META_BRANCHES,
  META_UPGRADES,
  META_UPGRADE_LIST,
  edictNumeral,
  missingPrerequisites,
  upgradeStatus,
} from '../game/content/meta'
import { SPECIES } from '../game/content/species'
import { runModifierDefs } from '../game/engine/runModifiers'
import { useGameStore } from '../game/store'
import { EdictPicker } from './EdictPicker'

/** Runs shown in the ledger; older ones stay in the save but off screen. */
const LEDGER_ROWS = 10

/** Between-run hub: spend supplies on the upgrade tree, review past runs. */
export function CitadelScreen() {
  const meta = useGameStore((s) => s.meta)
  const buyUpgrade = useGameStore((s) => s.buyUpgrade)
  const goToScreen = useGameStore((s) => s.goToScreen)

  const owned = meta.upgrades.filter((id) => META_UPGRADES[id]).length

  return (
    <div className="screen citadel-screen">
      <div className="menu-card wide">
        <header className="row-between">
          <h2>🏛️ The Citadel</h2>
          <span className="chip big">📦 {meta.citadelSupplies} supplies</span>
        </header>
        <p className="muted">
          Every settlement you found — won or lost — sends supplies back to the Citadel.
          Spend them on provisions, charters, archives and royal favours that carry into
          future runs. Deeper upgrades need the ones above them first.
        </p>
        <div className="citadel-stats">
          <span className="chip">
            🏗️ {owned}/{META_UPGRADE_LIST.length} upgrades
          </span>
          <span className="chip">👑 {meta.runsWon} held</span>
          <span className="chip">🌫️ {meta.runsLost} lost</span>
          <span className="chip">
            📜{' '}
            {meta.edictUnlocked > 0
              ? `Up to Edict ${edictNumeral(meta.edictUnlocked)}`
              : 'No edicts earned yet'}
          </span>
        </div>

        <div className="upgrade-tree">
          {META_BRANCHES.map((branch) => (
            <section key={branch.id} className="upgrade-branch" aria-label={branch.name}>
              <header>
                <h3>
                  {branch.icon} {branch.name}
                </h3>
                <small>{branch.blurb}</small>
              </header>
              {META_UPGRADE_LIST.filter((def) => def.branch === branch.id).map((def) => {
                const status = upgradeStatus(meta, def.id)
                const missing = missingPrerequisites(meta, def.id)
                const label =
                  status === 'owned'
                    ? '✓ Unlocked'
                    : status === 'locked'
                      ? `🔒 ${def.cost} supplies`
                      : `${def.cost} supplies`
                return (
                  <button
                    key={def.id}
                    type="button"
                    className={`upgrade-card is-${status} ${def.requires ? 'is-child' : ''}`}
                    disabled={status !== 'available'}
                    onClick={() => buyUpgrade(def.id)}
                  >
                    <span className="option-icon">{def.icon}</span>
                    <strong>{def.name}</strong>
                    <small>{def.description}</small>
                    {missing.length > 0 && (
                      // Icons, not names: each name already heads its own card.
                      <small
                        className="upgrade-req"
                        title={`Requires ${missing.map((id) => META_UPGRADES[id]?.name ?? id).join(', ')}`}
                      >
                        Requires {missing.map((id) => META_UPGRADES[id]?.icon ?? id).join(' ')}
                      </small>
                    )}
                    <em>{label}</em>
                  </button>
                )
              })}
            </section>
          ))}
        </div>

        <section className="setup-section">
          <h3>Queen's Edicts</h3>
          <p className="muted">
            The Queen sets harsher terms for viceroys who have proven themselves — and pays
            more for them. Win under your hardest edict to unlock the next; choose one
            when you found a settlement.
          </p>
          <EdictPicker unlocked={meta.edictUnlocked} value={meta.edictUnlocked} />
        </section>

        {meta.history.length > 0 && (
          <section className="setup-section">
            <h3>Ledger</h3>
            <div className="history-scroll">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Result</th>
                    <th>Settlers</th>
                    <th>Edict</th>
                    <th>Land</th>
                    <th>Years</th>
                    <th>Reputation</th>
                    <th>Supplies</th>
                    <th>Seed</th>
                  </tr>
                </thead>
                <tbody>
                  {meta.history.slice(0, LEDGER_ROWS).map((entry) => (
                    <tr key={`${entry.seed}-${entry.at}`}>
                      <td className={entry.won ? 'is-good' : 'is-bad'}>
                        {entry.won ? '👑 Held' : '🌫️ Lost'}
                      </td>
                      <td>
                        {entry.species?.length
                          ? entry.species.map((id) => SPECIES[id]?.icon ?? id).join(' ')
                          : '—'}
                      </td>
                      <td>{edictNumeral(entry.edict ?? 0)}</td>
                      <td title={runModifierDefs(entry.modifiers ?? []).map((d) => d.name).join(', ')}>
                        {entry.modifiers?.length
                          ? runModifierDefs(entry.modifiers).map((d) => d.icon).join(' ')
                          : '—'}
                      </td>
                      <td>{entry.years}</td>
                      <td>{entry.reputation}</td>
                      <td>{entry.supplies !== undefined ? `+${entry.supplies}` : '—'}</td>
                      <td>
                        <code>{entry.seed}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <footer className="modal-foot">
          <button type="button" onClick={() => goToScreen('menu')}>
            Back to menu
          </button>
          <button type="button" className="primary" onClick={() => goToScreen('setup')}>
            Found a new settlement
          </button>
        </footer>
      </div>
    </div>
  )
}
