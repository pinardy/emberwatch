import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { BUILDINGS } from '../game/content/buildings'
import { CORNERSTONES } from '../game/content/cornerstones'
import { GLADE_EVENTS } from '../game/content/gladeEvents'
import { RESOURCES } from '../game/content/resources'
import { freeRerollsLeft, gladeEventOptions } from '../game/engine/citadel'
import {
  describeOptionCost,
  describeOptionShortfall,
  optionAffordable,
  rerollCost,
} from '../game/engine/events'
import { useGameStore, useHudRun } from '../game/store'
import type {
  ConditionOutcome,
  ConditionSpec,
  CornerstoneDef,
  ResourceBag,
  ThreatSpec,
} from '../game/types'
import { formatDuration } from '../game/engine/forecast'
import { describeTimedGoal } from '../game/engine/structure'
import { IconText } from './IconText'
import { describeStrike, describeWhileActive } from './threatText'
import { DialogTip } from './TipsCoach'
import { CharterChoice } from './CharterChoice'
import { RunModifierList } from './RunModifierList'
import { DraftAppealChips } from './DraftAppealChips'
import { Icon } from './Icon'
import { conditionArt, cornerstoneArt, gladeEventArt, ongoingArt, threatArt } from '../game/content/artFamilies'

/**
 * Blocking modal for the three things that interrupt play: cornerstone picks,
 * blueprint picks, and glade events. The sim is paused while it is open.
 */
