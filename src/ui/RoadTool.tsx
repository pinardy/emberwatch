import { RESOURCES } from '../game/content/resources'
import { ROAD_MAX_LENGTH, ROAD_WOOD_PER_UNIT, ROAD_WORK_BONUS } from '../game/engine/balance'
import { ROAD_TOOL } from '../game/engine/roads'
import { useGameStore, useRun } from '../game/store'

/**
 * The road tool's controls: its card in the build panel and the banner shown
 * while it is in hand. Laying works the same with a mouse or a finger — each
 * click (or confirmed tap) adds a bend, and the road joins whatever it ends on.
 */

export function RoadCard() {
  const run = useRun()
  const active = useGameStore((s) => s.buildMode === ROAD_TOOL)
  if (!run) return null
  const roads = run.roads?.length ?? 0
  return (
    <section className="build-group">
      <h3>Roads</h3>
      <div className="build-list">
        <button
          type="button"
          className={`build-card ${active ? 'is-active' : ''}`}
          aria-pressed={active}
          onClick={() => useGameStore.getState().setBuildMode(active ? null : ROAD_TOOL)}
        >
          <span className="build-icon" aria-hidden>
            🛤️
          </span>
          <span className="build-main">
            <strong>Road</strong>
            <span className="build-cost">
              <span title={RESOURCES.wood.name}>
                {RESOURCES.wood.icon} {ROAD_WOOD_PER_UNIT} per pace
              </span>
            </span>
            <small>
              Join workplaces to the hearth or a warehouse: up to +{ROAD_WORK_BONUS}% work, less
              for a winding road. Villagers walk along them too.
            </small>
            <span className="build-tags">
              <em>Laid at once</em>
              {roads > 0 && <em>🛤️ {roads} laid</em>}
            </span>
          </span>
        </button>
      </div>
    </section>
  )
}

export function RoadBanner() {
  const anchor = useGameStore((s) => s.roadAnchor)
  const erase = useGameStore((s) => s.roadErase)
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const tap = touch ? 'tap' : 'click'
  let text: string
  if (erase) text = `${tap} a road to lift it — its wood comes back`
  else if (!anchor) text = `${tap} where the road starts — a building, a road, or open ground`
  else {
    text = `${tap} the next bend (up to ${ROAD_MAX_LENGTH} paces) · ${
      touch ? 'Done' : 'right-click, Esc or Done'
    } ends the road`
  }
  const store = useGameStore.getState
  return (
    <div className="build-banner road-banner">
      <span>
        <strong>{erase ? 'Lifting roads' : 'Laying a road'}</strong> — {text}
      </span>
      {anchor && !erase && (
        <button type="button" onClick={() => store().endRoad()}>
          Done
        </button>
      )}
      <button type="button" aria-pressed={erase} onClick={() => store().setRoadErase(!erase)}>
        {erase ? 'Lay roads' : 'Lift roads'}
      </button>
      <button type="button" onClick={() => store().setBuildMode(null)}>
        Close
      </button>
    </div>
  )
}
