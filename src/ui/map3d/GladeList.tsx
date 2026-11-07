import { memo, useId, useRef, useState } from 'react'
import { gladeStakesOf } from '../../game/engine/events'
import { useGameStore } from '../../game/store'
import type { Glade, RunState } from '../../game/types'
import {
  GLADE_KIND_STYLE,
  GLADE_STAKE_STYLE,
  gladeAccess,
  gladeLook,
  gladeProgress,
  type GladeAccess,
} from '../mapShared'
import { gladePlateKey, useRunKey } from './layerKeys'

/** "reachable", "2 clearing, 40%", "out of reach": the plate's status in words. */
export function gladeAccessWords(access: GladeAccess, pct: number, clearers: number): string {
  const percent = Math.floor(pct * 100)
  if (access === 'clearing') return `${clearers} clearing, ${percent}%`
  if (access === 'reachable') return percent > 0 ? `reachable, ${percent}% cleared` : 'reachable'
  return 'out of reach'
}

const ACCESS_ORDER: Record<GladeAccess, number> = { clearing: 0, reachable: 1, locked: 2 }

/** Picks the glade as its plate would: the Inspector opens and the camera glides there. */
function chooseGlade(glade: Glade): void {
  const store = useGameStore.getState()
  store.focusCamera(glade.center)
  store.selectGlade(glade.id)
}

/**
 * The 3D map's glade plates for the keyboard. The plates are painted into a
 * canvas, so they cannot take focus; this list stands in for them. It is one
 * Tab stop, hidden until it has focus, then shown as a small panel: arrow
 * keys (or Home / End) move through the glades and Enter picks one, exactly
 * as clicking its plate does.
 */
export const GladeList = memo(function GladeList({ run }: { run: RunState }) {
  useRunKey(gladePlateKey)
  const selected = useGameStore((s) => s.selectedGlade)
  const [active, setActive] = useState(0)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const hintId = useId()
  // Glades a crew is clearing first, then those in reach, then the rest.
  const glades = Object.values(run.glades)
    .filter((g) => gladeLook(g) === 'fogged')
    .map((glade) => ({ glade, access: gladeAccess(run, glade) }))
    .sort((a, b) => ACCESS_ORDER[a.access] - ACCESS_ORDER[b.access])
  if (glades.length === 0) return null
  const current = Math.min(active, glades.length - 1)

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const last = glades.length - 1
    const step: Record<string, number> = {
      ArrowDown: Math.min(last, current + 1),
      ArrowRight: Math.min(last, current + 1),
      ArrowUp: Math.max(0, current - 1),
      ArrowLeft: Math.max(0, current - 1),
      Home: 0,
      End: last,
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      chooseGlade(glades[current].glade)
      return
    }
    if (!(e.key in step)) return
    // The arrows move through the list, not the camera.
    e.preventDefault()
    e.stopPropagation()
    setActive(step[e.key])
    buttons.current[step[e.key]]?.focus()
  }

  return (
    <nav className="glade-list" aria-label="Glades" aria-describedby={hintId}>
      <p id={hintId} className="glade-list-hint">
        Glades: ↑ ↓ to move, Enter to pick
      </p>
      <ul onKeyDown={onKeyDown}>
        {glades.map(({ glade, access }, i) => {
          const style = GLADE_KIND_STYLE[glade.kind]
          const stakes = gladeStakesOf(glade)
          const could = stakes.map((k) => GLADE_STAKE_STYLE[k].label.toLowerCase()).join(', ')
          return (
            <li key={glade.id}>
              <button
                ref={(el) => {
                  buttons.current[i] = el
                }}
                type="button"
                tabIndex={i === current ? 0 : -1}
                aria-current={selected === glade.id ? 'true' : undefined}
                onFocus={() => setActive(i)}
                onClick={() => chooseGlade(glade)}
              >
                <strong>{glade.name}</strong>
                <small>
                  {style.label} · {gladeAccessWords(access, gladeProgress(glade), glade.clearers)}
                  {could ? ` · could bring ${could}` : ''}
                </small>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
})