export function ChoiceModal() {
  const run = useHudRun()
  const chooseOption = useGameStore((s) => s.chooseOption)
  const chooseEventOption = useGameStore((s) => s.chooseEventOption)
  if (!run) return null
  const choice = run.pendingChoices[0]
  if (!choice) return null

  if (choice.kind === 'gladeEvent') {
    const def = GLADE_EVENTS[choice.options[0]]
    if (!def) return null
    const glade = choice.gladeId ? run.glades[choice.gladeId] : undefined
    return (
      <Overlay>
        <div className="modal modal-event">
          <header>
            <span className="modal-icon">
              <Icon id={gladeEventArt(def)} emoji={def.icon} />
            </span>
            <div>
              <h2>{def.name}</h2>
              <small>{glade ? `${glade.name} · ${glade.kind} glade` : 'Glade event'}</small>
            </div>
          </header>
          <p className="modal-flavour">{def.description}</p>
          <div className="option-list">
            {gladeEventOptions(run, def).map((option, index) => {
              const affordable = optionAffordable(run.stock, option)
              const shortfall = affordable ? null : describeOptionShortfall(run.stock, option)
              return (
                <button
                  key={option.label}
                  type="button"
                  className={`option ${affordable ? '' : 'is-poor'}`}
                  disabled={!affordable}
                  onClick={() => chooseEventOption(index)}
                >
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                  <div className="option-effects">
                    {(option.cost || !!option.foodCost) && (
                      <Effect
                        label="Cost"
                        bag={option.cost ?? {}}
                        food={option.foodCost}
                        tone="bad"
                        title={`Costs ${describeOptionCost(option)}${
                          option.foodCost ? ', paid from your largest food stacks' : ''
                        }`}
                      />
                    )}
                    {option.gain && <Effect label="Gain" bag={option.gain} tone="good" />}
                    {option.reputation ? (
                      <span className="is-good">
                        <Icon id="reputation" label="reputation" /> +{option.reputation}
                      </span>
                    ) : null}
                    {option.impatience ? (
                      <span className={option.impatience > 0 ? 'is-bad' : 'is-good'}>
                        <Icon id="impatience" label="impatience" /> {option.impatience > 0 ? '+' : ''}
                        {option.impatience}
                      </span>
                    ) : null}
                    {option.hostility ? (
                      <span className={option.hostility > 0 ? 'is-bad' : 'is-good'}>
                        <Icon id="hostility" label="hostility" /> {option.hostility > 0 ? '+' : ''}
                        {option.hostility}
                      </span>
                    ) : null}
                    {option.villagerLoss ? (
                      <span className="is-bad">
                        <Icon id="grave" emoji="🪦" /> −{option.villagerLoss} villagers
                      </span>
                    ) : null}
                    {option.villagerGain ? (
                      <span className="is-good">
                        <Icon id="people" emoji="🧑‍🤝‍🧑" /> +{option.villagerGain} villagers
                      </span>
                    ) : null}
                    {option.threat ? (
                      <span className="is-bad" data-testid="option-threat">
                        <Icon id={threatArt(option.threat)} emoji={option.threat.icon} /> Unleashes:{' '}
                        {option.threat.name} — <IconText text={threatTerms(option.threat)} anywhere />
                      </span>
                    ) : null}
                    {option.ongoing ? (
                      <span className="is-good">
                        <Icon id={ongoingArt({ id: '', name: option.ongoing.name })} emoji={option.ongoing.icon} />{' '}
                        Lasting: {option.ongoing.name}
                      </span>
                    ) : null}
                    {option.condition ? (
                      <span className="is-bad" title={option.condition.description} data-testid="option-condition">
                        <Icon id={conditionArt(option.condition)} emoji={option.condition.icon} />{' '}
                        Lingering: {option.condition.name} — <IconText text={conditionTerms(option.condition)} anywhere />
                      </span>
                    ) : null}
                  </div>
                  {shortfall && <small className="is-bad option-shortfall">{shortfall}</small>}
                </button>
              )
            })}
          </div>
        </div>
      </Overlay>
    )
  }

  if (choice.kind === 'charter') {
    return (
      <Overlay>
        <CharterChoice choice={choice} />
      </Overlay>
    )
  }

  if (choice.kind === 'cornerstone') {
    return (
      <Overlay>
        <div className="modal">
          <header>
            <span className="modal-icon">
              <Icon id="monolith" emoji="🪨" />
            </span>
            <div>
              <h2>Lay a Cornerstone</h2>
              <small>The Queen rewards your progress. Choose one — permanently.</small>
            </div>
          </header>
          <div className="option-list option-grid">
            {choice.options.map((id) => {
              const def = CORNERSTONES[id]
              if (!def) return null
              return <CornerstoneOption key={id} def={def} onPick={() => chooseOption(id)} />
            })}
          </div>
          <RerollButton />
        </div>
      </Overlay>
    )
  }

  return (
    <Overlay>
      <div className="modal">
        <header>
          <span className="modal-icon">
            <Icon id="setSquare" emoji="📐" />
          </span>
          <div>
            <h2>New Blueprint</h2>
            <small>
              {choice.mixed
                ? 'Choose a building to add to this settlement — or lay a cornerstone instead.'
                : "Choose a building to add to this settlement's options."}
            </small>
          </div>
        </header>
        <DialogTip id="first-draft" />
        {run.clock === 0 && (run.runModifiers ?? []).length > 0 && (
          // The opening draft is the first thing a run shows: say what land it is.
          <div className="land-strip">
            <span>This land:</span>
            <RunModifierList ids={run.runModifiers} compact />
          </div>
        )}
        <div className="option-list option-grid">
          {choice.options.map((id) => {
            const def = BUILDINGS[id]
            if (!def) {
              const stone = CORNERSTONES[id]
              return stone ? (
                <CornerstoneOption key={id} def={stone} onPick={() => chooseOption(id)} />
              ) : null
            }
            return (
              <button
                key={id}
                type="button"
                className="option"
                onClick={() => chooseOption(id)}
              >
                <span className="option-icon">
                  <Icon of={def} />
                </span>
                <strong>{def.name}</strong>
                <small>{def.description}</small>
                <div className="option-effects">
                  <Effect label="Cost" bag={def.cost} tone="bad" />
                  {def.workerSlots > 0 && (
                    <span>
                      <Icon id="worker" emoji="👷" /> {def.workerSlots}
                    </span>
                  )}
                  <DraftAppealChips run={run} defId={id} />
                </div>
              </button>
            )
          })}
        </div>
        <RerollButton />
      </div>
    </Overlay>
  )
}

/** One cornerstone card, in a cornerstone draft or a mixed blueprint draft. */
function CornerstoneOption({ def, onPick }: { def: CornerstoneDef; onPick: () => void }) {
  return (
    <button type="button" className={`option rarity-${def.rarity}`} onClick={onPick}>
      <span className="option-icon">
        <Icon id={cornerstoneArt(def)} emoji={def.icon} />
      </span>
      <strong>{def.name}</strong>
      <em className="rarity-tag">{def.rarity} cornerstone</em>
      <small>{def.description}</small>
    </button>
  )
}

