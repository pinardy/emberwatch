import { runModifierDefs } from '../game/engine/runModifiers'

const TONE_LABEL = { boon: 'Boon', bane: 'Bane', mixed: 'Trade-off' } as const

/**
 * The land's modifiers for a run, as chips. Shared by the setup preview, the
 * Orders panel, the opening draft and the end screen so they all read alike.
 */
export function RunModifierList({
  ids,
  compact = false,
}: {
  ids: readonly string[]
  /** One line per modifier, no description (for tight spots). */
  compact?: boolean
}) {
  const defs = runModifierDefs(ids)
  if (defs.length === 0) return null
  if (compact) {
    return (
      <ul className="land-inline" aria-label="Lay of the land">
        {defs.map((def) => (
          <li key={def.id} className={`land-tag tone-${def.tone}`} title={def.description}>
            <span aria-hidden>{def.icon}</span> {def.name}
          </li>
        ))}
      </ul>
    )
  }
  return (
    <div className="chip-column" role="list" aria-label="Lay of the land">
      {defs.map((def) => (
        <div className={`cornerstone-chip land-chip tone-${def.tone}`} key={def.id} role="listitem">
          <span aria-hidden>{def.icon}</span>
          <div>
            <strong>{def.name}</strong> <em className="land-tone">{TONE_LABEL[def.tone]}</em>
            <small>{def.description}</small>
          </div>
        </div>
      ))}
    </div>
  )
}
