import { useRef, useState } from 'react'
import { downloadSaveFile } from '../game/saveFile'
import { useGameStore } from '../game/store'
import { useDismiss } from './useGameLoop'
import './recovery.css'

const SHORT_REASON = {
  quota: 'storage full',
  unavailable: 'storage unavailable',
  conflict: 'open in another tab',
} as const

/**
 * Stays in the top bar for as long as the run is not being saved (full or
 * unavailable storage, as in some private modes, or another tab saving the
 * same settlement), so a player never plays on believing their progress is
 * kept. It opens to the reason and the remedy: export the run to a file, or
 * try again (or, when another tab saved it, save here anyway). It goes away
 * on its own as soon as a save lands.
 */
export function SaveStatusChip() {
  const saveError = useGameStore((s) => s.saveError)
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  useDismiss(open && saveError !== null, host, () => setOpen(false))
  if (!saveError) return null

  const exportRun = () => {
    const run = useGameStore.getState().run
    if (run) downloadSaveFile(run)
  }
  const retry = () => {
    const store = useGameStore.getState()
    if (saveError.reason === 'conflict') store.saveOverConflict()
    else store.saveNow()
  }

  return (
    <div className="topbar-anchor save-chip-anchor" ref={host}>
      <button
        type="button"
        className="save-chip"
        aria-expanded={open}
        aria-controls="save-chip-detail"
        title={saveError.message}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden>⚠</span>
        <span>Not saving</span>{' '}
        <span className="save-chip-reason">— {SHORT_REASON[saveError.reason]}</span>
      </button>
      {open && (
        <div
          id="save-chip-detail"
          className="topbar-popover save-chip-popover"
          role="group"
          aria-label="Saving"
        >
          <p>{saveError.message}</p>
          <div className="save-chip-actions">
            <button type="button" className="primary" onClick={exportRun}>
              Export this run
            </button>
            <button type="button" onClick={retry}>
              {saveError.reason === 'conflict' ? 'Save here anyway' : 'Try again'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
