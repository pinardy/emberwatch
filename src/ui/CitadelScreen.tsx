import { META_UPGRADE_LIST } from '../game/content/meta'
import { useGameStore } from '../game/store'

/** Between-run hub: spend supplies on permanent unlocks, review past runs. */
export function CitadelScreen() {
  const meta = useGameStore((s) => s.meta)
  const buyUpgrade = useGameStore((s) => s.buyUpgrade)
  const goToScreen = useGameStore((s) => s.goToScreen)

  return (
    <div className="screen citadel-screen">
      <div className="menu-card wide">
        <header className="row-between">
          <h2>🏛️ The Citadel</h2>
          <span className="chip big">📦 {meta.citadelSupplies} supplies</span>
        </header>
        <p className="muted">
          Every settlement you found — won or lost — sends supplies back to the Citadel.
          Spend them on charters and provisions that carry into future runs.
        </p>

        <div className="upgrade-grid">
          {META_UPGRADE_LIST.map((def) => {
            const owned = meta.upgrades.includes(def.id)
            const affordable = meta.citadelSupplies >= def.cost
            return (
              <button
                key={def.id}
                type="button"
                className={`upgrade-card ${owned ? 'is-owned' : ''} ${
                  !owned && !affordable ? 'is-poor' : ''
                }`}
                disabled={owned || !affordable}
                onClick={() => buyUpgrade(def.id)}
              >
                <span className="option-icon">{def.icon}</span>
                <strong>{def.name}</strong>
                <small>{def.description}</small>
                <em>{owned ? '✓ Unlocked' : `${def.cost} supplies`}</em>
              </button>
            )
          })}
        </div>

        {meta.history.length > 0 && (
          <section className="setup-section">
            <h3>Ledger</h3>
            <ul className="history-list">
              {meta.history.map((entry) => (
                <li key={`${entry.seed}-${entry.at}`}>
                  <span className={entry.won ? 'is-good' : 'is-bad'}>
                    {entry.won ? '👑 Held' : '🌫️ Lost'}
                  </span>
                  <span>
                    Year {entry.years} · {entry.reputation} reputation
                  </span>
                  <code>{entry.seed}</code>
                </li>
              ))}
            </ul>
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
