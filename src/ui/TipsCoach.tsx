import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { idleVillagers } from '../game/engine/queries'
import { useGameStore, useRun } from '../game/store'
import type { RunState } from '../game/types'
import { FirstSteps, useFirstStepsOpen } from './FirstSteps'
import { useEscapeLayer } from './useGameLoop'

/**
 * Contextual first-time tips. Each fires once, when its condition first holds,
 * and stays until dismissed. Seen ids persist in localStorage so veterans are
 * never nagged twice.
 */
interface Tip {
  id: string
  title: string
  text: string
  when: (run: RunState) => boolean
  /** Shown inside a dialog (via `DialogTip`) rather than in the corner. */
  inDialog?: boolean
  /**
   * Once this holds the tip has done its job: it is put away (and counted as
   * seen) without waiting for "Got it", or skipped if it never showed.
   */
  doneWhen?: (run: RunState) => boolean
  /**
   * Urgent tips may interrupt the First steps checklist; the rest wait until
   * it is finished or dismissed, so the two never fight for the corner.
   */
  urgent?: boolean
}

/** The player has done something on purpose: placed a building or put someone to work. */
function hasActed(run: RunState): boolean {
  return (
    Object.values(run.buildings).some((b) => b.defId !== 'ancientHearth') ||
    Object.values(run.villagers).some((v) => v.assignment !== null)
  )
}

const TIPS: Tip[] = [
  {
    id: 'welcome',
    title: 'Welcome, Viceroy',
    text: 'Fill the 👑 Reputation meter to win before the Queen’s ⏳ Impatience fills and she recalls you. Resolve above each species’ threshold is what earns reputation.',
    // The run opens on the blueprint draft; welcome the player once it closes.
    // While the First steps checklist is up, it carries this welcome instead.
    when: (run) => run.clock < 30 && run.pendingChoices.length === 0,
    doneWhen: hasActed,
  },
  {
    id: 'first-draft',
    title: 'Drafting a blueprint',
    text: 'You can never unlock everything — pick buildings that satisfy the services your species actually want. The draft can be rerolled for amber.',
    when: (run) => run.pendingChoices[0]?.kind === 'blueprint',
    inDialog: true,
  },
  {
    id: 'idle-builders',
    title: 'Idle hands build',
    text: 'Idle villagers are your construction crew and your glade clearers. The 💤 count in the top bar is your build speed.',
    when: (run) => run.clock > 45 && idleVillagers(run).length >= 3,
  },
  {
    id: 'first-glade',
    title: 'Push into the forest',
    text: 'Select a fogged glade next to your territory and assign clearers. Dangerous and forbidden glades hide richer loot — and a decision.',
    when: (run) => run.clock > 90 && run.stats.gladesCleared === 0,
  },
  {
    id: 'first-storm',
    title: 'The Blightstorm',
    text: 'Farms stop, gathering halves, and the hearth burns wood fast. Stockpile food and fuel during Clearance, and keep homes near the hearth’s warmth — or raise a brazier beside distant ones.',
    when: (run) => run.season.season === 'storm' && run.season.year === 1,
    urgent: true,
  },
  {
    id: 'low-resolve',
    title: 'Somebody is miserable',
    text: 'A species below zero resolve will start leaving, and each departure feeds the Queen’s impatience. Check housing, food variety, and their service needs.',
    when: (run) => Object.values(run.resolve).some((r) => r < 0),
    urgent: true,
  },
  {
    id: 'first-threat',
    title: 'A threat is loose',
    text: 'It will strike again and again until you pay it off from the red banner. Weigh the appeasement cost against what each strike is costing you.',
    when: (run) => run.threats.length > 0,
    urgent: true,
  },
  {
    id: 'first-caravan',
    title: 'A caravan is in town',
    text: 'It leaves soon. Check the Trade tab — it pays double for one good this visit, and its stock rotates every caravan.',
    when: (run) => run.caravan.here,
  },
]

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
 */
export function TipsCoach() {
  const run = useRun()
  const seen = useSeenTips((s) => s.seen)
  const markSeen = useSeenTips((s) => s.markSeen)
  const [active, setActive] = useState<Tip | null>(null)
  const blocked = run ? dialogOpen(run) : true
  const checklist = useFirstStepsOpen(run)
  // The run is mutated in place; the version is what says it moved on.
  const version = useGameStore((s) => s.version)

  useEffect(() => {
    if (!run || blocked) return
    // A tip whose job is done goes away by itself.
    if (active?.doneWhen?.(run)) {
      markSeen(active.id)
      setActive(null)
      return
    }
    if (active) return
    const next = TIPS.find(
      (tip) =>
        !tip.inDialog &&
        !seen.includes(tip.id) &&
        (!checklist || tip.urgent) &&
        tip.when(run) &&
        !tip.doneWhen?.(run),
    )
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

  if (!run || blocked) return null
  if (showChecklist) return <FirstSteps run={run} />
  if (!active) return null

  return (
    <div className="tip-coach" role="status" aria-label="Tip">
      <TipBody tip={active} onDismiss={dismiss} />
    </div>
  )
}

/** A tip shown inside a dialog, e.g. the first blueprint draft. */
export function DialogTip({ id }: { id: string }) {
  const run = useRun()
  const seen = useSeenTips((s) => s.seen)
  const markSeen = useSeenTips((s) => s.markSeen)
  const tip = TIPS.find((t) => t.id === id)
  const visible = !!run && !!tip && !seen.includes(tip.id) && tip.when(run)
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
  if (!visible || !tip) return null
  return (
    <div className="tip-coach is-inline" role="note" aria-label="Tip">
      <TipBody tip={tip} onDismiss={() => markSeen(tip.id)} />
    </div>
  )
}

function TipBody({ tip, onDismiss }: { tip: Tip; onDismiss: () => void }) {
  return (
    <>
      <div className="tip-body">
        <strong>
          <span aria-hidden>💡 </span>
          {tip.title}
        </strong>
        <p>{tip.text}</p>
      </div>
      <button type="button" onClick={onDismiss} title="Dismiss tip (Esc)">
        Got it
      </button>
    </>
  )
}
