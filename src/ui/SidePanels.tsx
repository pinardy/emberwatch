import { CORNERSTONES } from '../game/content/cornerstones'
import { ORDERS, describeGoal } from '../game/content/orders'
import { RESOURCES, RESOURCE_LIST } from '../game/content/resources'
import { sootheCost } from '../game/engine/actions'
import { TRADE_LOT } from '../game/engine/balance'
import { orderReputation } from '../game/engine/events'
import { modifierOngoingId } from '../game/engine/runModifiers'
import { caravanAvailable, hasTradingPost, offerPrice, sellPrice } from '../game/engine/trade'
import { useGameStore, useRun } from '../game/store'
import { DecreeCard } from './DecreeCard'
import { RunModifierList } from './RunModifierList'
import { RaceSparkline } from './RunTimeline'
import type { ResourceId } from '../game/types'
import { Icon } from './Icon'
import { IconText } from './IconText'

export function OrdersPanel() {
  const run = useRun()
  const soothe = useGameStore((s) => s.soothe)
  if (!run) return null
  // Modifier effects live in `ongoing` too; they are listed with the land.
  const landIds = new Set((run.runModifiers ?? []).map(modifierOngoingId))
  const pacts = run.ongoing.filter((effect) => !landIds.has(effect.id))
  return (
    <div className="panel-body">
      <section className="build-group">
        <div className="orders-head">
          <h3>The Queen's orders</h3>
          <RaceSparkline run={run} />
        </div>
        <p className="panel-hint">
          Completing an order grants reputation immediately and draws a replacement.
        </p>
        <DecreeCard />
        {run.orders.map((order) => {
          const def = ORDERS[order.defId]
          if (!def) return null
          return (
            <div className="order-card" key={order.id}>
              <div className="row-between">
                <strong>{def.name}</strong>
                <span className="order-reward">
                  👑 +{orderReputation(run, def.reputationReward)}
                </span>
              </div>
              <small>{describeGoal(def.goal)}</small>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${order.progress * 100}%` }} />
              </div>
              <small className="muted">{Math.floor(order.progress * 100)}%</small>
            </div>
          )
        })}
        {run.orders.length === 0 && <p className="muted">No orders outstanding.</p>}
      </section>

      <section className="build-group">
        <h3>Petition the Queen</h3>
        <p className="panel-hint">
          A gift of amber buys back a point of her patience. The price climbs with
          each petition.
        </p>
        <button
          type="button"
          className="wide-button"
          disabled={(run.stock.amber ?? 0) < sootheCost(run) || run.impatience < 1}
          onClick={() => soothe()}
        >
          🕊️ Soothe the Queen — {sootheCost(run)} <Icon of={RESOURCES.amber} label="amber" /> (
          <Icon id="impatience" label="impatience" /> −1)
        </button>
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
                <span>{def.icon}</span>
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
                <span>{effect.icon}</span>
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
  const run = useRun()
  if (!run) return null
  return (
    <div className="panel-body">
      <section className="build-group">
        <h3>Chronicle</h3>
        <ul className="log-list">
          {run.log.map((entry) => (
            <li key={entry.id} className={`log-${entry.tone}`}>
              <span className="log-when">
                Y{entry.year} {entry.season.slice(0, 3)}
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

/**
 * Caravan trading. While a caravan is in town you buy its rotating lots and
 * sell your surplus — it pays double for the one good it wants this visit.
 */
export function TradePanel() {
  const run = useRun()
  const buyLot = useGameStore((s) => s.buyLot)
  const sell = useGameStore((s) => s.sell)
  if (!run) return null

  const available = caravanAvailable(run)
  const wandering = available && !hasTradingPost(run)
  const amber = run.stock.amber ?? 0
  const caravan = run.caravan
  const sellable = RESOURCE_LIST.filter(
    (r) => r.category !== 'currency' && (run.stock[r.id] ?? 0) >= TRADE_LOT,
  )

  return (
    <div className="panel-body">
      <section className="build-group">
        <div className="row-between">
          <h3>Caravan</h3>
          <span className="chip">
            <Icon of={RESOURCES.amber} label="amber" /> {Math.floor(amber)}
          </span>
        </div>
        {!available ? (
          <p className="muted">
            Build a Trading Post and caravans will start calling. They carry rotating
            stock, and each one pays double for a good it wants.
          </p>
        ) : !caravan.here ? (
          <p className="muted">
            {wandering ? 'Wandering traders find you without a Trading Post. ' : ''}
            🐫 The next caravan arrives in about{' '}
            <strong>{Math.max(1, Math.ceil(caravan.timer / 60))} min</strong>. Stock up
            on whatever it might want.
          </p>
        ) : (
          <>
            <p className="panel-hint">
              🐫 In town for {Math.ceil(caravan.timer)}s — paying double for{' '}
              <strong>
                <Icon of={RESOURCES[caravan.wants]} /> {RESOURCES[caravan.wants]?.name}
              </strong>
              .
            </p>
            <h4 className="trade-heading">For sale</h4>
            <div className="trade-grid">
              {caravan.offers.map((offer, index) => {
                const price = offerPrice(run, index)
                return (
                  <button
                    key={`${offer.resource}-${index}`}
                    type="button"
                    className="trade-card"
                    disabled={offer.sold || amber < price}
                    onClick={() => buyLot(index)}
                  >
                    <span>
                      <Icon of={RESOURCES[offer.resource]} />
                    </span>
                    <strong>
                      {offer.amount} {RESOURCES[offer.resource]?.name}
                    </strong>
                    <small>{offer.sold ? 'Sold' : `${price} amber`}</small>
                  </button>
                )
              })}
            </div>
            <h4 className="trade-heading">Sell (lots of {TRADE_LOT})</h4>
            {sellable.length === 0 && (
              <p className="muted">Nothing in the stockpile makes a full lot.</p>
            )}
            <div className="trade-grid">
              {sellable.map((resource) => {
                const paid = sellPrice(run, resource.id as ResourceId, TRADE_LOT)
                const wanted = caravan.wants === resource.id
                return (
                  <button
                    key={resource.id}
                    type="button"
                    className={`trade-card ${wanted ? 'is-wanted' : ''}`}
                    onClick={() => sell(resource.id as ResourceId)}
                  >
                    <span>
                      <Icon of={resource} />
                    </span>
                    <strong>
                      {TRADE_LOT} {resource.name}
                    </strong>
                    <small>
                      {wanted ? '★ ' : ''}+{paid} amber
                    </small>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
