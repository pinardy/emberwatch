import { useEffect, useState, type ReactNode } from 'react'
import './panel-intro.css'

/** Where the panels whose intro the player has already read are remembered. */
export const INTROS_SEEN_KEY = 'emberwatch.introsSeen.v1'

/** The panel ids whose intro has been shown; empty when storage is unreadable. */
export function readIntrosSeen(): string[] {
  try {
    const raw = localStorage.getItem(INTROS_SEEN_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function markIntroSeen(id: string): void {
  try {
    const seen = readIntrosSeen()
    if (seen.includes(id)) return
    localStorage.setItem(INTROS_SEEN_KEY, JSON.stringify([...seen, id]))
  } catch {
    // Private mode or full storage: the intro simply opens again next time.
  }
}

/**
 * A panel's explanatory paragraph. The first time a panel is shown in this
 * browser it opens; after that it folds to a small "About this panel"
 * disclosure, so the text is one click (or Enter) away and screen readers
 * still find it, without leading the panel every time.
 */
export function PanelIntro({ id, children }: { id: string; children: ReactNode }) {
  // Read once, so the panel the player is reading does not fold under them.
  const [firstTime] = useState(() => !readIntrosSeen().includes(id))
  useEffect(() => {
    if (firstTime) markIntroSeen(id)
  }, [firstTime, id])
  return (
    <details className="panel-intro" open={firstTime} data-intro={id}>
      <summary>
        <span className="panel-intro-mark" aria-hidden>
          ?
        </span>
        About this panel
      </summary>
      <p className="panel-hint">{children}</p>
    </details>
  )
}
