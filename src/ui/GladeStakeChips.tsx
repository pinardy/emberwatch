import type { GladeStake } from '../game/engine/events'
import { Icon } from './Icon'
import { GLADE_STAKE_ART, GLADE_STAKE_STYLE } from './mapShared'

/**
 * A glade's stakes as the map draws them (the same icon on the same colour),
 * each with its name and what it means: the key to the chips under the
 * plates, where a 3D plate has no hover of its own.
 */
export function GladeStakeChips({ stakes }: { stakes: readonly GladeStake[] }) {
  if (stakes.length === 0) return null
  return (
    <ul className="stake-chips" aria-label="What clearing it could bring">
      {stakes.map((k) => {
        const style = GLADE_STAKE_STYLE[k]
        return (
          <li key={k} className="stake-chip" style={{ borderColor: style.color }} title={style.hint}>
            <Icon id={GLADE_STAKE_ART[k]} />
            <span className="stake-chip-text">
              <b style={{ color: style.color }}>{style.label}</b>
              <small>{style.means.charAt(0).toUpperCase() + style.means.slice(1)}</small>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
