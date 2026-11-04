import { useEffect } from 'react'
import { RESOURCES } from '../game/content/resources'
import { collectWarnings } from '../game/engine/diagnostics'
import { canAfford } from '../game/engine/queries'
import { useGameStore, useRun, type SidePanel } from '../game/store'
import { BuildPanel } from './BuildPanel'
import { ChoiceModal } from './ChoiceModal'
import { ConditionsBar } from './ConditionsBar'
import { EndModal } from './EndModal'
import { Inspector } from './Inspector'
import { MapView } from './MapView'
import { ResourceBar } from './ResourceBar'
import { LogPanel, OrdersPanel, TradePanel } from './SidePanels'
import { TipsCoach } from './TipsCoach'
import { TopBar } from './TopBar'
import { useAudioCues } from './useAudioCues'
import { useGameLoop, useHotkeys } from './useGameLoop'
import { VillagerPanel } from './VillagerPanel'

const TABS: { id: Exclude<SidePanel, null>; label: string; icon: string }[] = [
  { id: 'build', label: 'Build', icon: '🔨' },
  { id: 'villagers', label: 'People', icon: '🧑‍🤝‍🧑' },
  { id: 'orders', label: 'Orders', icon: '📜' },
  { id: 'trade', label: 'Trade', icon: '⚖️' },
  { id: 'log', label: 'Log', icon: '📖' },
]

export function GameScreen() {
  const run = useRun()
  const panel = useGameStore((s) => s.panel)
  const setPanel = useGameStore((s) => s.setPanel)
  const notice = useGameStore((s) => s.notice)
  const dismissNotice = useGameStore((s) => s.dismissNotice)

  useGameLoop(run !== null)
  useHotkeys(run !== null)
  useAudioCues(run)

  // Notices are transient; clear them after a beat.
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(dismissNotice, 2600)
    return () => window.clearTimeout(timer)
  }, [notice, dismissNotice])

  if (!run) return null

  return (
    <div className="game" data-season={run.season.season}>
      <div className="season-tint" aria-hidden />
      <TopBar />
      <ResourceBar />

      <main className="game-main">
        <div className="map-column">
          <MapView />
          <Inspector />
        </div>

        <aside className="sidebar">
          <nav className="tabs" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={panel === tab.id}
                className={panel === tab.id ? 'is-active' : ''}
                onClick={() => setPanel(panel === tab.id ? null : tab.id)}
              >
                <span>{tab.icon}</span>
                <em>{tab.label}</em>
              </button>
            ))}
          </nav>
          <div className="panel-scroll">
            {panel === 'build' && <BuildPanel />}
            {panel === 'villagers' && <VillagerPanel />}
            {panel === 'orders' && <OrdersPanel />}
            {panel === 'trade' && <TradePanel />}
            {panel === 'log' && <LogPanel />}
          </div>
        </aside>
      </main>

      {notice && (
        <div className="notice" role="status" onClick={dismissNotice}>
          {notice}
        </div>
      )}

      <ChoiceModal />
      <EndModal />
      <div className="bottom-stack">
        <ConditionsBar />
        <ThreatBar />
      </div>
      <Warnings />
      <TipsCoach />
    </div>
  )
}

/** Active threats: what they cost, when they strike next, how to buy them off. */
function ThreatBar() {
  const run = useRun()
  const appease = useGameStore((s) => s.appease)
  const focusCamera = useGameStore((s) => s.focusCamera)
  if (!run || run.threats.length === 0) return null
  return (
    <div className="threat-bar">
      {run.threats.map((threat) => {
        const affordable = canAfford(run.stock, threat.appease)
        const glade = run.glades[threat.gladeId]
        return (
          <div
            key={threat.id}
            className="threat-card"
            onClick={() => glade && focusCamera(glade.center)}
            title={glade ? `Show ${glade.name} on the map` : undefined}
          >
            <span className="threat-icon">{threat.icon}</span>
            <div className="threat-text">
              <strong>{threat.name}</strong>
              <small>
                strikes in {Math.max(0, Math.ceil(threat.timer))}s · {threat.description}
              </small>
            </div>
            <button
              type="button"
              disabled={!affordable}
              onClick={(e) => {
                e.stopPropagation()
                appease(threat.id)
              }}
              title={affordable ? 'Pay it off' : 'You cannot afford this yet'}
            >
              Appease:{' '}
              {Object.entries(threat.appease).map(([id, amount]) => (
                <span key={id}>
                  {RESOURCES[id as keyof typeof RESOURCES]?.icon}
                  {amount}{' '}
                </span>
              ))}
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** Persistent nudges for the things that quietly ruin a settlement. */
function Warnings() {
  const run = useRun()
  if (!run) return null
  const warnings = collectWarnings(run)
  if (warnings.length === 0) return null
  return (
    <div className="warnings">
      {warnings.slice(0, 4).map((warning) => (
        <div key={warning.id} className={`warning is-${warning.severity}`}>
          {warning.text}
        </div>
      ))}
    </div>
  )
}
