import { BUILDINGS } from '../game/content/buildings'
import type { AdjacencyBonus } from '../game/types'
import { Icon } from './Icon'

/** The drawn counterpart of `partnerIcon()`: the partner building, or any home. */
export function PartnerIcon({ bonus }: { bonus: AdjacencyBonus }) {
  if (bonus.nearId) return <Icon of={BUILDINGS[bonus.nearId]} emoji="🔗" />
  if (bonus.nearCategory === 'housing') return <Icon id="cabin" />
  return <Icon emoji="🔗" />
}
