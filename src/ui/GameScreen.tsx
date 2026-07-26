import { useEffect } from 'react'
import { collectWarnings } from '../game/engine/diagnostics'
import { useGameStore, useRun, type SidePanel } from '../game/store'
import { BuildPanel } from './BuildPanel'
import { ChoiceModal } from './ChoiceModal'
import { EndModal } from './EndModal'
import { Inspector } from './Inspector'
import { MapView } from './MapView'
import { ResourceBar } from './ResourceBar'
import { LogPanel, OrdersPanel, TradePanel } from './SidePanels'
import { TopBar } from './TopBar'
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

  // Notices are transient; clear them after a beat.
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(dismissNotice, 2600)
    return () => window.clearTimeout(timer)
  }, [notice, dismissNotice])

  if (!run) return null

  return (
    <div className="game">
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
      <Warnings />
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
