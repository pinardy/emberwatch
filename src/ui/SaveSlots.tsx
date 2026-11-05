import { EDICTS } from '../game/content/meta'
import { RUN_MODIFIERS } from '../game/content/runModifiers'
import { SPECIES } from '../game/content/species'
import { SEASON_INFO } from '../game/engine/balance'
import type { SlotId, SlotMeta, SlotSummary } from '../game/saveSlots'
import './saves.css'

/** "Year 3 · Storm" */
export function slotWhen(meta: SlotMeta): string {
  return `Year ${meta.year} · ${SEASON_INFO[meta.season]?.name ?? meta.season}`
}

export function slotSpecies(meta: SlotMeta): string {
  return meta.species.map((id) => `${SPECIES[id].icon} ${SPECIES[id].name}`).join(', ')
}

function playedAgo(savedAt: number, now: number): string {
  if (!savedAt) return 'Last played before save slots'
  const minutes = Math.round((now - savedAt) / 60000)
  if (minutes < 1) return 'Played just now'
  if (minutes < 60) return `Played ${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Played ${hours} h ago`
  return `Played ${new Date(savedAt).toLocaleDateString()}`
}

/** One line for "Continue": where the latest run stands. */
export function slotOneLiner(meta: SlotMeta): string {
  return `${meta.species.map((id) => SPECIES[id].icon).join('')} ${slotWhen(meta)} · 👑 ${Math.floor(
    meta.reputation,
  )}/${meta.maxReputation} · ⏳ ${Math.floor(meta.impatience)}/${meta.maxImpatience}`
}

/** The metadata block shown on the load screen and in slot pickers. */
export function SlotDetails({ meta, compact = false }: { meta: SlotMeta; compact?: boolean }) {
  const edict = EDICTS.find((d) => d.level === meta.edict)
  const outcome = meta.phase === 'won' ? ' · 🏆 Won' : meta.phase === 'lost' ? ' · Lost' : ''
  return (
    <div className="slot-details">
      <div className="slot-line">
        <strong>{slotWhen(meta)}</strong>
        {outcome}
      </div>
      <div className="slot-line">{slotSpecies(meta)}</div>
      <div className="slot-line slot-race">
        <span title="Reputation">
          👑 {Math.floor(meta.reputation)}/{meta.maxReputation}
        </span>
        <span title="Impatience">
          ⏳ {Math.floor(meta.impatience)}/{meta.maxImpatience}
        </span>
        <span>{edict ? `${edict.icon} ${edict.name}` : 'No edict'}</span>
      </div>
      {!compact && meta.runModifiers.length > 0 && (
        <div className="slot-line muted">
          {meta.runModifiers.map((id) => RUN_MODIFIERS[id]?.name ?? id).join(' · ')}
        </div>
      )}
      {!compact && (
        <div className="slot-line muted">
          Seed {meta.seed} · {playedAgo(meta.savedAt, Date.now())}
        </div>
      )}
    </div>
  )
}

/**
 * Radio list of slots. Occupied slots show what they hold, so choosing one
 * to replace is never a guess.
 */
export function SlotPicker({
  slots,
  value,
  onChange,
  name,
  label,
  activeSlot,
}: {
  slots: SlotSummary[]
  value: SlotId | null
  onChange: (id: SlotId) => void
  name: string
  label: string
  activeSlot?: SlotId | null
}) {
  return (
    <div className="slot-picker" role="radiogroup" aria-label={label}>
      {slots.map((slot) => (
        <label
          key={slot.id}
          className={`slot-option ${value === slot.id ? 'is-picked' : ''} ${
            slot.meta ? 'is-taken' : 'is-free'
          }`}
        >
          <input
            type="radio"
            name={name}
            value={slot.id}
            checked={value === slot.id}
            onChange={() => onChange(slot.id)}
          />
          <span className="slot-option-body">
            <strong>{slot.label}</strong>
            {slot.meta ? (
              <small>
                {activeSlot === slot.id ? 'Playing now · ' : ''}
                {slotOneLiner(slot.meta)}
              </small>
            ) : (
              <small className="slot-free">Empty</small>
            )}
          </span>
        </label>
      ))}
    </div>
  )
}
