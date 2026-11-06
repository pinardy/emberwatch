import { useId, useMemo, useState } from 'react'
import { useFrameDerived } from '../game/frameDerived'
import { IconText } from './IconText'

/** Most warnings the strip holds at once; the rest wait their turn. */
export const MAX_WARNINGS = 4

/** Warnings shown in full before the rest fold behind "+N more". */
export const VISIBLE_WARNINGS = 2

/**
 * Persistent nudges for the things that quietly ruin a settlement.
 *
 * The strip shows the two most urgent warnings (dangers first, advice and
 * all) and folds the rest behind a "+N more" toggle on every screen, so it
 * never swamps the map; folded warnings stay in the live region for screen
 * readers.
 */
export function Warnings() {
  const frame = useFrameDerived() // null without a run
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  // Diagnostics walk every building: computed once per sim step and shared.
  const warnings = useMemo(() => {
    if (!frame) return []
    const all = frame.warnings
    // Dangers first, so the cap below never hides the worst news.
    return [
      ...all.filter((w) => w.severity === 'danger'),
      ...all.filter((w) => w.severity !== 'danger'),
    ].slice(0, MAX_WARNINGS)
  }, [frame])
  if (!frame) return null
  const folded = Math.max(0, warnings.length - VISIBLE_WARNINGS)
  const open = expanded && folded > 0
  return (
    <div className={`warnings ${open ? 'is-expanded' : ''}`}>
      {/* The live region stays mounted even when empty so new warnings are announced. */}
      <div id={listId} className="warnings-list" role="status" aria-live="polite">
        {warnings.map((warning, i) => (
          <div
            key={warning.id}
            className={`warning is-${warning.severity}${
              !open && i >= VISIBLE_WARNINGS ? ' is-folded' : ''
            }`}
          >
            <IconText text={warning.text} />
          </div>
        ))}
      </div>
      {folded > 0 && (
        <button
          type="button"
          className="warnings-toggle"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={
            open ? 'Show only the most urgent warnings' : `Show all ${warnings.length} warnings`
          }
          onClick={() => setExpanded(!open)}
        >
          {open ? 'Less ▴' : `+${folded} more ▾`}
        </button>
      )}
    </div>
  )
}
