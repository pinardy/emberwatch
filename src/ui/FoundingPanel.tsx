import { useLayoutEffect, useRef } from 'react'
import { BLUEPRINT_POOL, BUILDINGS, STARTING_BLUEPRINTS } from '../game/content/buildings'
import { CORNERSTONES } from '../game/content/cornerstones'
import { ORDERS } from '../game/content/orders'
import { SPECIES } from '../game/content/species'
import { foundingPart, foundingPicks, type FoundingPart, type FoundingPick } from '../game/engine/founding'
import { describeOrder } from '../game/engine/orders'
import { useGameStore, useHudRun } from '../game/store'
import type { RunState } from '../game/types'
import { CornerstoneOption, DraftOption, RerollButton } from './ChoiceModal'
import { Icon } from './Icon'
import { OrderOption } from './QueenChoice'
import { RunModifierList } from './RunModifierList'
import { ReputationProfileLine } from './EnvoyStatus'
import { runReputationProfile } from '../game/engine/reputation'
import { DialogTip } from './TipsCoach'
import { cornerstoneArt } from '../game/content/artFamilies'
import './founding.css'

const PART_TITLE: Record<FoundingPart, string> = {
  blueprint: 'Blueprints',
  cornerstone: 'Cornerstone',
  writ: 'The founding writ',
}

const PART_HINT: Record<FoundingPart, string> = {
  blueprint: 'Buildings this settlement can raise beyond the basics.',
  cornerstone: 'A run-long perk, laid for good.',
  writ: 'Your first charge from the Crown: one small Year-1 goal, worth your first reputation.',
}

const PARTS: FoundingPart[] = ['blueprint', 'cornerstone', 'writ']

/**
 * The founding: every pick the run opens on — its blueprint drafts, the
 * founding cornerstone and the founding writ — in one panel that stands in
 * the side rail (a bottom sheet on phones) beside the visible map, with the
 * land's modifiers and the settlers on show. Picks are made in any order;
 * the clock waits until the last one. It is not a modal: the map can be
 * panned and inspected meanwhile, and Tab moves freely in and out.
 */
export function FoundingPanel() {
  const run = useHudRun()
  const chooseOption = useGameStore((s) => s.chooseOption)
  const rootRef = useRef<HTMLElement>(null)
  /** The part last picked from, so focus can follow the player's place. */
  const lastPart = useRef<FoundingPart | null>(null)
  const picks = run ? foundingPicks(run) : []
  const left = picks.length

  // On open, focus lands on the panel (its heading names it); after each
  // pick, on the first card still open — the same part's next draft if it has
  // one, else the next part with a pick to make.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const part = lastPart.current
    if (part === null) {
      if (!root.contains(document.activeElement)) root.focus({ preventScroll: true })
      return
    }
    const target =
      root.querySelector<HTMLElement>(`[data-part="${part}"] button.option`) ??
      root.querySelector<HTMLElement>('button.option')
    target?.focus()
    target?.closest('section')?.scrollIntoView?.({ block: 'nearest' })
  }, [left])

  if (!run || left === 0) return null

  const pick = (p: FoundingPick, part: FoundingPart, optionId: string) => {
    lastPart.current = part
    chooseOption(optionId, p.index)
  }

  return (
    <section
      ref={rootRef}
      className="founding"
      aria-labelledby="founding-title"
      tabIndex={-1}
      data-testid="founding"
    >
      <header className="founding-head">
        <span className="modal-icon" aria-hidden>
          <Icon id="setSquare" emoji="📐" />
        </span>
        <div>
          <h2 id="founding-title">The Founding</h2>
          <small>
            Make the opening picks in any order — look the land over while you do. The clock
            starts once all are made.
          </small>
        </div>
      </header>
      <DialogTip id="founding" />
      <div className="founding-land">
        {(run.runModifiers ?? []).length > 0 ? (
          <div className="land-strip">
            <span>This land:</span>
            <RunModifierList ids={run.runModifiers} compact />
          </div>
        ) : (
          <p className="muted">This land has no particular character.</p>
        )}
        <ReputationProfileLine profile={runReputationProfile(run)} className="rep-profile-strip" />
        <p className="founding-settlers">
          <span>Settlers:</span>
          {run.speciesPool.map((sp) => (
            <span key={sp} className="founding-species">
              <Icon id={SPECIES[sp].art} emoji={SPECIES[sp].icon} /> {SPECIES[sp].name}
            </span>
          ))}
        </p>
      </div>
      <FoundingSteps run={run} picks={picks} />
      {PARTS.map((part, n) => (
        <FoundingStep
          key={part}
          run={run}
          part={part}
          step={n + 1}
          picks={picks.filter((p) => foundingPart(p.choice) === part)}
          onPick={(p, optionId) => pick(p, part, optionId)}
        />
      ))}
      <p className="founding-foot" role="status">
        {left} pick{left === 1 ? '' : 's'} left — the clock starts when they are made.
      </p>
    </section>
  )
}

