import { useMemo, useState } from 'react'
import {
  NEED_LABELS,
  SPECIES,
  SPECIES_LIST,
  STARTING_SPECIES,
  WORK_TAG_LABELS,
} from '../game/content/species'
import { parseSeed, randomSeed } from '../game/engine/rng'
import { citadelLoadout } from '../game/engine/meta'
import { landFor, mapgenHooksFor, type LandChoice } from '../game/engine/runModifiers'
import { commissionLand } from '../game/engine/citadel'
import { drawTerrainPlan, isUnusualPlan, type TerrainPlan } from '../game/engine/terrainPlan'
import { BIOMES, LAYOUTS } from '../game/content/layouts'
import { BIOME_ART, LAYOUT_ART, NEED_ART } from '../game/content/art'
import { TerrainPlanLine } from './TerrainPlan'
import { listSlots, type SlotId } from '../game/saveSlots'
import { useGameStore } from '../game/store'
import type { SpeciesId } from '../game/types'
import { CommissionPicker } from './Commissions'
import { EdictPicker } from './EdictPicker'
import { LandOptions } from './LandOptions'
import { RunModifierList } from './RunModifierList'
import { Icon } from './Icon'
import { SlotPicker } from './SaveSlots'
import { againWord, useConfirm } from './useConfirm'
import { META_UPGRADES } from '../game/content/meta'
import './setup.css'

/** Settlements bring exactly this many species at most. */
const MAX_SPECIES = 3

/** The Citadel upgrade that admits a species ("Harpy Charter"). */
function charterName(id: SpeciesId): string {
  return Object.values(META_UPGRADES).find((u) => u.unlocksSpecies === id)?.name ?? 'charter'
}

/**
 * The ground the run will be founded on, in one line: its layout and biome.
 * Always shown, for a typed seed and a random one alike, so the player knows
 * what they are setting out to before they go.
 */
