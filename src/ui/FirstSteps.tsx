import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { BUILDINGS } from '../game/content/buildings'
import {
  firstSteps,
  firstStepsComplete,
  firstStepTarget,
  type FirstStep,
} from '../game/engine/onboarding'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import './first-steps.css'
import { Icon } from './Icon'

/**
 * The "First steps" checklist: a small card that walks a new player through
 * the moves that carry a settlement through its first Storm. Each step ticks
 * itself off from the run (see `engine/onboarding.ts`) and clicking one takes
 * the player to it. Once finished or dismissed it never returns — the choice
 * is remembered in localStorage, like the tips coach's seen tips.
 *
 * It shares the tips coach's slot in the HUD stack: `TipsCoach` decides which
 * of the two shows, so they never stack on top of each other.
 */

const STEPS_KEY = 'emberwatch.firstSteps.v1'
type StepsStatus = 'open' | 'done' | 'dismissed'

function loadStatus(): StepsStatus {
  try {
    const value = localStorage.getItem(STEPS_KEY)
    return value === 'done' || value === 'dismissed' ? value : 'open'
  } catch {
    return 'open'
  }
}

export const useFirstStepsStatus = create<{
  status: StepsStatus
  close: (status: Exclude<StepsStatus, 'open'>) => void
}>((set) => ({
  status: loadStatus(),
  close: (status) => {
    try {
      localStorage.setItem(STEPS_KEY, status)
    } catch {
      /* private mode — the checklist just returns next run */
    }
    set({ status })
  },
}))

/**
 * Whether the checklist still has something to say in this run. Call it from
 * a component that stays mounted (the tips coach): it also records the
 * checklist as done the moment the last required step ticks, and says so once.
 */
export function useFirstStepsOpen(run: RunState | null): boolean {
  const status = useFirstStepsStatus((s) => s.status)
  const close = useFirstStepsStatus((s) => s.close)
  const complete = !!run && firstStepsComplete(run)
  const open = !!run && status === 'open' && !complete
  // Only celebrate a checklist the player actually watched fill up.
  const seenOpen = useRef(false)
  if (open) seenOpen.current = true

  useEffect(() => {
    if (status !== 'open' || !complete) return
    close('done')
    if (seenOpen.current) {
      useGameStore.setState({
        notice: '✅ First steps done — now keep food and wood ahead of the Storm.',
      })
    }
  }, [status, complete, close])

  return open
}

export function FirstSteps({ run }: { run: RunState }) {
  const close = useFirstStepsStatus((s) => s.close)
  const setPanel = useGameStore((s) => s.setPanel)
  const setBuildMode = useGameStore((s) => s.setBuildMode)
  const selectBuilding = useGameStore((s) => s.selectBuilding)
  const selectGlade = useGameStore((s) => s.selectGlade)
  const focusCamera = useGameStore((s) => s.focusCamera)
  // While placing a building the map needs the room: keep to the next step.
  const compact = useGameStore((s) => s.buildMode !== null)

  const steps = firstSteps(run)
  const required = steps.filter((step) => !step.optional)
  const doneCount = required.filter((step) => step.done).length
  const next = steps.find((step) => !step.done)
  const started = steps.some((step) => step.done)

  const go = (step: FirstStep) => {
    const target = firstStepTarget(run, step.id)
    if (!target || target.kind === 'build') {
      setPanel('build')
      setBuildMode(target?.kind === 'build' ? target.defId : 'foragersCamp')
      return
    }
    if (target.kind === 'building') {
      const building = run.buildings[target.buildingId]
      selectBuilding(target.buildingId)
      if (building) focusCamera(building.pos)
      return
    }
    const glade = run.glades[target.gladeId]
    selectGlade(target.gladeId)
    if (glade) focusCamera(glade.center)
  }

  return (
    <section
      className={`tip-coach first-steps ${compact ? 'is-compact' : ''}`}
      aria-label="First steps"
    >
      <header className="first-steps-head">
        <strong>
          <span aria-hidden>
            <Icon id="compass" emoji="🧭" />{' '}
          </span>
          First steps{' '}
          <span className="first-steps-count">
            {doneCount}/{required.length}
          </span>
        </strong>
        <button
          type="button"
          className="first-steps-close"
          onClick={() => close('dismissed')}
          title="Hide the checklist for good"
          aria-label="Dismiss first steps"
        >
          ✕
        </button>
      </header>
      {!started && !compact && (
        <p className="first-steps-goal">
          <span className="first-steps-hello">Welcome, Viceroy. </span>
          Fill the Reputation meter to win before the Queen’s Impatience runs out.
          <span className="first-steps-hello"> First, get through the Storm:</span>
        </p>
      )}
      <ol className="first-steps-list">
        {(compact ? steps.filter((step) => step === next) : steps).map((step) => (
          <li
            key={step.id}
            className={`${step.done ? 'is-done' : ''} ${step === next ? 'is-next' : ''}`}
          >
            <button
              type="button"
              disabled={step.done}
              onClick={() => go(step)}
              title={step.done ? undefined : `${step.why} ${hintFor(run, step)}`}
            >
              <span className="first-steps-box" aria-hidden>
                {step.done ? '✓' : ''}
              </span>
              <span className="first-steps-text">
                {step.label}
                {step.optional && <em> (optional)</em>}
                <span className="sr-only">{step.done ? ' — done' : ''}</span>
                {step === next && !compact && <small>{step.why}</small>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** What clicking the step will do, for the hover title. */
function hintFor(run: RunState, step: FirstStep): string {
  const target = firstStepTarget(run, step.id)
  if (!target) return 'Opens the Build panel.'
  if (target.kind === 'build') return `Picks the ${BUILDINGS[target.defId]?.name} to place.`
  if (target.kind === 'building') return 'Shows the camp so you can add workers.'
  return 'Shows a glade you can send a crew to.'
}
