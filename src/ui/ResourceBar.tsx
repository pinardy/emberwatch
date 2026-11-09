import { useEffect, useRef, useState } from 'react'
import { RESOURCES } from '../game/content/resources'
import { RUNWAY_WARNING_SECONDS, formatDuration } from '../game/engine/forecast'
import {
  complexFoodStock,
  foodStock,
  foodVariety,
  sortBag,
  storageUsed,
} from '../game/engine/queries'
import { useFrameDerived } from '../game/frameDerived'
import { useHudRun } from '../game/store'
import type { ResourceDef, ResourceId } from '../game/types'
import { Icon } from './Icon'
import { useStockTrends, type StockTrend, type StockTrends } from './stockTrends'
import { useDismiss } from './useGameLoop'

type GroupId = 'food' | 'building' | 'crafted' | 'trade'

/** Construction stock; every other material is a crafting input or part. */
const BUILDING_MATERIALS: ResourceId[] = ['wood', 'plank', 'stone', 'brick', 'clay']

/**
 * The bar's groups in reading order. Low-priority groups fold behind the
 * "All stock" disclosure on narrower bars (styles.css, resource bar), but a
 * flagged stock — falling fast, or holding up a building — always stays out.
 */
const GROUPS: { id: GroupId; label: string; priority: 'high' | 'low' }[] = [
  { id: 'food', label: 'Food', priority: 'high' },
  { id: 'building', label: 'Building materials', priority: 'high' },
  { id: 'crafted', label: 'Crafted goods & parts', priority: 'low' },
  { id: 'trade', label: 'Trade goods & amber', priority: 'low' },
]

function groupOf(def: ResourceDef | undefined): GroupId {
  if (!def) return 'crafted'
  if (def.category === 'rawFood' || def.category === 'food') return 'food'
  if (def.category === 'serviceGood' || def.category === 'currency') return 'trade'
  return BUILDING_MATERIALS.includes(def.id) ? 'building' : 'crafted'
}

interface Item {
  id: ResourceId
  amount: number
  trend?: StockTrend
  blocking?: string[]
}

/** The groups with their items: stock on hand, plus empty goods a building is waiting for. */
function groupItems(stock: [ResourceId, number][], { trends, blocking }: StockTrends) {
  const items: Item[] = stock.map(([id, amount]) => ({ id, amount }))
  for (const id of Object.keys(blocking) as ResourceId[]) {
    if (!items.some((i) => i.id === id)) items.push({ id, amount: 0 })
  }
  for (const item of items) {
    item.trend = trends[item.id]
    item.blocking = blocking[item.id]
  }
  return GROUPS.map((group) => ({
    ...group,
    items: items
      .filter((i) => groupOf(RESOURCES[i.id]) === group.id)
      // Amber first among the trade goods: it is the currency.
      .sort((a, b) => Number(b.id === 'amber') - Number(a.id === 'amber')),
  })).filter((g) => g.items.length > 0)
}

/**
 * Short names for the bar, where a flagged good shows its name beside its
 * number ("Clay 0 !"); anything not listed uses its full name.
 */
const SHORT_NAME: Partial<Record<ResourceId, string>> = {
  copperOre: 'Ore',
  copperBar: 'Copper',
  plantFiber: 'Fibre',
  pickles: 'Pickles',
  trainingGear: 'Gear',
  folio: 'Folios',
}

export function shortName(id: ResourceId): string {
  return SHORT_NAME[id] ?? RESOURCES[id]?.name ?? id
}

function isFlagged(item: Item): boolean {
  return !!item.trend?.fallingFast || !!item.blocking?.length
}

function perMinuteText(perMinute: number): string {
  const n = Math.abs(perMinute)
  return `${perMinute < 0 ? '−' : '+'}${n >= 10 ? Math.round(n) : n.toFixed(1)}/min`
}

/** One sentence for the tooltip and the drawer: amount, trend, what it holds up. */
function describeItem(item: Item): string {
  const name = RESOURCES[item.id]?.name ?? item.id
  const parts = [`${name}: ${Math.floor(item.amount)}`]
  const t = item.trend
  if (t && t.direction === 'up') parts.push(`rising ${perMinuteText(t.perMinute)}`)
  if (t && t.direction === 'down') {
    parts.push(
      `falling ${perMinuteText(t.perMinute)}${
        t.runway !== null ? ` — runs out in about ${formatDuration(t.runway)}` : ''
      }`,
    )
  }
  if (item.blocking?.length) parts.push(`holding up ${item.blocking.join(', ')}`)
  return parts.join(' · ')
}

