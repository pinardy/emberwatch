import { RESOURCES } from '../game/content/resources'
import { RUNWAY_WARNING_SECONDS, formatDuration } from '../game/engine/forecast'
import {
  complexFoodStock,
  foodStock,
  foodVariety,
  sortBag,
  storageUsed,
} from '../game/engine/queries'
import { useFrameDerived, useHudRun } from '../game/store'
import type { ResourceCategory } from '../game/types'
import { Icon } from './Icon'

const CATEGORY_ORDER: ResourceCategory[] = [
  'material',
  'rawFood',
  'food',
  'serviceGood',
  'currency',
]

/**
 * The stockpile strip. Groups by category so the eye can find "do I have
 * planks?" without scanning thirty icons.
 */
export function ResourceBar() {
  const run = useHudRun()
  // Shared per sim step with the warnings, toasts and sound cues.
  const frame = useFrameDerived()
  const derived = frame && { blocked: frame.storageBlocked.length, food: frame.food }
  if (!run || !derived) return null

  const entries = sortBag(run.stock)
  const used = storageUsed(run)
  const capPct = (used / Math.max(1, run.storageCap)) * 100
  const full = used >= run.storageCap || derived.blocked > 0
  const { food } = derived
  const foodLow = !run.starving && food.runway < RUNWAY_WARNING_SECONDS
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: entries.filter(([id]) => RESOURCES[id]?.category === category),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="resource-bar">
      <div
        className={`storage ${full ? 'is-full is-bad' : capPct > 95 ? 'is-bad' : capPct > 80 ? 'is-warn' : ''}`}
        title={
          derived.blocked > 0
            ? `Stockpile full: ${derived.blocked} building${derived.blocked > 1 ? 's have' : ' has'} stopped with finished goods and nowhere to put them. Build a Warehouse, sell to a caravan, or pause producers. Amber does not take up space.`
            : 'Stockpile usage. Amber does not take up space.'
        }
      >
        <span>
          <Icon id="warehouse" emoji="📦" />
        </span>
        <strong>
          {Math.floor(used)}
          <small>/{run.storageCap}</small>
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
        <span>
          <Icon id="plate" emoji="🍽️" />
        </span>
        <strong>{Math.floor(foodStock(run))}</strong>
        <small>×{foodVariety(run)}</small>
        <small className="food-runway">
          {run.starving || foodLow ? '⚠ ' : '⏱ '}
          {run.starving ? 'empty' : formatDuration(food.runway)}
        </small>
      </div>

      <div className="resource-scroll">
        {grouped.map((group) => (
          <div className="resource-group" key={group.category}>
            {group.items.map(([id, amount]) => (
              <div className="resource" key={id} title={RESOURCES[id]?.name}>
                <span>
                  <Icon of={RESOURCES[id]} />
                </span>
                <strong>{Math.floor(amount)}</strong>
              </div>
            ))}
          </div>
        ))}
        {entries.length === 0 && <span className="muted">The stockpile is empty.</span>}
      </div>
    </div>
  )
}
