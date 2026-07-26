import { BUILDINGS } from '../game/content/buildings'
import { CORNERSTONES } from '../game/content/cornerstones'
import { GLADE_EVENTS } from '../game/content/gladeEvents'
import { RESOURCES } from '../game/content/resources'
import { NEED_LABELS } from '../game/content/species'
import { canAfford } from '../game/engine/queries'
import { useGameStore, useRun } from '../game/store'
import type { ResourceBag } from '../game/types'
import { Cost } from './BuildPanel'

/**
 * Blocking modal for the three things that interrupt play: cornerstone picks,
 * blueprint picks, and glade events. The sim is paused while it is open.
 */
export function ChoiceModal() {
  const run = useRun()
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
            <span className="modal-icon">{def.icon}</span>
            <div>
              <h2>{def.name}</h2>
              <small>{glade ? `${glade.name} · ${glade.kind} glade` : 'Glade event'}</small>
            </div>
          </header>
          <p className="modal-flavour">{def.description}</p>
          <div className="option-list">
            {def.options.map((option, index) => {
              const affordable = !option.requires || canAfford(run.stock, option.requires)
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
                    {option.cost && <Effect label="Cost" bag={option.cost} tone="bad" />}
                    {option.gain && <Effect label="Gain" bag={option.gain} tone="good" />}
                    {option.reputation ? (
                      <span className="is-good">👑 +{option.reputation}</span>
                    ) : null}
                    {option.impatience ? (
                      <span className="is-bad">⏳ +{option.impatience}</span>
                    ) : null}
                    {option.hostility ? (
                      <span className={option.hostility > 0 ? 'is-bad' : 'is-good'}>
                        🌩️ {option.hostility > 0 ? '+' : ''}
                        {option.hostility}
                      </span>
                    ) : null}
                    {option.villagerLoss ? (
                      <span className="is-bad">🪦 −{option.villagerLoss} villagers</span>
                    ) : null}
                  </div>
                  {!affordable && option.requires && (
                    <small className="is-bad">
                      Requires <Cost cost={option.requires} stock={run.stock} />
                    </small>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </Overlay>
    )
  }

  if (choice.kind === 'cornerstone') {
    return (
      <Overlay>
        <div className="modal">
          <header>
            <span className="modal-icon">🪨</span>
            <div>
              <h2>Lay a Cornerstone</h2>
              <small>The Queen rewards your progress. Choose one — permanently.</small>
            </div>
          </header>
          <div className="option-list option-grid">
            {choice.options.map((id) => {
              const def = CORNERSTONES[id]
              if (!def) return null
              return (
                <button
                  key={id}
                  type="button"
                  className={`option rarity-${def.rarity}`}
                  onClick={() => chooseOption(id)}
                >
                  <span className="option-icon">{def.icon}</span>
                  <strong>{def.name}</strong>
                  <em className="rarity-tag">{def.rarity}</em>
                  <small>{def.description}</small>
                </button>
              )
            })}
          </div>
        </div>
      </Overlay>
    )
  }

  return (
    <Overlay>
      <div className="modal">
        <header>
          <span className="modal-icon">📐</span>
          <div>
            <h2>New Blueprint</h2>
            <small>Choose a building to add to this settlement's options.</small>
          </div>
        </header>
        <div className="option-list option-grid">
          {choice.options.map((id) => {
            const def = BUILDINGS[id]
            if (!def) return null
            return (
              <button
                key={id}
                type="button"
                className="option"
                onClick={() => chooseOption(id)}
              >
                <span className="option-icon">{def.icon}</span>
                <strong>{def.name}</strong>
                <small>{def.description}</small>
                <div className="option-effects">
                  <Effect label="Cost" bag={def.cost} tone="bad" />
                  {def.workerSlots > 0 && <span>👷 {def.workerSlots}</span>}
                  {def.service && (
                    <span>
                      {NEED_LABELS[def.service.need].icon} {NEED_LABELS[def.service.need].name}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </Overlay>
  )
}

function Effect({
  label,
  bag,
  tone,
}: {
  label: string
  bag: ResourceBag
  tone: 'good' | 'bad'
}) {
  const entries = Object.entries(bag)
  if (entries.length === 0) return null
  return (
    <span className={tone === 'good' ? 'is-good' : 'is-bad'}>
      {label}:{' '}
      {entries.map(([id, amount]) => (
        <span key={id}>
          {RESOURCES[id as keyof typeof RESOURCES]?.icon}
          {amount}{' '}
        </span>
      ))}
    </span>
  )
}

export function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="overlay">{children}</div>
}