function GroundLine({ plan }: { plan: TerrainPlan }) {
  const layout = LAYOUTS[plan.layout]
  const biome = BIOMES[plan.biome]
  if (!layout || !biome) return null
  return (
    <p className="ground-line" data-layout={layout.id} data-biome={biome.id}>
      <span className="ground-label">The ground:</span>{' '}
      <span className="ground-part">
        <Icon id={LAYOUT_ART[layout.id]} emoji={layout.icon} /> {layout.name}
      </span>
      {' · '}
      <span className="ground-part">
        <Icon id={BIOME_ART[biome.id]} emoji={biome.icon} /> {biome.name}
      </span>
    </p>
  )
}

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
  // A blank seed field still means one concrete seed, drawn when the screen
  // opens (and again on a reroll): the preview shows its land and ground, and
  // the run is created on exactly that seed, so the preview never lies.
  const [drawnSeed, setDrawnSeed] = useState(randomSeed)
  // Queen's Edict: defaults to the hardest rung earned so far.
  const [edict, setEdict] = useState(meta.edictUnlocked)
  // A Citadel commission, or none (the standard settlement).
  const [commission, setCommission] = useState<string | null>(null)
  const available = useMemo(
    () => [...new Set([...STARTING_SPECIES, ...meta.unlockedSpecies])],
    [meta.unlockedSpecies],
  )
  const [chosen, setChosen] = useState<SpeciesId[]>(available.slice(0, MAX_SPECIES))
  /** Why the last tap did nothing, rather than silently swapping a pick out. */
  const [hint, setHint] = useState<string | null>(null)
  /** The species whose details are open (the compact tiles on phones). */
  const [detail, setDetail] = useState<SpeciesId | null>(null)

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

  // The land's modifiers follow from the seed (and the Citadel's land
  // upgrades, if any), so the screen previews them.
  const powers = useMemo(
    () => citadelLoadout(meta.upgrades, meta.achievements),
    [meta.upgrades, meta.achievements],
  )
  const [landChoice, setLandChoice] = useState<LandChoice>({})
  const seed = seedText.trim() ? parseSeed(seedText) : drawnSeed
  const land = useMemo(() => landFor(seed, powers, landChoice), [seed, powers, landChoice])

  // …and so does the ground: its layout and biome, which the land can lean.
  const plan = useMemo(
    () => drawTerrainPlan(seed, mapgenHooksFor(commissionLand(land, commission ?? undefined))),
    [seed, land, commission],
  )

  /** A new random map: the typed seed goes, and a fresh one is drawn. */
  const reroll = () => {
    setSeedText('')
    setDrawnSeed(randomSeed())
  }

  const start = () => {
    if (!slot) return
    startRun(seed, chosen, edict, landChoice, slot, commission ?? undefined)
  }
  const replace = useConfirm(`replace-${slot}`, start)
  const allFull = slots.every((s) => s.meta)

  return (
    <div className="screen setup-screen">
      {/* The sections scroll in their own body; the footer sits below it,
          never over it, so no part of the form can hide behind the buttons. */}
      <div className="menu-card wide setup-card">
        <div className="setup-body">
          <h1 className="screen-title">New settlement</h1>

          <section className="setup-section">
            <h2>Settlers</h2>
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
                const open = detail === def.id
                const detailId = `species-detail-${def.id}`
                const bonuses = Object.entries(def.workBonus).map(([tag, bonus]) => (
                  <span className="chip" key={tag} title="Works this much faster here">
                    {WORK_TAG_LABELS[tag] ?? tag} +{Math.round((bonus ?? 0) * 100)}%
                  </span>
                ))
                return (
                  // On phones each species is a compact tile (icon, name,
                  // state, need icons) with its details behind a toggle; on
                  // wider screens the slot vanishes and the card shows all.
                  <div
                    key={def.id}
                    className={`species-slot ${open ? 'is-open' : ''}`}
                    style={{ ['--species' as string]: def.color }}
                  >
                    <button
                      type="button"
                      className={`species-pick ${picked ? 'is-picked' : ''} ${
                        unlocked ? '' : 'is-locked'
                      } ${full ? 'is-full' : ''}`}
                      disabled={!unlocked}
                      aria-pressed={unlocked ? picked : undefined}
                      onClick={() => toggle(def.id)}
                    >
                      <span className="species-icon" aria-hidden>
                        <Icon of={def} />
                      </span>
                      {/* The spaces keep the parts apart in the tile's name
                          ("Humans ✓ Chosen …"); a grid draws no blank text. */}
                      <strong>{def.name}</strong>{' '}
                      {picked && <em className="picked-tag">✓ Chosen</em>}{' '}
                      {!unlocked && <em className="locked-short">Locked</em>}{' '}
                      <small className="species-blurb">{def.blurb}</small>{' '}
                      <div className="need-row">
                        {def.needs.map((need) => (
                          <span key={need} className="need">
                            <Icon id={NEED_ART[need]} />{' '}
                            <span className="need-name">{NEED_LABELS[need].name}</span>
                          </span>
                        ))}
                      </div>
                      <div className="chip-row">{bonuses}</div>
                      {!unlocked && <em className="locked-tag">Locked — buy the charter</em>}
                    </button>
                    <button
                      type="button"
                      className="species-more"
                      aria-expanded={open}
                      aria-controls={detailId}
                      onClick={() => setDetail(open ? null : def.id)}
                    >
                      <span aria-hidden>▾</span>
                      <span className="sr-only">About {def.name}</span>
                    </button>
                    <div
                      id={detailId}
                      className="species-detail"
                      role="group"
                      aria-label={`About ${def.name}`}
                      hidden={!open}
                    >
                      <p>{def.blurb}</p>
                      <p>
                        Needs:{' '}
                        {def.needs.map((need, i) => (
                          <span key={need} className="need">
                            {i > 0 && ' '}
                            <Icon id={NEED_ART[need]} /> {NEED_LABELS[need].name}
                          </span>
                        ))}
                      </p>
                      <div className="chip-row">{bonuses}</div>
                      {!unlocked && (
                        <p className="locked-tag">
                          Locked — buy the {charterName(def.id)} in the Citadel to bring them.
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="setup-section">
            <h2>Seed</h2>
            <p className="muted">
              Leave blank for a random map, or enter any word or number to replay a specific
              one.
            </p>
            <div className="seed-row">
              <input
                value={seedText}
                onChange={(e) => setSeedText(e.target.value)}
                placeholder={`random · ${drawnSeed}`}
                aria-label="Map seed"
              />
              <button
                type="button"
                aria-label="Reroll the map"
                title="Reroll: a new random map"
                onClick={reroll}
              >
                <Icon id="die" emoji="🎲" />
              </button>
            </div>
            <div aria-live="polite">
              <GroundLine plan={plan} />
            </div>
            <div className="setup-land" aria-live="polite">
              <h3>Lay of the land</h3>
              <RunModifierList ids={land} />
              {isUnusualPlan(plan) && <TerrainPlanLine plan={plan} />}
              <LandOptions
                powers={powers}
                choice={landChoice}
                onChange={setLandChoice}
                ensureSeed={() => {
                  // Pins the seed already shown, so the preview stays put.
                  if (!seedText.trim()) setSeedText(String(drawnSeed))
                }}
              />
            </div>
          </section>

          <section className="setup-section edict-section">
            <h2>Queen's Edict</h2>
            <p className="muted">
              Harsher terms for richer supplies. Each edict stacks on the ones below it; win
              under the hardest you have earned to unlock the next.
            </p>
            <EdictPicker unlocked={meta.edictUnlocked} value={edict} onPick={setEdict} />
          </section>

          <section className="setup-section commission-section">
            <h2>Commission</h2>
            <p className="muted">
              The Citadel asks something of this settlement: a twist from the founding, and
              an objective that pays more supplies home if you hold the settlement and meet
              it. Citadel upgrades open more of them.
            </p>
            <CommissionPicker meta={meta} value={commission} onPick={setCommission} />
          </section>

          <section className="setup-section slot-section">
            <h2>Save slot</h2>
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
        </div>

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
              Replace {slotLabel}? {againWord()}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={slotTaken ? replace.trigger : start}
            >
              Set out with{' '}
              {chosen.map((id) => (
                <Icon key={id} of={SPECIES[id]} />
              ))}
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
