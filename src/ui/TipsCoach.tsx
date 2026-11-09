import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { useGameStore, useHudRun, useHudVersion } from '../game/store'
import type { RunState } from '../game/types'
import { FirstSteps, useFirstStepsOpen } from './FirstSteps'
import { currentDialogTip, nextCornerTip, tipById, tipCopy, type Tip } from './tips'
import { useEscapeLayer } from './useGameLoop'
import { useNarrowScreen } from './useNarrowScreen'
import { usePhoneSheet } from './phoneSheet'

/**
 * Contextual first-time tips. Each fires once, when its condition first holds,
 * and stays until dismissed. Seen ids persist in localStorage so veterans are
 * never nagged twice. The tips themselves are data, in `tips.ts`.
 */

const TIPS_KEY = 'emberwatch.tips.v1'

function loadSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(TIPS_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function saveSeen(seen: string[]): void {
  try {
    localStorage.setItem(TIPS_KEY, JSON.stringify(seen))
  } catch {
    /* private mode — tips just repeat */
  }
}

/** Seen tip ids, shared by the corner coach and tips shown inside dialogs. */
export const useSeenTips = create<{ seen: string[]; markSeen: (id: string) => void }>((set, get) => ({
  seen: loadSeen(),
  markSeen: (id) => {
    if (get().seen.includes(id)) return
    const seen = [...get().seen, id]
    saveSeen(seen)
    set({ seen })
  },
}))

/** True while a blocking dialog (a draft, an event, the run's end) covers the game. */
function dialogOpen(run: RunState): boolean {
  return run.phase !== 'playing' || run.pendingChoices.length > 0
}

/**
 * The corner coach. It never shows while a dialog is up — it would sit under
 * the overlay where it cannot be read or dismissed — so tips that belong to a
 * dialog render inside it through `DialogTip` instead.
 *
 * It also owns the slot for the First steps checklist: while the checklist is
 * open only urgent tips interrupt it, and the welcome tip is folded into it.
 *
 * On a phone the card would cover much of the map, so the tip is shown at the
 * top of the open panel sheet instead, or, while the sheet is folded, as a
 * slim one-line bar over the map's bottom edge that opens the sheet.
 */
export function TipsCoach() {
  const run = useHudRun()
  const seen = useSeenTips((s) => s.seen)
  const markSeen = useSeenTips((s) => s.markSeen)
  const [active, setActive] = useState<Tip | null>(null)
  const blocked = run ? dialogOpen(run) : true
  const checklist = useFirstStepsOpen(run)
  // The run is mutated in place; the HUD clock is what says it moved on.
  const version = useHudVersion()

  useEffect(() => {
    if (!run || blocked) return
    // A tip whose job is done goes away by itself.
    if (active?.doneWhen?.(run)) {
      markSeen(active.id)
      setActive(null)
      return
    }
    if (active) return
    const next = nextCornerTip(run, seen, checklist)
    if (next) setActive(next)
  }, [run, version, seen, active, blocked, checklist, markSeen])

  // The checklist opens with the welcome, so it need not be said twice.
  const showChecklist = checklist && !active && !blocked
  useEffect(() => {
    if (showChecklist) markSeen('welcome')
  }, [showChecklist, markSeen])

  const dismiss = () => {
    if (active) markSeen(active.id)
    setActive(null)
  }
  useEscapeLayer(active !== null && !blocked, dismiss, 'low')
  const narrow = useNarrowScreen()
  const panel = useGameStore((s) => s.panel)
  const setPanel = useGameStore((s) => s.setPanel)
  const sheetSlot = usePhoneSheet((s) => s.tipSlot)

  if (!run || blocked) return null
  if (showChecklist) return <FirstSteps run={run} />
  if (!active) return null

  if (narrow) {
    if (panel !== null && sheetSlot) {
      return createPortal(
        <div className="tip-coach is-sheet" role="status" aria-label="Tip">
          <TipBody tip={active} run={run} onDismiss={dismiss} />
        </div>,
        sheetSlot,
      )
    }
    return (
      <div className="tip-coach is-bar" role="status" aria-label="Tip">
        <button
          type="button"
          className="tip-bar-open"
          onClick={() => setPanel('build')}
          title="Read the tip in the panel"
        >
          <span aria-hidden>💡 </span>
          <span className="tip-bar-title">{tipCopy(active.title, run)}</span>
          <span className="sr-only"> — read the tip</span>
        </button>
        <button type="button" className="tip-bar-dismiss" onClick={dismiss} title="Dismiss tip (Esc)">
          Got it
        </button>
      </div>
    )
  }

  return (
    <div className="tip-coach" role="status" aria-label="Tip">
      <TipBody tip={active} run={run} onDismiss={dismiss} />
    </div>
  )
}

/**
 * A tip shown inside a dialog, e.g. the first blueprint draft. Only one
 * dialog tip shows at a time (`currentDialogTip`): where a dialog holds the
 * place of two, the second waits until the first is dismissed or done.
 */
export function DialogTip({ id }: { id: string }) {
  const run = useHudRun()
  const seen = useSeenTips((s) => s.seen)
  const markSeen = useSeenTips((s) => s.markSeen)
  const tip = tipById(id)
  const visible = !!run && !!tip && currentDialogTip(run, seen)?.id === id
  // Once shown in a dialog it has done its job, even if the player picked
  // without pressing "Got it" — do not repeat it at the next draft. Only
  // count it once the dialog has really moved on: StrictMode's rehearsal
  // unmount happens while the draft is still open.
  useEffect(() => {
    if (!visible || !tip) return
    return () => {
      const now = useGameStore.getState().run
      if (!now || !tip.when(now)) markSeen(id)
    }
  }, [visible, id, tip, markSeen])
  if (!visible || !tip || !run) return null
  return (
    <div className="tip-coach is-inline" role="note" aria-label="Tip">
      <TipBody tip={tip} run={run} onDismiss={() => markSeen(tip.id)} />
    </div>
  )
}

function TipBody({ tip, run, onDismiss }: { tip: Tip; run: RunState; onDismiss: () => void }) {
  return (
    <>
      <div className="tip-body">
        <strong>
          <span aria-hidden>💡 </span>
          {tipCopy(tip.title, run)}
        </strong>
        <p>{tipCopy(tip.text, run)}</p>
      </div>
      <button type="button" onClick={onDismiss} title="Dismiss tip (Esc)">
        Got it
      </button>
    </>
  )
}
