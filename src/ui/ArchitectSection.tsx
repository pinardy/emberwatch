import { NEED_ART } from '../game/content/art'
import { BUILDINGS } from '../game/content/buildings'
import { RESOURCES } from '../game/content/resources'
import { NEED_LABELS } from '../game/content/species'
import { architectBlocked, architectOffers, architectPrice } from '../game/engine/levers'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { Icon } from './Icon'
import './levers.css'

/**
 * On the hearth: the Queen's Architect sells plans — the next blueprint of a
 * service your settlers want, yours at once — at a price that climbs with
 * every set. The amber sink every run has, caravans or not, and the way to
 * steer past a draft that keeps missing.
 */
export function ArchitectSection({ run }: { run: RunState }) {
  const buyPlans = useGameStore((s) => s.buyPlans)
  const offers = architectOffers(run)
  const price = architectPrice(run)
  const amber = run.stock.amber ?? 0
  const blocked = architectBlocked(run)
  // "Not enough amber" is plain from the price; the other reasons are worth a line.
  const reason = blocked && blocked !== 'Not enough amber.' && offers.length > 0 ? blocked : null
  return (
    <section className="inspector-section architect" data-testid="architect">
      <h3>
        <Icon id="setSquare" emoji="📐" /> The Queen's Architect
      </h3>
      {offers.length === 0 ? (
        <p className="muted">Every service your settlers want can already be built.</p>
      ) : (
        <>
          <p className="muted">
            Plans for a service your settlers want: the next blueprint of its chain, yours at once.
            Each set costs {price} <Icon of={RESOURCES.amber} label="amber" />, and the next costs more
            {(run.architectPlans ?? 0) > 0 ? ` (${run.architectPlans} bought)` : ''}.
          </p>
          {reason && <p className="muted">{reason}</p>}
          <div className="architect-offers">
            {offers.map((offer) => {
              const label = NEED_LABELS[offer.need]
              const building = BUILDINGS[offer.piece]
              return (
                <button
                  key={offer.need}
                  type="button"
                  className="wide-button"
                  disabled={!!blocked || amber < price}
                  onClick={() => buyPlans(offer.need)}
                  title={building?.description}
                >
                  <Icon id={NEED_ART[offer.need]} emoji={label?.icon} /> Plans for {label?.name ?? offer.need}:{' '}
                  {building ? <Icon of={building} /> : null} {building?.name ?? offer.piece} — {price}{' '}
                  <Icon of={RESOURCES.amber} label="amber" />
                </button>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