/** "strikes every 75s: steals 6 Berries · hostility +3 · appease 12 Meat; grows bolder each strike". */
function threatTerms(threat: ThreatSpec): string {
  const price = Object.entries(threat.appease)
    .map(([id, amount]) => `${amount} ${RESOURCES[id as keyof typeof RESOURCES]?.name ?? id}`)
    .join(', ')
  const standing = describeWhileActive(threat.whileActive)
  return (
    `strikes every ${threat.interval}s: ${describeStrike(threat)}` +
    (standing ? ` · while loose: ${standing}` : '') +
    ` · pay ${price} to end it; each strike makes it bolder and dearer`
  )
}

/** "Clear 2 more glades within 5m · met: 👑 +2 · missed: ⏳ +1". */
function conditionTerms(c: ConditionSpec): string {
  const parts = [describeTimedGoal(c.resolveBy) + (c.deadline ? ` within ${formatDuration(c.deadline)}` : '')]
  const won = outcomeWords(c.onResolve)
  const lost = outcomeWords(c.onFail)
  const standing = describeWhileActive(c.whileActive)
  if (standing) parts.push(`until then: ${standing}`)
  if (won) parts.push(`met: ${won}`)
  if (lost) parts.push(`missed: ${lost}`)
  return parts.join(' · ')
}

function outcomeWords(o: ConditionOutcome | undefined): string {
  if (!o) return ''
  const parts: string[] = []
  if (o.reputation) parts.push(`👑 +${o.reputation}`)
  if (o.hostility) parts.push(`🌩️ ${o.hostility > 0 ? '+' : ''}${o.hostility}`)
  if (o.impatience) parts.push(`⏳ ${o.impatience > 0 ? '+' : ''}${o.impatience}`)
  if (o.villagerLoss) parts.push(`🪦 −${o.villagerLoss}`)
  if (o.gain) parts.push('supplies')
  return parts.join(' ')
}

/** Amber lever on drafts: redraw the options at a steepening price. */
function RerollButton() {
  const run = useHudRun()
  const reroll = useGameStore((s) => s.reroll)
  if (!run) return null
  const cost = rerollCost(run)
  return (
    <footer className="modal-foot">
      <button
        type="button"
        className="reroll-button"
        disabled={(run.stock.amber ?? 0) < cost}
        onClick={reroll}
      >
        {freeRerollsLeft(run) > 0 ? (
          <>
            <Icon id="die" emoji="🎲" /> Reroll the offer — free ({freeRerollsLeft(run)} left)
          </>
        ) : (
          <>
            <Icon id="die" emoji="🎲" /> Reroll the offer — {cost} <Icon of={RESOURCES.amber} label="amber" />
          </>
        )}
      </button>
    </footer>
  )
}

function Effect({
  label,
  bag,
  food,
  tone,
  title,
}: {
  label: string
  bag: ResourceBag
  /** Units of any food (a glade event's `foodCost`), shown before the bag. */
  food?: number
  tone: 'good' | 'bad'
  title?: string
}) {
  const entries = Object.entries(bag)
  if (entries.length === 0 && !food) return null
  return (
    <span className={tone === 'good' ? 'is-good' : 'is-bad'} title={title}>
      {label}:{' '}
      {food ? (
        <span>
          <Icon id="plate" emoji="🍽️" label="food" /> {food} food{' '}
        </span>
      ) : null}
      {entries.map(([id, amount]) => (
        <span key={id}>
          <Icon of={RESOURCES[id as keyof typeof RESOURCES]} />
          {amount}{' '}
        </span>
      ))}
    </span>
  )
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Backdrop + modal dialog. Every modal here is a decision the player must
 * make, so Esc deliberately does nothing; instead focus moves into the dialog,
 * Tab cycles inside it, and focus returns to where it was once it closes.
 * The dialog is labelled by the first heading of its content.
 */
export function Overlay({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // Remember what had focus, and hand it back on close.
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    return () => {
      if (previous && previous !== document.body && previous.isConnected) previous.focus()
    }
  }, [])

  // On open, and whenever the content is swapped (one draft leading straight
  // into the next), keep the label current and focus inside the dialog.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const heading = el.querySelector('h1, h2, h3')
    if (heading) {
      if (!heading.id) heading.id = titleId
      el.setAttribute('aria-labelledby', heading.id)
    }
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true })
  })

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const el = ref.current
    if (!el) return
    const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const current = document.activeElement
    if (e.shiftKey && (current === first || current === el)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (current === last || current === el)) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      ref={ref}
      className="overlay"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )
}
