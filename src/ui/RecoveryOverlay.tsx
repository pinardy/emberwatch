import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { downloadSaveFile } from '../game/saveFile'
import { loadSlot } from '../game/saveSlots'
import { useGameStore } from '../game/store'
import './recovery.css'

/**
 * Shown when the game loop or a screen threw. Play and every save have
 * stopped (the run in memory may be half-ticked), so the slot still holds
 * the last good save. The way back: reload that save, take a copy of it as a
 * file, or return to the menu. Lives in the startup chunk, so it works even
 * when the failure was in a screen that loads later.
 */
export function RecoveryOverlay() {
  const crash = useGameStore((s) => s.crash)
  const activeSlot = useGameStore((s) => s.activeSlot)
  const run = useGameStore((s) => s.run)
  const recover = useGameStore((s) => s.recover)
  const first = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDivElement>(null)

  // Read once per crash: the slot does not change while play is stopped.
  const saved = useMemo(
    () => (crash && activeSlot ? loadSlot(activeSlot) : null),
    [crash, activeSlot],
  )

  useEffect(() => {
    if (crash) first.current?.focus()
  }, [crash])

  if (!crash) return null

  const exportable = saved ?? run

  // Keep Tab inside the dialog, like the game's other dialogs.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !dialog.current) return
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>('button, summary'))
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at + 1) % items.length
    e.preventDefault()
    items[next].focus()
  }

  return (
    <div className="overlay recovery-overlay" onKeyDown={onKeyDown}>
      <div
        ref={dialog}
        className="modal recovery-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="recovery-title"
        aria-describedby="recovery-text"
      >
        <h2 id="recovery-title">Something went wrong</h2>
        <p id="recovery-text">
          The game hit an error and stopped.{' '}
          {run
            ? 'Saving stopped with it, so the last good save of this settlement is kept as it was.'
            : 'Nothing was saved over.'}
        </p>
        <details className="recovery-details">
          <summary>Error details</summary>
          <code>{crash}</code>
        </details>
        <div className="recovery-actions">
          {saved ? (
            <button ref={first} type="button" className="primary" onClick={() => recover('reload')}>
              Reload the last save
            </button>
          ) : null}
          {exportable ? (
            <button
              ref={saved ? undefined : first}
              type="button"
              onClick={() => downloadSaveFile(exportable)}
            >
              {saved ? 'Export the last save' : 'Export the run as it is'}
            </button>
          ) : null}
          <button
            ref={exportable ? undefined : first}
            type="button"
            onClick={() => recover('menu')}
          >
            Back to the menu
          </button>
        </div>
        <p className="recovery-hint muted">
          If it happens again, reloading the page starts the game afresh; your saves stay where they are.
        </p>
      </div>
    </div>
  )
}
