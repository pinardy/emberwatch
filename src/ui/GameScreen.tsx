import { useEffect } from 'react'
import { RESOURCES } from '../game/content/resources'
import { canAfford } from '../game/engine/queries'
import { useGameStore, useRun, type SidePanel } from '../game/store'
import { BuildPanel } from './BuildPanel'
import { ChoiceModal } from './ChoiceModal'
import { ConditionsBar } from './ConditionsBar'
import { EventToasts, useLogUnread } from './EventToasts'
import { EndModal } from './EndModal'
import { Inspector } from './Inspector'
import { MapView } from './MapView'
import { ResourceBar } from './ResourceBar'
import { LogPanel, OrdersPanel, TradePanel } from './SidePanels'
import { TipsCoach } from './TipsCoach'
import { describeStrike, describeWhileActive } from './threatText'
import { TopBar } from './TopBar'
import { useAudioCues } from './useAudioCues'
import { PANEL_KEY_LABEL, useGameLoop, useHotkeys } from './useGameLoop'
import { VillagerPanel } from './VillagerPanel'
import { Warnings } from './Warnings'
import './hud-feedback.css'

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
  const unreadLog = useLogUnread(run, panel === 'log')

  // Notices are transient; clear them after a beat.
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(dismissNotice, 2600)
    return () => window.clearTimeout(timer)
  }, [notice, dismissNotice])

  if (!run) return null

  /** Arrow keys move between tabs, as in any tablist. */
  const onTabKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    e.stopPropagation() // not a camera pan
    const current = TABS.findIndex((t) => t.id === panel)
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? TABS.length - 1
          : (Math.max(0, current) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length
    setPanel(TABS[next].id)
    document.getElementById(`tab-${TABS[next].id}`)?.focus()
  }

  return (
    <div className="game" data-season={run.season.season}>
      <div className="season-tint" aria-hidden />
      <TopBar />
      <ResourceBar />

      <main className="game-main">
        <div className="map-column">
          <MapView />
          {/* One coordinated stack over the map, so the overlays never pile up. */}
          <div className="hud-stack">
            <Warnings />
            {notice && (
              <div className="notice" role="status" onClick={dismissNotice}>
                {notice}
              </div>
            )}
            <EventToasts />
            <div className="bottom-stack">
              <ConditionsBar />
              <ThreatBar />
            </div>
            <TipsCoach />
            <Inspector />
          </div>
        </div>

        <aside className="sidebar">
          <nav className="tabs" role="tablist" aria-label="Side panels" onKeyDown={onTabKey}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={panel === tab.id}
                aria-controls={panel === tab.id ? 'side-panel' : undefined}
                aria-keyshortcuts={PANEL_KEY_LABEL[tab.id]}
                tabIndex={panel === tab.id || (panel === null && tab.id === 'build') ? 0 : -1}
                title={`${tab.label} (${PANEL_KEY_LABEL[tab.id]})`}
                className={panel === tab.id ? 'is-active' : ''}
                onClick={() => setPanel(panel === tab.id ? null : tab.id)}
              >
                <span aria-hidden>{tab.icon}</span>
                <em>{tab.label}</em>
                {tab.id === 'log' && unreadLog > 0 && (
                  <span className="tab-badge" aria-label={`${unreadLog} unread`}>
                    {unreadLog > 9 ? '9+' : unreadLog}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div
            key={panel ?? 'none'}
            className="panel-scroll"
            id="side-panel"
            role={panel ? 'tabpanel' : undefined}
            aria-labelledby={panel ? `tab-${panel}` : undefined}
          >
            {panel === 'build' && <BuildPanel />}
            {panel === 'villagers' && <VillagerPanel />}
            {panel === 'orders' && <OrdersPanel />}
            {panel === 'trade' && <TradePanel />}
            {panel === 'log' && <LogPanel />}
          </div>
        </aside>
      </main>

      <ChoiceModal />
      <EndModal />
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
        const standing = describeWhileActive(threat.whileActive)
        return (
          <div key={threat.id} className="threat-card">
            <button
              type="button"
              className="threat-focus"
              onClick={() => glade && focusCamera(glade.center)}
              title={`${threat.description}${glade ? ` Show ${glade.name} on the map.` : ''}`}
            >
              <span className="threat-icon" aria-hidden>
                {threat.icon}
              </span>
              <span className="threat-text">
                <strong>
                  {threat.name}{' '}
                  <span className="threat-timer">
                    strikes in {Math.max(0, Math.ceil(threat.timer))}s
                  </span>
                </strong>
                <small className="threat-strike">
                  Every {threat.interval}s: {describeStrike(threat)}
                </small>
                {standing && (
                  <small className="threat-standing">While loose: {standing}</small>
                )}
              </span>
            </button>
            <button
              type="button"
              className="threat-appease"
              disabled={!affordable}
              onClick={() => appease(threat.id)}
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