/**
 * The founding at a glance: each part, how many picks it still holds, and a
 * button that takes focus straight to it (the parts below fold out of view
 * on a phone).
 */
function FoundingSteps({ run, picks }: { run: RunState; picks: FoundingPick[] }) {
  const jump = (part: FoundingPart) => {
    const section = document.querySelector<HTMLElement>(`.founding [data-part="${part}"]`)
    section?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    section?.querySelector<HTMLElement>('button.option')?.focus({ preventScroll: true })
  }
  return (
    <ol className="founding-steps" aria-label="Founding picks">
      {PARTS.map((part, n) => {
        const open = picks.filter((p) => foundingPart(p.choice) === part).length
        if (open === 0 && madeSoFar(run, part).length === 0) return null
        return (
          <li key={part}>
            <button
              type="button"
              className={open === 0 ? 'is-done' : ''}
              disabled={open === 0}
              onClick={() => jump(part)}
            >
              <span aria-hidden>{open === 0 ? '✓' : n + 1}</span> {PART_TITLE[part]}
              {open > 1 ? ` ×${open}` : ''}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function FoundingStep({
  run,
  part,
  step,
  picks,
  onPick,
}: {
  run: RunState
  part: FoundingPart
  step: number
  picks: FoundingPick[]
  onPick: (pick: FoundingPick, optionId: string) => void
}) {
  const current = picks[0]
  const done = !current
  const headingId = `founding-${part}`
  const made = madeSoFar(run, part)
  // A part with nothing dealt and nothing made (no writ to offer) is not shown.
  if (done && made.length === 0) return null
  return (
    <section
      className={`founding-step ${done ? 'is-done' : 'is-open'}`}
      aria-labelledby={headingId}
      data-part={part}
    >
      <div className="founding-step-head">
        <h3 id={headingId}>
          <span className="founding-step-n" aria-hidden>
            {done ? '✓' : step}
          </span>{' '}
          {PART_TITLE[part]}
        </h3>
        <span className="founding-status">
          {done ? 'Done' : picks.length === 1 ? '1 pick' : `${picks.length} picks`}
        </span>
      </div>
      {made.length > 0 && (
        <ul className="founding-made" aria-label={`${PART_TITLE[part]} chosen`}>
          {made.map((m) => (
            <li key={m.id}>
              {m.icon} {m.name}
            </li>
          ))}
        </ul>
      )}
      {current && (
        <>
          <small className="founding-hint">{PART_HINT[part]}</small>
          {part === 'blueprint' && <DialogTip id="first-draft" />}
          <div className="option-list">
            {part === 'blueprint' &&
              current.choice.options.map((id) => (
                <DraftOption key={id} run={run} id={id} onPick={() => onPick(current, id)} />
              ))}
            {part === 'cornerstone' &&
              current.choice.options.map((id) => {
                const def = CORNERSTONES[id]
                return def ? <CornerstoneOption key={id} def={def} onPick={() => onPick(current, id)} /> : null
              })}
            {part === 'writ' &&
              (current.choice.orders ?? []).map((order) => (
                <OrderOption key={order.id} run={run} order={order} onPick={() => onPick(current, order.id)} />
              ))}
          </div>
          {part !== 'writ' && <RerollButton index={current.index} />}
        </>
      )}
    </section>
  )
}

interface Made {
  id: string
  name: string
  icon: React.ReactNode
}

/** What this part of the founding already holds, read from the run itself. */
function madeSoFar(run: RunState, part: FoundingPart): Made[] {
  if (part === 'blueprint') {
    return run.unlockedBuildings
      .filter((id) => BLUEPRINT_POOL.includes(id) && !STARTING_BLUEPRINTS.includes(id))
      .map((id) => ({ id, name: BUILDINGS[id]?.name ?? id, icon: <Icon of={BUILDINGS[id]} /> }))
  }
  if (part === 'cornerstone') {
    return run.cornerstones.map((id) => {
      const def = CORNERSTONES[id]
      return { id, name: def?.name ?? id, icon: def ? <Icon id={cornerstoneArt(def)} emoji={def.icon} /> : null }
    })
  }
  return run.orders
    .filter((o) => o.writ)
    .map((o) => ({
      id: o.id,
      name: `${ORDERS[o.defId]?.name ?? o.defId} — ${describeOrder(o)}`,
      icon: <Icon id="scroll" emoji="📜" />,
    }))
}