function itemClass(item: Item): string {
  const t = item.trend
  return [
    'resource',
    t?.direction === 'up' ? 'is-rising' : '',
    t?.direction === 'down' ? 'is-falling' : '',
    t?.fallingFast ? 'is-falling-fast' : '',
    item.blocking?.length ? 'is-blocking' : '',
    isFlagged(item) ? 'is-flagged' : '',
    // Hearth fuel and the first building material: kept in view on phones.
    item.id === 'wood' ? 'is-key' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function TrendMark({ trend }: { trend?: StockTrend }) {
  if (!trend || trend.direction === 'flat') return null
  const up = trend.direction === 'up'
  return (
    <em
      role="img"
      className={`resource-trend ${up ? 'is-up' : 'is-down'}`}
      aria-label={up ? 'rising' : 'falling'}
    >
      {up ? '▲' : '▼'}
    </em>
  )
}

/**
 * The stockpile strip: the stockpile gauge, the food runway (the number that
 * matters most), then the stock grouped by what it is for, with a trend mark
 * on anything rising or falling and a flag on anything running dry or
 * holding up a building.
 */
export function ResourceBar() {
  const run = useHudRun()
  // Shared per sim step with the warnings, toasts and sound cues.
  const frame = useFrameDerived()
  const derived = frame && { blocked: frame.storageBlocked.length, food: frame.food }
  const stockTrends = useStockTrends(run)
  // The "All stock" drawer, and the good it was opened on (an alert's tap).
  const [drawer, setDrawer] = useState<{ open: boolean; focus: ResourceId | null }>({
    open: false,
    focus: null,
  })
  const host = useRef<HTMLDivElement>(null)
  useDismiss(drawer.open, host, () => setDrawer({ open: false, focus: null }))
  if (!run || !derived) return null

  const entries = sortBag(run.stock)
  const used = storageUsed(run)
  const capPct = (used / Math.max(1, run.storageCap)) * 100
  const full = used >= run.storageCap || derived.blocked > 0
  const { food } = derived
  const foodLow = !run.starving && food.runway < RUNWAY_WARNING_SECONDS
  const grouped = groupItems(entries, stockTrends)
  const flagged = grouped.reduce((n, g) => n + g.items.filter(isFlagged).length, 0)
  const runwayText = run.starving ? 'Empty' : formatDuration(food.runway)

  return (
    <div className="resource-bar" ref={host}>
      <div
        className={`storage ${full ? 'is-full is-bad' : capPct > 95 ? 'is-bad' : capPct > 80 ? 'is-warn' : ''}`}
        title={
          derived.blocked > 0
            ? `Stockpile full: ${derived.blocked} building${derived.blocked > 1 ? 's have' : ' has'} stopped with finished goods and nowhere to put them. Build a Warehouse, sell to a caravan, or pause producers. Amber does not take up space.`
            : 'Stockpile usage. Amber does not take up space.'
        }
      >
        <span aria-hidden>
          <Icon id="warehouse" emoji="📦" />
        </span>
        <span className="sr-only">Stockpile</span>
        <strong>
          {Math.floor(used)}
          <small>
            <span className="sr-only"> of </span>/{run.storageCap}
          </small>
        </strong>
        <div className="storage-track">
          <div className="storage-fill" style={{ width: `${Math.min(100, capPct)}%` }} />
        </div>
        {full && (
          <em className="storage-flag">
            Full
            {derived.blocked > 0 && (
              <span className="storage-flag-count">
                {` · ${derived.blocked}`}
                <span className="storage-flag-word"> stopped</span>
              </span>
            )}
          </em>
        )}
      </div>

      <div
        className={`storage food-summary ${run.starving ? 'is-bad' : foodLow ? 'is-warn' : ''}`}
        title={`Food in store. ${foodVariety(run)} distinct types (variety raises resolve). ${complexFoodStock(
          run,
        )} cooked meals, each worth two. The settlement eats ${(food.rate * 60).toFixed(
          1,
        )} meals a minute, so the larder lasts about ${formatDuration(
          food.runway,
        )} without new food.`}
      >
        <span aria-hidden>
          <Icon id="plate" emoji="🍽️" />
        </span>
        <span className="sr-only">Food</span>
        <strong>{Math.floor(foodStock(run))}</strong>
        <small className="food-variety">
          <span className="sr-only">, kinds </span>×{foodVariety(run)}
        </small>
        <span
          className="food-runway"
          role="img"
          aria-label={
            run.starving ? 'Food runway: the larder is empty' : `Food runway: ${runwayText}`
          }
        >
          <span aria-hidden>{run.starving || foodLow ? '⚠' : '⏱'}</span>
          <b>{runwayText}</b>
        </span>
      </div>

      <div className="resource-scroll">
        {grouped.map((group) => (
          <div
            className={`resource-group group-${group.id} is-${group.priority}`}
            key={group.id}
            role="group"
            aria-label={group.label}
            title={group.label}
          >
            {group.items.map((item) =>
              isFlagged(item) ? (
                // An alert names its good ("Clay 0 !") and opens the drawer on
                // it with a tap, where it says why.
                <button
                  type="button"
                  className={`${itemClass(item)} resource-alert`}
                  key={item.id}
                  title={describeItem(item)}
                  aria-label={`${describeItem(item)}. Show in all stock`}
                  aria-controls="stock-drawer"
                  aria-expanded={drawer.open && drawer.focus === item.id}
                  onClick={() =>
                    setDrawer((d) =>
                      d.open && d.focus === item.id
                        ? { open: false, focus: null }
                        : { open: true, focus: item.id },
                    )
                  }
                >
                  <span aria-hidden>
                    <Icon of={RESOURCES[item.id]} />
                  </span>
                  <span className="resource-name" aria-hidden>
                    {shortName(item.id)}
                  </span>
                  <strong aria-hidden>{Math.floor(item.amount)}</strong>
                  <TrendMark trend={item.trend} />
                  <em className="resource-flag" aria-hidden>
                    !
                  </em>
                </button>
              ) : (
                <div className={itemClass(item)} key={item.id} title={describeItem(item)}>
                  <span aria-hidden>
                    <Icon of={RESOURCES[item.id]} />
                  </span>
                  {/* Read as "Wood 120", not a bare number. */}
                  <span className="sr-only">{RESOURCES[item.id]?.name ?? item.id} </span>
                  <strong>{Math.floor(item.amount)}</strong>
                  <TrendMark trend={item.trend} />
                </div>
              ),
            )}
          </div>
        ))}
        {entries.length === 0 && <span className="muted">The stockpile is empty.</span>}
      </div>

      {entries.length > 0 && (
        <StockDrawer
          groups={grouped}
          count={entries.length}
          flagged={flagged}
          open={drawer.open}
          focus={drawer.focus}
          onToggle={() => setDrawer((d) => ({ open: !d.open, focus: null }))}
        />
      )}
    </div>
  )
}

/**
 * "All stock": every group in full, with names, trends and what each empty
 * good is holding up. On narrow bars it is where the folded groups live.
 */
function StockDrawer({
  groups,
  count,
  flagged,
  open,
  focus,
  onToggle,
}: {
  groups: ReturnType<typeof groupItems>
  count: number
  flagged: number
  open: boolean
  /** The good an alert opened the drawer on: marked and scrolled to. */
  focus: ResourceId | null
  onToggle: () => void
}) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || !focus) return
    const row = list.current?.querySelector<HTMLElement>(`[data-good="${focus}"]`)
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [open, focus])
  const label = `All stock: ${count} goods${flagged > 0 ? `, ${flagged} need attention` : ''}`

  return (
    <div className="resource-more-anchor">
      <button
        type="button"
        className={`resource-more ${open ? 'is-open' : ''} ${flagged > 0 ? 'is-flagged' : ''}`}
        aria-expanded={open}
        aria-controls="stock-drawer"
        aria-label={label}
        title={label}
        onClick={onToggle}
      >
        <span className="resource-more-label" aria-hidden>
          <span className="resource-more-long">All stock</span>
          <span className="resource-more-short">Stock</span>
        </span>
        <span className="resource-more-count" aria-hidden>
          {count}
        </span>
        <span className="resource-more-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div id="stock-drawer" className="stock-drawer" role="group" aria-label="All stock" ref={list}>
          {groups.map((group) => (
            <section key={group.id} className="stock-drawer-group">
              <h2>{group.label}</h2>
              <ul>
                {group.items.map((item) => {
                  const t = item.trend
                  return (
                    <li
                      key={item.id}
                      className={`${itemClass(item)} ${focus === item.id ? 'is-focus' : ''}`}
                      data-good={item.id}
                    >
                      <span className="stock-drawer-icon">
                        <Icon of={RESOURCES[item.id]} />
                      </span>
                      <span className="stock-drawer-name">
                        {RESOURCES[item.id]?.name ?? item.id}
                      </span>
                      <strong>{Math.floor(item.amount)}</strong>
                      <small className="stock-drawer-trend">
                        {t ? (t.direction !== 'flat' ? perMinuteText(t.perMinute) : 'steady') : ''}
                        {t?.fallingFast && t.runway !== null
                          ? ` · dry in ${formatDuration(t.runway)}`
                          : ''}
                      </small>
                      {item.blocking?.length ? (
                        <small className="stock-drawer-blocking">
                          Holding up {item.blocking.join(', ')}
                        </small>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
