import { useEffect, useRef, useState } from 'react'
import { frameDerived } from '../game/frameDerived'
import { subscribeHud, useGameStore, useRunRef } from '../game/store'
import type { LogEntry, RunState } from '../game/types'
import { IconText } from './IconText'

/**
 * A non-blocking stream of what just happened. The sim already narrates every
 * event into `run.log`; this diffs the log by entry id on every HUD tick and
 * shows the new lines in the foreground, so a departure or a threat strike is
 * not buried behind the Log tab. Two conditions the log does not narrate — the
 * hearth going cold and the stockpile filling up — are derived here too.
 */

export type ToastTone = LogEntry['tone']

export interface Toast {
  key: number
  text: string
  tone: ToastTone
  /** Identical lines collapse into one toast with a counter. */
  count: number
  /** `performance.now()` deadline. */
  expires: number
}

export const MAX_VISIBLE_TOASTS = 3
const LIFETIME_MS: Record<ToastTone, number> = { info: 4500, good: 5000, bad: 7500 }

/**
 * True while the run is still in its pre-clock opening (the blueprint draft):
 * those entries are the run's set-up, not news.
 */
function isOpening(run: RunState): boolean {
  return run.clock === 0
}

/**
 * Newest log id the player has "seen" in some sense, tracked per run. The
 * baseline starts at the newest entry when a run appears and keeps moving while
 * the run is still in its opening, so the opening lines never count as new.
 */
function useLogBaseline(run: RunState | null) {
  const ref = useRef<{ run: RunState | null; id: number }>({ run: null, id: -1 })
  if (ref.current.run !== run) {
    ref.current = { run, id: run?.log[0]?.id ?? -1 }
  } else if (run && isOpening(run)) {
    ref.current.id = run.log[0]?.id ?? -1
  }
  return ref
}

/** Log entries the player has not looked at since they last opened the Log. */
export function useLogUnread(run: RunState | null, logOpen: boolean): number {
  const baseline = useLogBaseline(run)
  if (!run) return 0
  if (logOpen) baseline.current.id = run.log[0]?.id ?? -1
  let unread = 0
  for (const entry of run.log) {
    if (entry.id <= baseline.current.id) break
    unread++
  }
  return unread
}

export function EventToasts() {
  const run = useRunRef()
  const [toasts, setToasts] = useState<Toast[]>([])
  const seen = useRef(-1)
  const flags = useRef({ run: null as RunState | null, cold: false, full: false })
  const counter = useRef(0)

  // Diff the log (and two derived conditions) on every HUD tick, from a store
  // subscription: nothing re-renders unless there is news.
  useEffect(() => {
    if (!run) return
    diff(run)
    return subscribeHud(diff)
  }, [run])

  function diff(run: RunState): void {
    const fresh: { text: string; tone: ToastTone }[] = []

    if (flags.current.run !== run) {
      // A new or resumed run: nothing that already happened is news.
      flags.current = { run, cold: run.coldHearth, full: false }
      seen.current = run.log[0]?.id ?? -1
      setToasts([])
      return
    }

    if (isOpening(run)) {
      seen.current = run.log[0]?.id ?? -1
    } else {
      const added: LogEntry[] = []
      for (const entry of run.log) {
        if (entry.id <= seen.current) break
        added.push(entry)
      }
      if (added.length > 0) seen.current = added[0].id
      // The log is newest-first; toast in the order things happened.
      for (const entry of added.reverse()) fresh.push({ text: entry.text, tone: entry.tone })
    }

    if (run.phase === 'playing') {
      if (run.coldHearth && !flags.current.cold) {
        fresh.push({ text: '🔥 The hearth has gone cold. It needs wood.', tone: 'bad' })
      }
      // Shared with the stockpile strip and the sound cues, once per sim step.
      const full =
        frameDerived(run, useGameStore.getState().version).storageBlocked.length > 0
      if (full && !flags.current.full) {
        fresh.push({
          text: '📦 The stockpile is full — producers have stopped.',
          tone: 'bad',
        })
      }
      flags.current.full = full
    }
    flags.current.cold = run.coldHearth

    if (fresh.length === 0) return
    const now = performance.now()
    setToasts((current) => {
      let next = current
      for (const item of fresh) {
        const twin = next.find((t) => t.text === item.text)
        const expires = now + LIFETIME_MS[item.tone]
        if (twin) {
          next = [
            ...next.filter((t) => t !== twin),
            { ...twin, count: twin.count + 1, expires },
          ]
        } else {
          next = [...next, { key: counter.current++, ...item, count: 1, expires }]
        }
      }
      // Older toasts make way; everything stays readable in the Log.
      return next.slice(-MAX_VISIBLE_TOASTS)
    })
  }

  // One timer for whichever toast expires first.
  useEffect(() => {
    if (toasts.length === 0) return
    const soonest = Math.min(...toasts.map((t) => t.expires))
    const timer = window.setTimeout(
      () => {
        const now = performance.now()
        setToasts((current) => current.filter((t) => t.expires > now + 16))
      },
      Math.max(0, soonest - performance.now()),
    )
    return () => window.clearTimeout(timer)
  }, [toasts])

  if (!run || toasts.length === 0) return null

  return (
    <div className="event-toasts" role="log" aria-live="polite" aria-label="Settlement news">
      {toasts.map((toast) => (
        <button
          key={toast.key}
          type="button"
          className={`event-toast is-${toast.tone}`}
          title="Dismiss"
          onClick={() => setToasts((current) => current.filter((t) => t.key !== toast.key))}
        >
          <span className="event-toast-text">
            <IconText text={toast.text} />
          </span>
          {toast.count > 1 && <span className="event-toast-count">×{toast.count}</span>}
        </button>
      ))}
    </div>
  )
}
