import { useEffect } from 'react'
import { canAfford } from '../game/engine/queries'
import {
  useGameStore,
  useHudRun,
  useRunRef,
  useRunSelector,
  type SidePanel,
} from '../game/store'
import { BuildPanel } from './BuildPanel'
import { ChoiceModal } from './ChoiceModal'
import { ConditionsBar } from './ConditionsBar'
import { EventToasts, useLogUnread } from './EventToasts'
import { Inspector } from './Inspector'
import { EndModal } from './lazyScreens'
import { MapView } from './MapView'
import { ResourceBar } from './ResourceBar'
import { LogPanel, OrdersPanel, TradePanel } from './SidePanels'
import { TipsCoach } from './TipsCoach'
import { describeStrike, describeWhileActive } from './threatText'
import { BagIcons } from './BagIcons'
import { Icon } from './Icon'
import { IconText } from './IconText'
import { TopBar } from './TopBar'
import { useAudioCues } from './useAudioCues'
import { PANEL_KEY_LABEL, useGameLoop, useHotkeys } from './useGameLoop'
import { VillagerPanel } from './VillagerPanel'
import { Warnings } from './Warnings'
import './hud-feedback.css'
import { TAB_ART, threatArt } from '../game/content/artFamilies'

const TABS: { id: Exclude<SidePanel, null>; label: string; icon: string }[] = [
  { id: 'build', label: 'Build', icon: '🔨' },
  { id: 'villagers', label: 'People', icon: '🧑‍🤝‍🧑' },
  { id: 'orders', label: 'Orders', icon: '📜' },
  { id: 'trade', label: 'Trade', icon: '⚖️' },
  { id: 'log', label: 'Log', icon: '📖' },
]

export function GameScreen() {
  // The screen re-renders only for what it shows itself (the season tint, the
  // run's end, the Log tab's unread badge); everything inside subscribes to
  // its own data, so a sim step does not re-render the whole HUD.
  const run = useRunRef()
  useRunSelector((r) => `${r.season.season}|${r.phase}|${r.log[0]?.id ?? -1}`)
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
          {/*
            One overlay dock over the map, in fixed regions so nothing piles up
            or covers the map's middle: critical warnings and passing notices
            at the top; the tip or the inspector bottom-left (tips wait while
            the player inspects or places); the decree, conditions and threats
            bottom-centre; news toasts bottom-right, clear of the map controls.
            Phones keep the same regions along the map's edges.
          */}
          <div className="hud-stack">
            <div className="hud-top">
              <Warnings />
              {notice && (
                <div className="notice" role="status" onClick={dismissNotice}>
                  {notice}
                </div>
              )}
            </div>
            <div className="hud-context">
              <TipsCoach />
              <Inspector />
            </div>
            <div className="bottom-stack">
              <ConditionsBar />
              <ThreatBar />
            </div>
            <EventToasts />
          </div>
        </div>

        <aside className={`sidebar ${panel ? 'is-open' : 'is-folded'}`}>
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
                <span aria-hidden>
                  <Icon id={TAB_ART[tab.id]} emoji={tab.icon} />
                </span>
                <em>{tab.label}</em>
                {tab.id === 'log' && unreadLog > 0 && (
                  <span className="tab-badge" aria-label={`${unreadLog} unread`}>
                    {unreadLog > 9 ? '9+' : unreadLog}
                  </span>
                )}
              </button>
            ))}
          </nav>
          {/* Phones: the side panel is a bottom sheet, and this folds it down
              to its tabs so the map gets the height. Desktop hides it. */}
          <button
            type="button"
            className="sheet-handle"
            aria-expanded={panel !== null}
            aria-controls="side-panel"
            aria-label={panel ? 'Fold the panel away' : 'Open the panel'}
            title={panel ? 'Fold the panel away' : 'Open the panel'}
            onClick={() => setPanel(panel ? null : 'build')}
          >
            <span aria-hidden>{panel ? '▾' : '▴'}</span>
          </button>
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
      {/* The summary and its chart are a separate chunk, fetched in idle time. */}
      {run.phase !== 'playing' && <EndModal />}
    </div>
  )
}

/** Active threats: what they cost, when they strike next, how to buy them off. */
function ThreatBar() {
  const run = useHudRun()
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
                <Icon id={threatArt(threat)} emoji={threat.icon} />
              </span>
              <span className="threat-text">
                <strong>
                  {threat.name}{' '}
                  <span className="threat-timer">
                    strikes in {Math.max(0, Math.ceil(threat.timer))}s
                  </span>
                </strong>
                <small className="threat-strike">
                  Every {threat.interval}s: <IconText text={describeStrike(threat)} />
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
              Appease: <BagIcons bag={threat.appease} label />
            </button>
          </div>
        )
      })}
    </div>
  )
}

