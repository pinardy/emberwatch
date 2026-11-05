import { useMemo, useState } from 'react'
import {
  NEED_LABELS,
  SPECIES,
  SPECIES_LIST,
  STARTING_SPECIES,
  WORK_TAG_LABELS,
} from '../game/content/species'
import { parseSeed, randomSeed } from '../game/engine/rng'
import { drawRunModifiers } from '../game/engine/runModifiers'
import { listSlots, type SlotId } from '../game/saveSlots'
import { useGameStore } from '../game/store'
import type { SpeciesId } from '../game/types'
import { EdictPicker } from './EdictPicker'
import { RunModifierList } from './RunModifierList'
import { SlotPicker } from './SaveSlots'
import { useConfirm } from './useConfirm'

/** Settlements bring exactly this many species at most. */
const MAX_SPECIES = 3

/** Pre-run setup: pick a seed and which three species answer the call. */
export function SetupScreen() {
  const meta = useGameStore((s) => s.meta)
  const startRun = useGameStore((s) => s.startRun)
  const goToScreen = useGameStore((s) => s.goToScreen)
  const activeSlot = useGameStore((s) => s.activeSlot)
  const run = useGameStore((s) => s.run)
  // The run in progress saves first, so the picker sees it in its slot.
  const [slots] = useState(() => {
    useGameStore.getState().saveNow()
    return listSlots()
  })
  // A new settlement takes a free slot; replacing a run is always a choice.
  const [slot, setSlot] = useState<SlotId | null>(
    () => slots.find((s) => !s.meta)?.id ?? null,
  )
  const slotTaken = slots.find((s) => s.id === slot)?.meta ?? null
  const slotLabel = slots.find((s) => s.id === slot)?.label ?? ''

  const [seedText, setSeedText] = useState('')
  // Queen's Edict: defaults to the hardest rung earned so far.
  const [edict, setEdict] = useState(meta.edictUnlocked)
  const available = useMemo(
    () => [...new Set([...STARTING_SPECIES, ...meta.unlockedSpecies])],
    [meta.unlockedSpecies],
  )
  const [chosen, setChosen] = useState<SpeciesId[]>(available.slice(0, MAX_SPECIES))
  /** Why the last tap did nothing, rather than silently swapping a pick out. */
  const [hint, setHint] = useState<string | null>(null)

  const toggle = (id: SpeciesId) => {
    if (chosen.includes(id)) {
      if (chosen.length === 1) {
        setHint('At least one species has to answer the call.')
        return
      }
      setChosen(chosen.filter((s) => s !== id))
      setHint(null)
      return
    }
    if (chosen.length >= MAX_SPECIES) {
      setHint(
        `You can bring ${MAX_SPECIES} species. Tap one of your picks to drop it, then choose ${SPECIES[id].name}.`,
      )
      return
    }
    setChosen([...chosen, id])
    setHint(null)
  }

  // The land's modifiers follow from the seed alone, so a typed seed previews them.
  const previewSeed = seedText.trim() ? parseSeed(seedText) : null
  const land = useMemo(
    () => (previewSeed === null ? [] : drawRunModifiers(previewSeed)),
    [previewSeed],
  )

  const start = () => {
    if (!slot) return
    const seed = seedText.trim() ? parseSeed(seedText) : randomSeed()
    startRun(seed, chosen, edict, slot)
  }
  const replace = useConfirm(`replace-${slot}`, start)
  const allFull = slots.every((s) => s.meta)

  return (
    <div className="screen setup-screen">
      <div className="menu-card wide">
        <h2>New settlement</h2>

        <section className="setup-section">
          <h3>Settlers</h3>
          <p className="muted">
            Choose up to three species. Each brings work bonuses and two service needs you
            will have to satisfy.{' '}
            <strong className="pick-count">
              {chosen.length}/{MAX_SPECIES} chosen
            </strong>
          </p>
          <p className="setup-hint" role="status">
            {hint}
          </p>
          <div className="species-grid">
            {SPECIES_LIST.map((def) => {
              const unlocked = available.includes(def.id)
              const picked = chosen.includes(def.id)
              const full = !picked && unlocked && chosen.length >= MAX_SPECIES
              return (
                <button
                  key={def.id}
                  type="button"
                  className={`species-pick ${picked ? 'is-picked' : ''} ${
                    unlocked ? '' : 'is-locked'
                  } ${full ? 'is-full' : ''}`}
                  disabled={!unlocked}
                  aria-pressed={unlocked ? picked : undefined}
                  onClick={() => toggle(def.id)}
                  style={{ ['--species' as string]: def.color }}
                >
                  <span className="species-icon" aria-hidden>
                    {def.icon}
                  </span>
                  <strong>{def.name}</strong>
                  {picked && <em className="picked-tag">✓ Chosen</em>}
                  <small>{def.blurb}</small>
                  <div className="need-row">
                    {def.needs.map((need) => (
                      <span key={need} className="need">
                        {NEED_LABELS[need].icon} {NEED_LABELS[need].name}
                      </span>
                    ))}
                  </div>
                  <div className="chip-row">
                    {Object.entries(def.workBonus).map(([tag, bonus]) => (
                      <span className="chip" key={tag} title="Works this much faster here">
                        {WORK_TAG_LABELS[tag] ?? tag} +{Math.round((bonus ?? 0) * 100)}%
                      </span>
                    ))}
                  </div>
                  {!unlocked && <em className="locked-tag">Locked — buy the charter</em>}
                </button>
              )
            })}
          </div>
        </section>

        <section className="setup-section">
          <h3>Seed</h3>
          <p className="muted">
            Leave blank for a random map, or enter any word or number to replay a specific
            one.
          </p>
          <div className="seed-row">
            <input
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              placeholder="random"
              aria-label="Map seed"
            />
            <button
              type="button"
              aria-label="Random seed"
              title="Random seed"
              onClick={() => setSeedText(String(randomSeed()))}
            >
              🎲
            </button>
          </div>
          <div className="setup-land" aria-live="polite">
            <h4>Lay of the land</h4>
            {previewSeed === null ? (
              <p className="muted">
                Every map has one or two modifiers of its own — richer veins, longer
                Storms, restless woods. A random map reveals them when you set out; enter
                a seed to see them now.
              </p>
            ) : (
              <RunModifierList ids={land} />
            )}
          </div>
        </section>

        <section className="setup-section edict-section">
          <h3>Queen's Edict</h3>
          <p className="muted">
            Harsher terms for richer supplies. Each edict stacks on the ones below it; win
            under the hardest you have earned to unlock the next.
          </p>
          <EdictPicker unlocked={meta.edictUnlocked} value={edict} onPick={setEdict} />
        </section>

        <section className="setup-section slot-section">
          <h3>Save slot</h3>
          <p className="muted">
            {allFull
              ? 'Every slot holds a settlement. Choose one to replace, or go back and delete or export one first.'
              : 'The settlement saves itself here as you play. Slots that hold a run stay untouched unless you choose to replace one.'}
          </p>
          <SlotPicker
            slots={slots}
            value={slot}
            onChange={setSlot}
            name="setup-slot"
            label="Save slot"
            activeSlot={run ? activeSlot : null}
          />
        </section>

        <footer className="modal-foot setup-foot">
          <button type="button" onClick={() => goToScreen('menu')}>
            Back
          </button>
          {!slot ? (
            <button type="button" className="primary" disabled>
              Choose a save slot
            </button>
          ) : slotTaken && replace.armed ? (
            <button type="button" className="primary is-armed" onClick={replace.trigger}>
              Replace {slotLabel}? Tap again
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={slotTaken ? replace.trigger : start}
            >
              Set out with {chosen.map((id) => SPECIES[id].icon).join(' ')}
              {slotTaken ? ` · replaces ${slotLabel}` : ''}
              <span className="sr-only">
                {' '}
                ({chosen.map((id) => SPECIES[id].name).join(', ')})
              </span>
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
