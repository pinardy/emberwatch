import { RESOURCES } from '../game/content/resources'
import {
  complexFoodStock,
  foodStock,
  foodVariety,
  sortBag,
  storageUsed,
} from '../game/engine/queries'
import { useRun } from '../game/store'
import type { ResourceCategory } from '../game/types'

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
  const run = useRun()
  if (!run) return null

  const entries = sortBag(run.stock)
  const used = storageUsed(run)
  const capPct = (used / Math.max(1, run.storageCap)) * 100
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: entries.filter(([id]) => RESOURCES[id]?.category === category),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="resource-bar">
      <div
        className={`storage ${capPct > 95 ? 'is-bad' : capPct > 80 ? 'is-warn' : ''}`}
        title="Stockpile usage. Amber does not take up space."
      >
        <span>📦</span>
        <strong>
          {Math.floor(used)}
          <small>/{run.storageCap}</small>
        </strong>
        <div className="storage-track">
          <div className="storage-fill" style={{ width: `${Math.min(100, capPct)}%` }} />
        </div>
      </div>

      <div
        className={`storage food-summary ${run.starving ? 'is-bad' : ''}`}
        title={`Food in store. ${foodVariety(run)} distinct types (variety raises resolve). ${complexFoodStock(
          run,
        )} cooked meals, each worth two.`}
      >
        <span>🍽️</span>
        <strong>{Math.floor(foodStock(run))}</strong>
        <small>×{foodVariety(run)}</small>
      </div>

      <div className="resource-scroll">
        {grouped.map((group) => (
          <div className="resource-group" key={group.category}>
            {group.items.map(([id, amount]) => (
              <div className="resource" key={id} title={RESOURCES[id]?.name}>
                <span>{RESOURCES[id]?.icon}</span>
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
