import { useId, useMemo, useState } from 'react'
import { useFrameDerived, useHudRun } from '../game/store'
import { IconText } from './IconText'

/** Most warnings the strip shows at once; the rest wait their turn. */
export const MAX_WARNINGS = 4

/**
 * Persistent nudges for the things that quietly ruin a settlement.
 *
 * Desktop shows every warning in full. Phones show the most urgent one in full
 * (its advice included) and fold the rest behind a "+N more" toggle, so the
 * strip never swamps the map; folded warnings stay in the live region for
 * screen readers.
 */
export function Warnings() {
  const run = useHudRun()
  const frame = useFrameDerived()
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
  if (!run) return null
  const folded = warnings.length - 1
  const open = expanded && folded > 0
  return (
    <div className={`warnings ${open ? 'is-expanded' : ''}`}>
      {/* The live region stays mounted even when empty so new warnings are announced. */}
      <div id={listId} className="warnings-list" role="status" aria-live="polite">
        {warnings.map((warning) => (
          <div key={warning.id} className={`warning is-${warning.severity}`}>
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
          aria-label={open ? 'Show only the most urgent warning' : `Show all ${warnings.length} warnings`}
          onClick={() => setExpanded(!open)}
        >
          {open ? 'Less ▴' : `+${folded} more ▾`}
        </button>
      )}
    </div>
  )
}
