import { CORNERSTONES } from '../game/content/cornerstones'
import { ORDERS } from '../game/content/orders'
import { RESOURCES } from '../game/content/resources'
import { sootheCost } from '../game/engine/actions'
import { SEASON_INFO } from '../game/engine/balance'
import { describeOrder, orderReputation } from '../game/engine/orders'
import { modifierOngoingId } from '../game/engine/runModifiers'
import { useGameStore, useHudRun } from '../game/store'
import { Bar } from './Bar'
import { DecreeCard } from './DecreeCard'
import { CommissionCard } from './Commissions'
import { COMMISSION_ONGOING_ID } from '../game/engine/citadel'
import { OrderOffer, orderTag } from './QueenChoice'
import { RunModifierList } from './RunModifierList'
import { RaceSparkline } from './RaceSparkline'
import { Icon } from './Icon'
import { IconText } from './IconText'
import { GrandPetitionCard, QueensCourt, RetreatCard } from './QueenLevers'
import { ErrandList } from './Errands'
import { cornerstoneArt, ongoingArt } from '../game/content/artFamilies'

export function OrdersPanel() {
  const run = useHudRun()
  const soothe = useGameStore((s) => s.soothe)
  if (!run) return null
  // Modifier effects live in `ongoing` too; they are listed with the land.
  const landIds = new Set((run.runModifiers ?? []).map(modifierOngoingId))
  // ...and the commission's twist is on its own card.
  landIds.add(COMMISSION_ONGOING_ID)
  const pacts = run.ongoing.filter((effect) => !landIds.has(effect.id))
  // Why the petition button is off, said in words (not only by greying it).
  const amber = Math.floor(run.stock.amber ?? 0)
  const sootheBlocked =
    run.impatience < 1
      ? 'Her patience is whole: there is no impatience to soothe.'
      : amber < sootheCost(run)
        ? `Needs ${sootheCost(run)} amber; you have ${amber}.`
        : null
  return (
    <div className="panel-body">
      <section className="build-group">
        <div className="orders-head">
          <h3>The Queen's orders</h3>
          <RaceSparkline run={run} />
        </div>
        <p className="panel-hint">
          Completing an order grants reputation immediately; the Queen then offers two
          more to choose from here, and the slot waits empty until you pick. {run.orderDeclineYear === run.season.year
            ? 'You have already asked her for different orders this year.'
            : 'Once a year you may ask her for a different pair.'}
        </p>
        <CommissionCard run={run} />
        {(run.orderOffers ?? []).map((offer, index) => (
          <OrderOffer key={offer.orders?.[0]?.id ?? index} run={run} offer={offer} index={index} />
        ))}
        <DecreeCard />
        {run.orders.map((order) => {
          const def = ORDERS[order.defId]
          if (!def) return null
          const tag = orderTag(order)
          return (
            <div className={`order-card ${order.writ ? 'is-writ' : ''}`} key={order.id}>
              <div className="row-between">
                <strong>
                  {def.name}
                  {tag && <em className="order-tag">{tag}</em>}
                </strong>
                <span className="order-reward">
                  <Icon id="reputation" label="reputation" /> +{orderReputation(run, order)}
                </span>
              </div>
              <small>{describeOrder(order)}</small>
              <Bar value={order.progress} />
              <small className="muted">{Math.floor(order.progress * 100)}%</small>
            </div>
          )
        })}
        {run.orders.length === 0 && (run.orderOffers ?? []).length === 0 && (
          <p className="muted">No orders outstanding.</p>
        )}
        <QueensCourt run={run} />
      </section>

      <ErrandList run={run} />

      <section className="build-group" id="queen-levers">
        <h3>Petition the Queen</h3>
        <p className="panel-hint">
          A gift of amber buys back a point of her patience. The price climbs with
          each petition.
        </p>
        <button
          type="button"
          id="soothe-button"
          className="wide-button"
          disabled={sootheBlocked !== null}
          title={sootheBlocked ?? undefined}
          aria-describedby={sootheBlocked ? 'soothe-why' : undefined}
          onClick={() => soothe()}
        >
          <Icon id="dove" emoji="🕊️" /> Soothe the Queen — {sootheCost(run)} <Icon of={RESOURCES.amber} label="amber" /> (
          <Icon id="impatience" label="impatience" /> −1)
        </button>
        {sootheBlocked && (
          <small id="soothe-why" className="muted soothe-why">
            {sootheBlocked}
          </small>
        )}
        <GrandPetitionCard run={run} />
        <RetreatCard run={run} />
      </section>

      <section className="build-group">
        <h3>Cornerstones</h3>
        {run.cornerstones.length === 0 && (
          <p className="muted">None yet. They are offered at reputation milestones.</p>
        )}
        <div className="chip-column">
          {run.cornerstones.map((id) => {
            const def = CORNERSTONES[id]
            if (!def) return null
            return (
              <div className={`cornerstone-chip rarity-${def.rarity}`} key={id}>
                <span>
                  <Icon id={cornerstoneArt(def)} emoji={def.icon} />
                </span>
                <div>
                  <strong>{def.name}</strong>
                  <small>{def.description}</small>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {(run.runModifiers ?? []).length > 0 && (
        <section className="build-group">
          <h3>Lay of the land</h3>
          <p className="panel-hint">This map's own character, drawn from its seed.</p>
          <RunModifierList ids={run.runModifiers} />
        </section>
      )}

      {pacts.length > 0 && (
        <section className="build-group">
          <h3>Pacts &amp; blessings</h3>
          <div className="chip-column">
            {pacts.map((effect) => (
              <div className="cornerstone-chip rarity-rare" key={effect.id}>
                <span>
                  <Icon id={ongoingArt(effect)} emoji={effect.icon} />
                </span>
                <div>
                  <strong>{effect.name}</strong>
                  <small>{effect.description}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export function LogPanel() {
  const run = useHudRun()
  if (!run) return null
  return (
    <div className="panel-body">
      <section className="build-group">
        <h3>Chronicle</h3>
        <ul className="log-list">
          {run.log.map((entry) => (
            <li key={entry.id} className={`log-${entry.tone}`}>
              <span className="log-when">
                Y{entry.year} {SEASON_INFO[entry.season]?.name ?? entry.season}
              </span>
              <span>
                <IconText text={entry.text} />
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/** The Trade panel lives in its own module; re-exported for the panel switcher. */
export { TradePanel } from './TradePanel'
