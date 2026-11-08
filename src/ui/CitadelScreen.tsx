import { ACHIEVEMENT_UNLOCKS, META_BRANCHES, META_UPGRADES, META_UPGRADE_LIST } from '../game/content/meta'
import { ACHIEVEMENTS } from '../game/content/achievements'
import { edictNumeral, missingPrerequisites, openedEarly, upgradeStatus } from '../game/engine/meta'
import { COMMISSIONS, commissionsOpenedBy, boardFor, COMMISSION_LIST } from '../game/content/commissions'
import { SPECIES } from '../game/content/species'
import { runModifierDefs } from '../game/engine/runModifiers'
import { useGameStore } from '../game/store'
import { CommissionBoard } from './Commissions'
import { EdictPicker } from './EdictPicker'
import { Icon } from './Icon'
import { runModifierArt } from '../game/content/art'
import { achievementArt, metaBranchArt, metaUpgradeArt } from '../game/content/artFamilies'
import { citadelUnlockRows } from './citadelUnlocks'
import './needs.css'

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
          <h1 className="screen-title">
            <Icon id="guildHouse" emoji="🏛️" /> The Citadel
          </h1>
          <span className="chip big">
            <Icon id="warehouse" emoji="📦" /> {meta.citadelSupplies} supplies
          </span>
        </header>
        <p className="muted">
          Every settlement you found — won or lost — sends supplies back to the Citadel.
          Spend them on provisions, charters, archives and royal favours that carry into
          future runs. Deeper upgrades need the ones above them first.
        </p>
        <div className="citadel-stats">
          <span className="chip">
            <Icon id="scaffold" emoji="🏗️" /> {owned}/{META_UPGRADE_LIST.length} upgrades
          </span>
          <span className="chip">
            <Icon id="reputation" /> {meta.runsWon} held
          </span>
          <span className="chip">
            <Icon id="fog" emoji="🌫️" /> {meta.runsLost} lost
          </span>
          <span className="chip">
            <Icon id="charter/seal" emoji="📜" /> {boardFor(meta).length}/
            {COMMISSION_LIST.length} commissions
          </span>
          <span className="chip">
            <Icon id="scroll" emoji="📜" />{' '}
            {meta.edictUnlocked > 0
              ? `Up to Edict ${edictNumeral(meta.edictUnlocked)}`
              : 'No edicts earned yet'}
          </span>
        </div>

        <div className="upgrade-tree">
          {META_BRANCHES.map((branch) => (
            <section key={branch.id} className="upgrade-branch" aria-label={branch.name}>
              <header>
                <h2>
                  <Icon id={metaBranchArt(branch.id)} emoji={branch.icon} /> {branch.name}
                </h2>
                <small>{branch.blurb}</small>
              </header>
              {META_UPGRADE_LIST.filter((def) => def.branch === branch.id).map((def) => {
                const status = upgradeStatus(meta, def.id)
                const missing = missingPrerequisites(meta, def.id)
                const opens = commissionsOpenedBy(def.id)
                const earlyBy = Object.entries(ACHIEVEMENT_UNLOCKS).find(([, u]) => u.upgrade === def.id)
                const early = earlyBy ? ACHIEVEMENTS[earlyBy[0]] : undefined
                const isEarly = openedEarly(meta, def.id)
                const label =
                  status === 'owned' ? (
                    '✓ Unlocked'
                  ) : status === 'locked' ? (
                    <>
                      <Icon id="lock" emoji="🔒" /> {def.cost} supplies
                    </>
                  ) : (
                    `${def.cost} supplies`
                  )
                return (
                  <button
                    key={def.id}
                    type="button"
                    className={`upgrade-card is-${status} ${def.requires ? 'is-child' : ''}`}
                    disabled={status !== 'available'}
                    onClick={() => buyUpgrade(def.id)}
                  >
                    <span className="option-icon">
                      <Icon id={metaUpgradeArt(def)} emoji={def.icon} />
                    </span>
                    <strong>{def.name}</strong>
                    <small>{def.description}</small>
                    {opens.map((c) => (
                      <small key={c.id} className="upgrade-opens">
                        Opens the commission <Icon id={c.art} emoji={c.icon} /> {c.name}
                      </small>
                    ))}
                    {early && status !== 'owned' && (isEarly || def.requires) && (
                      <small className={`upgrade-early ${isEarly ? 'is-open' : ''}`}>
                        {isEarly ? 'Opened early by ' : 'Earn '}
                        <Icon id={achievementArt(early)} emoji={early.icon} /> {early.name}
                        {isEarly ? '' : ' to open it early'}
                      </small>
                    )}
                    {missing.length > 0 && (
                      // Icons, not names: each name already heads its own card.
                      <small
                        className="upgrade-req"
                        title={`Requires ${missing.map((id) => META_UPGRADES[id]?.name ?? id).join(', ')}`}
                      >
                        Requires{' '}
                        {missing.map((id) => {
                          const req = META_UPGRADES[id]
                          return req ? <Icon key={id} id={metaUpgradeArt(req)} emoji={req.icon} /> : id
                        })}
                      </small>
                    )}
                    <em>{label}</em>
                  </button>
                )
              })}
            </section>
          ))}
        </div>

        <CitadelUnlocks unlocked={meta.achievements.unlocked} />

        <section className="setup-section" aria-label="Commissions">
          <h2>Commissions</h2>
          <p className="muted">
            Each settlement may set out on a commission: a twist from the founding and an
            objective that pays extra supplies if met. A few from the board are on offer
            before every run — a newly opened one always among them — and upgrades open
            more.
          </p>
          <CommissionBoard meta={meta} />
        </section>

        <section className="setup-section">
          <h2>Queen's Edicts</h2>
          <p className="muted">
            The Queen sets harsher terms for viceroys who have proven themselves — and pays
            more for them. Win under your hardest edict to unlock the next; choose one
            when you found a settlement.
          </p>
          <EdictPicker unlocked={meta.edictUnlocked} value={meta.edictUnlocked} />
        </section>

        {meta.history.length > 0 && (
          <section className="setup-section">
            <h2>Ledger</h2>
            <div className="history-scroll">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Result</th>
                    <th>Settlers</th>
                    <th>Edict</th>
                    <th>Land</th>
                    <th>Commission</th>
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
                        {entry.won ? (
                          <>
                            <Icon id="reputation" /> Held
                          </>
                        ) : (
                          <>
                            <Icon id="fog" emoji="🌫️" /> Lost
                          </>
                        )}
                      </td>
                      <td>
                        {entry.species?.length
                          ? entry.species.map((id) => (
                              <Icon key={id} of={SPECIES[id]} emoji={id} label={SPECIES[id]?.name ?? id} />
                            ))
                          : '—'}
                      </td>
                      <td>{edictNumeral(entry.edict ?? 0)}</td>
                      <td title={runModifierDefs(entry.modifiers ?? []).map((d) => d.name).join(', ')}>
                        {entry.modifiers?.length
                          ? runModifierDefs(entry.modifiers).map((d) => (
                              <Icon key={d.id} id={runModifierArt(d)} emoji={d.icon} />
                            ))
                          : '—'}
                      </td>
                      <td>
                        {entry.commission && COMMISSIONS[entry.commission.id] ? (
                          <span
                            className={entry.commission.met ? 'is-good' : 'muted'}
                            title={`${COMMISSIONS[entry.commission.id].name}: ${entry.commission.met ? 'met' : 'not met'}`}
                          >
                            <Icon
                              id={COMMISSIONS[entry.commission.id].art}
                              emoji={COMMISSIONS[entry.commission.id].icon}
                            />{' '}
                            {entry.commission.met ? '✓' : '✗'}
                          </span>
                        ) : (
                          '—'
                        )}
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
          <button type="button" onClick={() => goToScreen('achievements')}>
            <Icon id="medal" emoji="🏅" /> Achievements
          </button>
          <button type="button" className="primary" onClick={() => goToScreen('setup')}>
            Found a new settlement
          </button>
        </footer>
      </div>
    </div>
  )
}

/**
 * What the style achievements open here: a cornerstone in every draft, an
 * upgrade without its prerequisites, a commission on the board early.
 */
function CitadelUnlocks({ unlocked }: { unlocked: Readonly<Record<string, number>> }) {
  const rows = citadelUnlockRows(unlocked)
  const open = rows.filter((r) => r.earned).length
  return (
    <section className="setup-section" aria-label="Earned in the field">
      <h2>
        Earned in the field{' '}
        <small className="muted">
          {open}/{rows.length}
        </small>
      </h2>
      <p className="muted">
        Win your way and the Citadel takes note: each style achievement opens something here
        for good.
      </p>
      <ul className="citadel-unlocks">
        {rows.map((r) => {
          const def = ACHIEVEMENTS[r.achievementId]
          return (
            <li key={r.achievementId} className={r.earned ? 'is-earned' : 'is-locked'}>
              <span className="option-icon" aria-hidden>
                {def ? <Icon id={achievementArt(def)} emoji={r.icon} /> : r.icon}
              </span>
              <div>
                <strong>{r.name}</strong>
                <small>{r.description}</small>
                <small className="unlock-text">
                  {r.earned ? '✓ ' : '🔒 '}
                  {r.text}
                </small>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
