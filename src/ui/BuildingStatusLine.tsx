import { RESOURCES } from '../game/content/resources'
import { buildingStatus, type BuildingStatus } from '../game/engine/forecast'
import type { Modifiers } from '../game/engine/modifiers'
import type { BuildingInstance, RunState } from '../game/types'
import { IconText } from './IconText'

/**
 * One line saying whether a building is working and, if not, exactly what is
 * holding it — the missing goods and amounts, a full stockpile, an empty
 * crew. A full progress bar alone cannot tell "about to finish" from "stuck".
 */
export function BuildingStatusLine({
  run,
  building,
  mods,
}: {
  run: RunState
  building: BuildingInstance
  mods: Modifiers
}) {
  const status = buildingStatus(run, building, mods)
  const text = describeStatus(status)
  if (!text) return null
  return (
    <p className={`building-status is-${status.kind}`} role="status">
      <IconText text={text} />
    </p>
  )
}

function describeStatus(status: BuildingStatus): string | null {
  switch (status.kind) {
    case 'working':
      return `● Working — ${status.rate.toFixed(2)} work/s, one batch every ${status.batchSeconds.toFixed(1)}s.`
    case 'noWorkers':
      return '○ No workers — assign a villager to start.'
    case 'waitingInputs': {
      const goods = status.missing
        .map(([id, amount]) => `${amount} ${RESOURCES[id]?.icon ?? ''} ${RESOURCES[id]?.name ?? id}`)
        .join(', ')
      return status.held
        ? `⏳ Waiting for ${goods}.`
        : `⏳ Will be waiting for ${goods} when this batch is done.`
    }
    case 'storageFull':
      return status.held
        ? '📦 Stockpile full — the finished batch has nowhere to go.'
        : '📦 Stockpile full — this batch will have nowhere to go.'
    case 'noDeposit':
      return '⛏ No deposit in range for this recipe.'
    case 'paused':
      return '⏸ Paused.'
    case 'offSeason':
      return '⛈️ Off-season — this building produces nothing during the Storm.'
    case 'construction':
    case 'none':
      return null
  }
}
