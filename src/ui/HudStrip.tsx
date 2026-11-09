import { useEffect, useState, type ReactNode } from 'react'
import { DECREES } from '../game/content/decrees'
import { ERRANDS } from '../game/content/errands'
import { conditionArt, threatArt } from '../game/content/artFamilies'
import { openErrands } from '../game/engine/errands'
import { formatClock } from '../game/engine/forecast'
import { useGameStore, useHudRun } from '../game/store'
import type { IconId } from '../art/icons'
import type { RunState, Vec2 } from '../game/types'
import { Icon } from './Icon'
import { useEscapeLayer } from './useGameLoop'
import { useNarrowScreen } from './useNarrowScreen'

/*
 * The HUD's bottom stack on phones. The decree, glade conditions, threats and
 * errands each have a card on desktop; on a phone those cards together could
 * cover most of the map. There they fold into one strip: the most urgent item
 * with its clock, and a "+N more" control that opens the full stack (the very
 * same cards, so nothing is lost) and closes it again.
 */

export type StripKind = 'threat' | 'blight' | 'decree' | 'condition' | 'errand'

export interface StripItem {
  key: string
  kind: StripKind
  name: string
  /** Seconds on its clock; null for an open-ended condition. */
  seconds: number | null
  urgent: boolean
  art?: IconId
  emoji: string
  /**
   * What a tap does: show the glade on the map, open the Orders panel, or
   * (for a blight, which has no glade) open the full card with what lifts it.
   */
  target: { kind: 'map'; pos: Vec2 } | { kind: 'orders' } | { kind: 'expand' }
}

export const STRIP_KIND_LABEL: Record<StripKind, string> = {
  threat: 'Threat',
  blight: 'Blight',
  decree: 'Decree',
  condition: 'Condition',
  errand: 'Errand',
}

const TARGET_TITLE: Record<StripItem['target']['kind'], string> = {
  map: 'Show it on the map',
  orders: "Open the Queen's orders",
  expand: 'Show the full card',
}

/**
 * Every item of the bottom stack, most urgent first: a threat about to strike
 * or a blight about to break, soonest first; then the decree and the other
 * conditions by time left; then errands, which are optional.
 */
export function hudStripItems(run: RunState): StripItem[] {
  const striking: StripItem[] = []
  const timed: StripItem[] = []
  const errands: StripItem[] = []

  for (const threat of run.threats) {
    const glade = run.glades[threat.gladeId]
    const seconds = Math.max(0, threat.timer)
    striking.push({
      key: `threat-${threat.id}`,
      kind: 'threat',
      name: threat.name,
      seconds,
      urgent: seconds < 30,
      art: threatArt(threat),
      emoji: threat.icon,
      target: glade ? { kind: 'map', pos: glade.center } : { kind: 'orders' },
    })
  }

  for (const condition of run.conditions) {
    const glade = run.glades[condition.gladeId]
    const seconds = condition.timeLeft ?? null
    const blight = !!condition.breaksWithStorm && seconds !== null
    const item: StripItem = {
      key: `condition-${condition.id}`,
      kind: blight ? 'blight' : 'condition',
      name: condition.name,
      seconds,
      urgent: seconds !== null && seconds < 60,
      art: conditionArt(condition),
      emoji: condition.icon,
      target: glade ? { kind: 'map', pos: glade.center } : { kind: 'expand' },
    }
    ;(blight ? striking : timed).push(item)
  }

  const decree = run.decree
  const decreeDef = decree ? DECREES[decree.defId] : undefined
  if (decree && decreeDef) {
    timed.push({
      key: `decree-${decree.id}`,
      kind: 'decree',
      name: decreeDef.name,
      seconds: decree.timeLeft,
      urgent: decree.timeLeft < 60,
      art: 'horn',
      emoji: '📯',
      target: { kind: 'orders' },
    })
  }

  if (run.phase === 'playing') {
    for (const errand of openErrands(run)) {
      const def = ERRANDS[errand.defId]
      errands.push({
        key: `errand-${errand.id}`,
        kind: 'errand',
        name: errand.title,
        seconds: errand.timeLeft,
        urgent: errand.timeLeft < 20,
        art: def?.art,
        emoji: def?.icon ?? '🧺',
        target: { kind: 'orders' },
      })
    }
  }

  const bySeconds = (a: StripItem, b: StripItem) =>
    (a.seconds ?? Number.POSITIVE_INFINITY) - (b.seconds ?? Number.POSITIVE_INFINITY)
  return [...striking.sort(bySeconds), ...timed.sort(bySeconds), ...errands.sort(bySeconds)]
}

/**
 * Wraps the bottom stack's cards: on desktop it renders them as they are; on
 * a phone it shows the strip, and the cards only while it is expanded.
 */
export function HudStrip({ children }: { children: ReactNode }) {
  const narrow = useNarrowScreen()
  if (!narrow) return <>{children}</>
  return <PhoneStrip>{children}</PhoneStrip>
}

function PhoneStrip({ children }: { children: ReactNode }) {
  const run = useHudRun()
  const setPanel = useGameStore((s) => s.setPanel)
  const focusCamera = useGameStore((s) => s.focusCamera)
  const [expanded, setExpanded] = useState(false)
  const items = run ? hudStripItems(run) : []
  const empty = items.length === 0

  // With nothing left to show, the next item starts folded again.
  useEffect(() => {
    if (empty) setExpanded(false)
  }, [empty])
  useEscapeLayer(expanded && !empty, () => setExpanded(false), 'low')

  if (!run || empty) return null
  const top = items[0]
  const more = items.length - 1
  const act = (item: StripItem) => {
    if (item.target.kind === 'map') focusCamera(item.target.pos)
    else if (item.target.kind === 'orders') setPanel('orders')
    else setExpanded(true)
  }

  return (
    <div
      className={`hud-strip ${expanded ? 'is-expanded' : ''}`}
      role="group"
      aria-label="Decrees, conditions and threats"
      data-testid="hud-strip"
    >
      {expanded && (
        <div key="full" id="hud-strip-full" className="hud-strip-full">
          {children}
        </div>
      )}
      <div key="row" className="hud-strip-row">
        {!expanded && (
          <button
            key="top"
            type="button"
            className={`condition-card hud-strip-item is-${top.kind} ${top.urgent ? 'is-urgent' : ''}`}
            onClick={() => act(top)}
            title={TARGET_TITLE[top.target.kind]}
            data-testid="hud-strip-top"
          >
            <span className="condition-icon">
              <Icon id={top.art} emoji={top.emoji} />
            </span>
            <span className="hud-strip-text">
              <small className="hud-strip-kind">
                {STRIP_KIND_LABEL[top.kind]}
                <span className="sr-only">: </span>
              </small>
              <strong className="hud-strip-name">{top.name}</strong>
            </span>
            {top.seconds !== null && (
              <em className="condition-clock">
                <span aria-hidden>⏱ </span>
                <span className="sr-only">{top.kind === 'threat' ? 'strikes in ' : 'time left '}</span>
                {formatClock(top.seconds)}
              </em>
            )}
          </button>
        )}
        <button
          key="toggle"
          type="button"
          className="hud-strip-more"
          aria-expanded={expanded}
          aria-controls={expanded ? 'hud-strip-full' : undefined}
          onClick={() => setExpanded(!expanded)}
          data-testid="hud-strip-more"
        >
          {expanded ? (
            'Show less'
          ) : more > 0 ? (
            <>
              +{more} more<span className="sr-only"> — show all {items.length}</span>
            </>
          ) : (
            <>
              More<span className="sr-only"> about {top.name}</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
