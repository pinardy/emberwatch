import { useEffect, useRef, useState } from 'react'
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
import { useNarrowScreen } from './useNarrowScreen'

/**
 * The "First steps" checklist: a small card that walks a new player through
 * the moves that carry a settlement through its first Storm. Each step ticks
 * itself off from the run (see `engine/onboarding.ts`) and clicking one takes
 * the player to it. Once finished or dismissed it never returns — the choice
 * is remembered in localStorage, like the tips coach's seen tips. Once the
 * first Storm has passed (Year 2 begins) it has done its job and retires by
 * itself, even with a step left unticked.
 *
 * On a phone it is a small "First steps 3/4" chip that opens the list on tap,
 * rather than a card over the map.
 *
 * It shares the tips coach's slot in the HUD stack: `TipsCoach` decides which
 * of the two shows, so they never stack on top of each other.
 */

const STEPS_KEY = 'emberwatch.firstSteps.v1'
/** `retired`: put away when the first Storm passed with a step still open. */
type StepsStatus = 'open' | 'done' | 'dismissed' | 'retired'

/** The checklist's stored status; older values (none, "done", "dismissed") read as before. */
export function loadFirstStepsStatus(): StepsStatus {
  try {
    const value = localStorage.getItem(STEPS_KEY)
    return value === 'done' || value === 'dismissed' || value === 'retired' ? value : 'open'
  } catch {
    return 'open'
  }
}

export const useFirstStepsStatus = create<{
  status: StepsStatus
  close: (status: Exclude<StepsStatus, 'open'>) => void
}>((set) => ({
  status: loadFirstStepsStatus(),
  close: (status) => {
    try {
      localStorage.setItem(STEPS_KEY, status)
    } catch {
      /* private mode — the checklist just returns next run */
    }
    set({ status })
  },
}))

/** The checklist is about the first Storm: once it has passed, it retires. */
export function firstStepsRetired(run: RunState): boolean {
  return run.season.year >= 2
}

export const FIRST_STEPS_RETIRED_NOTICE =
  '🧭 First steps put away — the first Storm is behind you. Keep food and wood ahead of the next.'

/**
 * Whether the checklist still has something to say in this run. Call it from
 * a component that stays mounted (the tips coach): it also records the
 * checklist as done the moment the last required step ticks, or as retired
 * once the first Storm has passed, and says so once.
 */
export function useFirstStepsOpen(run: RunState | null): boolean {
  const status = useFirstStepsStatus((s) => s.status)
  const close = useFirstStepsStatus((s) => s.close)
  const complete = !!run && firstStepsComplete(run)
  const retired = !!run && firstStepsRetired(run)
  const open = !!run && status === 'open' && !complete && !retired
  // Only celebrate a checklist the player actually watched fill up.
  const seenOpen = useRef(false)
  if (open) seenOpen.current = true

  useEffect(() => {
    if (status !== 'open') return
    if (complete) {
      close('done')
      if (seenOpen.current) {
        useGameStore.setState({
          notice: '✅ First steps done — now keep food and wood ahead of the Storm.',
        })
      }
    } else if (retired) {
      close('retired')
      useGameStore.setState({ notice: FIRST_STEPS_RETIRED_NOTICE })
    }
  }, [status, complete, retired, close])

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
  // Phones: a chip that opens the list on tap.
  const narrow = useNarrowScreen()
  const [chipOpen, setChipOpen] = useState(false)
  // The chip's button moves into the card's header and back: keep focus on it.
  const sectionRef = useRef<HTMLElement>(null)
  const toggled = useRef(false)
  const toggleChip = (open: boolean) => {
    toggled.current = true
    setChipOpen(open)
  }
  useEffect(() => {
    if (!toggled.current) return
    toggled.current = false
    sectionRef.current?.querySelector<HTMLElement>('.first-steps-chip')?.focus()
  }, [chipOpen])

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

  const title = (
    <>
      <span aria-hidden>
        <Icon id="compass" emoji="🧭" />{' '}
      </span>
      First steps{' '}
      <span className="first-steps-count">
        {doneCount}/{required.length}
      </span>
    </>
  )

  if (narrow && !chipOpen) {
    return (
      <section ref={sectionRef} className="tip-coach first-steps is-chip" aria-label="First steps">
        <button
          key="chip"
          type="button"
          className="first-steps-chip"
          aria-expanded={false}
          onClick={() => toggleChip(true)}
          title="Show the first steps"
        >
          <strong>{title}</strong>
          <span className="first-steps-chevron" aria-hidden>
            ▴
          </span>
        </button>
      </section>
    )
  }

  return (
    <section
      ref={sectionRef}
      className={`tip-coach first-steps ${compact ? 'is-compact' : ''}${narrow ? ' is-chip-open' : ''}`}
      aria-label="First steps"
    >
      <header className="first-steps-head">
        {narrow ? (
          <button
            key="chip"
            type="button"
            className="first-steps-chip"
            aria-expanded
            aria-controls="first-steps-list"
            onClick={() => toggleChip(false)}
            title="Fold the first steps to a chip"
          >
            <strong>{title}</strong>
            <span className="first-steps-chevron" aria-hidden>
              ▾
            </span>
          </button>
        ) : (
          <strong>{title}</strong>
        )}
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
          Fill the Reputation meter before the Queen’s Impatience runs out: that sends her envoy, and you win by holding until she arrives after the next Storm.
          <span className="first-steps-hello"> First, get through the Storm:</span>
        </p>
      )}
      <ol className="first-steps-list" id={narrow ? 'first-steps-list' : undefined}>
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
