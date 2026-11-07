import { useState } from 'react'
import { BUILDINGS } from '../game/content/buildings'
import { CORNERSTONES } from '../game/content/cornerstones'
import { RESOURCES, RESOURCE_LIST } from '../game/content/resources'
import { TRADE_AGREEMENTS, TRADE_AGREEMENT_LIST } from '../game/content/tradeAgreements'
import { cornerstoneArt } from '../game/content/artFamilies'
import { TRADE_LOT } from '../game/engine/balance'
import {
  AGREEMENT_PRICE,
  COMMISSION_GOODS,
  COMMISSION_LOT,
  RARE_FIRST_VISIT,
  caravanAvailable,
  commissionPrice,
  hasTradingPost,
  offerPrice,
  provisionsGood,
  rareName,
  rarePrice,
  sellPrice,
} from '../game/engine/trade'
import { useGameStore, useHudRun } from '../game/store'
import type { ResourceId, RunState } from '../game/types'
import { DraftAppealChips } from './DraftAppealChips'
import { Icon } from './Icon'

/** "about 2 min" / "under a minute" for a caravan timer. */
function minutesAway(seconds: number): string {
  return seconds < 60 ? 'under a minute' : `about ${Math.ceil(seconds / 60)} min`
}

/**
 * Caravan trading. While a caravan is in town you buy its rotating lots and
 * its one rare item, and sell your surplus — it pays double for the one good
 * it wants this visit. Whenever caravans call you can also commission a
 * shipment for the next one, and sign the run's one trade agreement: the
 * levers that make a pile of amber into a decision.
 */
export function TradePanel() {
  const run = useHudRun()
  if (!run) return null

  const available = caravanAvailable(run)
  const amber = Math.floor(run.stock.amber ?? 0)

  return (
    <div className="panel-body" data-testid="trade-panel">
      <section className="build-group">
        <div className="row-between">
          <h3>Caravan</h3>
          <span className="chip" data-testid="trade-amber">
            <Icon of={RESOURCES.amber} label="amber" /> {amber}
          </span>
        </div>
        {!available ? (
          <p className="muted">
            Build a Trading Post and caravans will start calling. They sell goods and buy your
            surplus, carry a rare blueprint or cornerstone from their second visit, take
            commissions, and offer one trade agreement per run.
          </p>
        ) : (
          <CaravanVisit run={run} amber={amber} />
        )}
      </section>
      {available && <Commission run={run} amber={amber} />}
      {available && <Agreement run={run} amber={amber} />}
      {available && run.caravan.here && <SellLots run={run} />}
      <p className="muted trade-elsewhere">
        Amber also soothes the Queen (Orders), redraws a draft, and rushes a site (select it).
      </p>
    </div>
  )
}

function CaravanVisit({ run, amber }: { run: RunState; amber: number }) {
  const buyLot = useGameStore((s) => s.buyLot)
  const caravan = run.caravan
  const wandering = !hasTradingPost(run)

  if (!caravan.here) {
    const rareNext = caravan.visits + 1 >= RARE_FIRST_VISIT
    return (
      <p className="muted">
        {wandering ? 'Wandering traders find you without a Trading Post. ' : ''}
        <Icon id="camel" emoji="🐫" /> The next caravan arrives in{' '}
        <strong>{minutesAway(caravan.timer)}</strong>
        {rareNext ? ', with a rare item aboard' : ''}. Stock up on whatever it might want.
      </p>
    )
  }

  return (
    <>
      <p className="panel-hint">
        <Icon id="camel" emoji="🐫" /> In town for {Math.ceil(caravan.timer)}s — paying double for{' '}
        <strong>
          <Icon of={RESOURCES[caravan.wants]} /> {RESOURCES[caravan.wants]?.name}
        </strong>
        .
      </p>
      <RareItem run={run} amber={amber} />
      <h4 className="trade-heading">For sale</h4>
      <div className="trade-grid">
        {caravan.offers.map((offer, index) => {
          const price = offerPrice(run, index)
          return (
            <button
              key={`${offer.resource}-${index}`}
              type="button"
              className={`trade-card ${offer.prepaid ? 'is-wanted' : ''}`}
              disabled={offer.sold || amber < price}
              onClick={() => buyLot(index)}
            >
              <span>
                <Icon of={RESOURCES[offer.resource]} />
              </span>
              <strong>
                {offer.amount} {RESOURCES[offer.resource]?.name}
              </strong>
              <small>
                {offer.prepaid
                  ? offer.sold
                    ? 'Collected'
                    : 'Paid — collect'
                  : offer.sold
                    ? 'Sold'
                    : `${price} amber`}
              </small>
            </button>
          )
        })}
      </div>
    </>
  )
}

