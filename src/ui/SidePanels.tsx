import { CORNERSTONES } from '../game/content/cornerstones'
import { ORDERS, describeGoal } from '../game/content/orders'
import { RESOURCES, RESOURCE_LIST } from '../game/content/resources'
import { buyPrice, hasTradingPost } from '../game/engine/actions'
import { useGameStore, useRun } from '../game/store'
import type { ResourceId } from '../game/types'

export function OrdersPanel() {
  const run = useRun()
  if (!run) return null
  return (
    <div className="panel-body">
      <section className="build-group">
        <h3>The Queen's orders</h3>
        <p className="panel-hint">
          Completing an order grants reputation immediately and draws a replacement.
        </p>
        {run.orders.map((order) => {
          const def = ORDERS[order.defId]
          if (!def) return null
          return (
            <div className="order-card" key={order.id}>
              <div className="row-between">
                <strong>{def.name}</strong>
                <span className="order-reward">👑 +{def.reputationReward}</span>
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
              <span>{entry.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

const TRADE_AMOUNT = 5

/** Simple amber shop. Buying is deliberately expensive — it is a safety valve. */
export function TradePanel() {
  const run = useRun()
  const buy = useGameStore((s) => s.buy)
  if (!run) return null

  const available = hasTradingPost(run)
  const amber = run.stock.amber ?? 0
  const sellable = RESOURCE_LIST.filter(
    (r) => r.category === 'material' || r.category === 'rawFood' || r.category === 'serviceGood',
  )

  return (
    <div className="panel-body">
      <section className="build-group">
        <div className="row-between">
          <h3>Caravan</h3>
          <span className="chip">
            {RESOURCES.amber.icon} {Math.floor(amber)}
          </span>
        </div>
        {!available ? (
          <p className="muted">
            Build a Trading Post to deal with passing caravans. Its own recipes turn goods
            into amber; here you can spend that amber on what you are short of.
          </p>
        ) : (
          <>
            <p className="panel-hint">
              Caravans charge a 60% markup. Buy {TRADE_AMOUNT} at a time.
            </p>
            <div className="trade-grid">
              {sellable.map((resource) => {
                const price = buyPrice(resource.id as ResourceId, TRADE_AMOUNT)
                return (
                  <button
                    key={resource.id}
                    type="button"
                    className="trade-card"
                    disabled={amber < price}
                    onClick={() => buy(resource.id as ResourceId, TRADE_AMOUNT)}
                  >
                    <span>{resource.icon}</span>
                    <strong>
                      {TRADE_AMOUNT} {resource.name}
                    </strong>
                    <small>{price} amber</small>
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
