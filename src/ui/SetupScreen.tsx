import { useMemo, useState } from 'react'
import { SPECIES, SPECIES_LIST, STARTING_SPECIES } from '../game/content/species'
import { NEED_LABELS } from '../game/content/species'
import { parseSeed, randomSeed } from '../game/engine/rng'
import { useGameStore } from '../game/store'
import type { SpeciesId } from '../game/types'

/** Pre-run setup: pick a seed and which three species answer the call. */
export function SetupScreen() {
  const meta = useGameStore((s) => s.meta)
  const startRun = useGameStore((s) => s.startRun)
  const goToScreen = useGameStore((s) => s.goToScreen)

  const [seedText, setSeedText] = useState('')
  const available = useMemo(
    () => [...new Set([...STARTING_SPECIES, ...meta.unlockedSpecies])],
    [meta.unlockedSpecies],
  )
  const [chosen, setChosen] = useState<SpeciesId[]>(available.slice(0, 3))

  const toggle = (id: SpeciesId) => {
    setChosen((current) => {
      if (current.includes(id)) {
        return current.length > 1 ? current.filter((s) => s !== id) : current
      }
      if (current.length >= 3) return [...current.slice(1), id]
      return [...current, id]
    })
  }

  const start = () => {
    const seed = seedText.trim() ? parseSeed(seedText) : randomSeed()
    startRun(seed, chosen)
  }

  return (
    <div className="screen setup-screen">
      <div className="menu-card wide">
        <h2>New settlement</h2>

        <section className="setup-section">
          <h3>Settlers</h3>
          <p className="muted">
            Choose up to three species. Each brings work bonuses and two service needs you
            will have to satisfy.
          </p>
          <div className="species-grid">
            {SPECIES_LIST.map((def) => {
              const unlocked = available.includes(def.id)
              const picked = chosen.includes(def.id)
              return (
                <button
                  key={def.id}
                  type="button"
                  className={`species-pick ${picked ? 'is-picked' : ''} ${
                    unlocked ? '' : 'is-locked'
                  }`}
                  disabled={!unlocked}
                  onClick={() => toggle(def.id)}
                  style={{ ['--species' as string]: def.color }}
                >
                  <span className="species-icon">{def.icon}</span>
                  <strong>{def.name}</strong>
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
                      <span className="chip" key={tag}>
                        {tag} +{Math.round((bonus ?? 0) * 100)}%
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
            <button type="button" onClick={() => setSeedText(String(randomSeed()))}>
              🎲
            </button>
          </div>
        </section>

        <footer className="modal-foot">
          <button type="button" onClick={() => goToScreen('menu')}>
            Back
          </button>
          <button type="button" className="primary" onClick={start}>
            Set out with {chosen.map((id) => SPECIES[id].icon).join(' ')}
          </button>
        </footer>
      </div>
    </div>
  )
}