/** Selling surplus to the caravan in town, last because it lists every full lot. */
function SellLots({ run }: { run: RunState }) {
  const sell = useGameStore((s) => s.sell)
  const caravan = run.caravan
  const sellable = RESOURCE_LIST.filter(
    (r) => r.category !== 'currency' && (run.stock[r.id] ?? 0) >= TRADE_LOT,
  )
  return (
    <section className="build-group" data-testid="trade-sell">
      <h4 className="trade-heading">Sell (lots of {TRADE_LOT})</h4>
      {sellable.length === 0 && <p className="muted">Nothing in the stockpile makes a full lot.</p>}
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
    </section>
  )
}

/** The caravan's one rare blueprint or cornerstone this visit. */
function RareItem({ run, amber }: { run: RunState; amber: number }) {
  const buyRare = useGameStore((s) => s.buyRare)
  const rare = run.caravan.rare
  if (!rare) return null
  const price = rarePrice(run)
  const building = rare.kind === 'blueprint' ? BUILDINGS[rare.id] : undefined
  const stone = rare.kind === 'cornerstone' ? CORNERSTONES[rare.id] : undefined
  return (
    <>
      <h4 className="trade-heading">Rare find</h4>
      <div className="trade-rare" data-testid="trade-rare">
        <span className="trade-rare-icon">
          {building ? <Icon of={building} /> : stone ? <Icon id={cornerstoneArt(stone)} emoji={stone.icon} /> : null}
        </span>
        <div className="trade-rare-text">
          <strong>
            {rare.kind === 'blueprint' ? 'Blueprint' : 'Cornerstone'}: {rareName(rare)}
          </strong>
          {building && (
            <span className="chip-row">
              <DraftAppealChips run={run} defId={rare.id} />
            </span>
          )}
          {stone && <small className="muted">{stone.description}</small>}
        </div>
        <button
          type="button"
          className="trade-rare-buy"
          disabled={rare.sold || amber < price}
          onClick={() => buyRare()}
        >
          {rare.sold ? 'Bought' : `Buy · ${price} amber`}
        </button>
      </div>
    </>
  )
}

/** Commission a lot of any good, paid now, delivered with the next caravan. */
function Commission({ run, amber }: { run: RunState; amber: number }) {
  const commission = useGameStore((s) => s.commission)
  // Default to the service good this settlement is shortest of a way to make.
  const suggested = provisionsGood(run) ?? 'plank'
  const [picked, setPicked] = useState<ResourceId | ''>('')
  const choice = picked || suggested
  const pending = run.caravan.commission
  const price = commissionPrice(run, choice)
  return (
    <section className="build-group" data-testid="trade-commission">
      <h4 className="trade-heading">Commission a shipment</h4>
      {pending ? (
        <p className="panel-hint">
          <Icon of={RESOURCES[pending.resource]} /> {pending.amount} {RESOURCES[pending.resource]?.name}{' '}
          paid for — it comes with the next caravan
          {run.caravan.here ? '' : `, in ${minutesAway(run.caravan.timer)}`}.
        </p>
      ) : (
        <>
          <p className="muted">
            Pay now for {COMMISSION_LOT} of any good, delivered with the next caravan. Bridges a
            service until its workshop stands.
          </p>
          <div className="btn-row">
            <label className="sr-only" htmlFor="commission-good">
              Good to commission
            </label>
            <select
              id="commission-good"
              value={choice}
              onChange={(e) => setPicked(e.target.value as ResourceId)}
            >
              {COMMISSION_GOODS.map((id) => (
                <option key={id} value={id}>
                  {RESOURCES[id]?.name ?? id} — {commissionPrice(run, id)} amber
                </option>
              ))}
            </select>
            <button type="button" disabled={amber < price} onClick={() => commission(choice)}>
              <Icon of={RESOURCES[choice]} /> Commission {COMMISSION_LOT} · {price}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

/** The run's one trade agreement: three ways to bend every later caravan. */
function Agreement({ run, amber }: { run: RunState; amber: number }) {
  const sign = useGameStore((s) => s.signAgreement)
  const signed = run.caravan.agreement ? TRADE_AGREEMENTS[run.caravan.agreement] : null
  return (
    <section className="build-group" data-testid="trade-agreement">
      <h4 className="trade-heading">Trade agreement</h4>
      {signed ? (
        <p className="panel-hint">
          <span aria-hidden>{signed.icon}</span> <strong>{signed.name}</strong> signed for this run.{' '}
          {signed.description}
        </p>
      ) : (
        <>
          <p className="muted">One per run, for {AGREEMENT_PRICE} amber. It holds until the run ends.</p>
          <div className="trade-agreements">
            {TRADE_AGREEMENT_LIST.map((a) => (
              <button
                key={a.id}
                type="button"
                className="trade-card trade-agreement"
                disabled={amber < AGREEMENT_PRICE}
                onClick={() => sign(a.id)}
              >
                <span aria-hidden>{a.icon}</span>
                <strong>{a.name}</strong>
                <em>{a.description}</em>
                <small>Sign · {AGREEMENT_PRICE} amber</small>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
