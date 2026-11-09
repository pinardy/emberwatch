import { memo } from 'react'
import { BUILDINGS } from '../game/content/buildings'
import { ROAD_TOOL } from '../game/engine/roads'
import { useGameStore } from '../game/store'
import { IconUse } from './Icon'
import { COLD_BADGE, STATUS_BADGE, type MapBuildingStatus } from './mapShared'
import { DISTRICT_STYLE, plateShape } from './map2dArt'
import {
  S,
  setHoveredBuilding,
  useBuildingViews2D,
  useHoveredBuilding,
  useMapInteraction,
  type BuildingView2D,
} from './map2dState'

/** Smallest icon on the 2D map, in SVG units (the old emoji were 18px text). */
export const MAP_ICON = 22

/**
 * Every building on the 2D map. The layer re-renders when the building views
 * change (placement, crews, status, quantised progress — see
 * `useBuildingViews2D`) and each building is two memoised leaves whose props
 * are primitives, so a status change on one camp re-renders that camp alone.
 * Plates go down first and every badge, crew count and bar after them, so a
 * neighbour's roof never hides a building's status.
 */
export const BuildingLayer2D = memo(function BuildingLayer2D() {
  const views = useBuildingViews2D()
  const selected = useGameStore((s) => s.selectedBuilding)
  const hovered = useHoveredBuilding((s) => s.id)
  return (
    <>
      <g className="buildings-2d">
        {views.map((v) => (
          <BuildingNode2D
            key={v.id}
            id={v.id}
            defId={v.defId}
            district={v.district}
            x={v.x}
            y={v.y}
            r={v.r}
            name={v.name}
            built={v.built}
            selected={selected === v.id}
          />
        ))}
      </g>
      <g className="building-marks-2d" pointerEvents="none">
        {views.map((v) => (
          <BuildingMarks2D key={v.id} {...v} hot={v.id === selected || v.id === hovered} />
        ))}
      </g>
    </>
  )
})

interface PlateProps {
  id: string
  defId: string
  district: BuildingView2D['district']
  x: number
  y: number
  r: number
  name: string
  built: boolean
  selected: boolean
}

/** The building itself: its district plate and icon. Clickable. */
const BuildingNode2D = memo(function BuildingNode2D({ id, defId, district, x, y, r, name, built, selected }: PlateProps) {
  const interaction = useMapInteraction()
  const def = BUILDINGS[defId]
  if (!def) return null
  const plate = plateShape(district, r)
  const style = DISTRICT_STYLE[district]
  return (
    <g
      className={`building is-${district} ${selected ? 'is-selected' : ''} ${built ? '' : 'is-site'}`}
      transform={`translate(${x} ${y})`}
      data-building={id}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') setHoveredBuilding(id)
      }}
      onPointerLeave={() => {
        if (useHoveredBuilding.getState().id === id) setHoveredBuilding(null)
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (interaction.consumeSuppressedClick()) return
        // The road tool runs roads to (and from) buildings.
        const state = useGameStore.getState()
        if (state.buildMode === ROAD_TOOL) {
          const at = state.run?.buildings[id]?.pos
          state.place(interaction.toWorld(e) ?? at ?? { x: x / S, y: y / S })
          return
        }
        state.selectBuilding(id)
      }}
    >
      <title>{`${name} — ${style.label}${built ? '' : ' (under construction)'}`}</title>
      <path d={plate.d} className="building-shadow" transform="translate(1.5 2.5)" />
      <path d={plate.d} className="building-plate" fill={style.fill} stroke={style.edge} />
      {plate.detail && <path d={plate.detail} className="building-detail" stroke={style.edge} />}
      {def.art ? (
        <IconUse id={def.art} x={0} y={plate.iconDy} size={Math.max(MAP_ICON, r * plate.iconScale)} />
      ) : (
        <text className="hex-icon" x={0} y={6}>
          {def.icon}
        </text>
      )}
    </g>
  )
})

/** What the building is doing: badges, crew, construction and upgrade bars. */
const BuildingMarks2D = memo(function BuildingMarks2D(props: BuildingView2D & { hot: boolean }) {
  const { district, x, y, r, name, built, progress, workers, slots, status, cold, tier, upgrade, road, crewCall, hot } =
    props
  const plate = plateShape(district, r)
  const top = -plate.top
  const bottom = plate.bottom
  const barWidth = Math.max(34, r * 1.7)
  const short = built && slots > 0 && workers < slots
  // Full strength only where an idle villager could go, or on the building
  // selected or under the mouse; every other crew count is dimmed, not hidden.
  return (
    <g className={`building-marks is-${district}`} transform={`translate(${x} ${y})`} data-marks={props.id}>
      {!built && (
        <g className="build-progress">
          <rect x={-barWidth / 2} y={bottom + 4} width={barWidth} height={6} rx={3} className="build-bar-bg" />
          <rect
            x={-barWidth / 2}
            y={bottom + 4}
            width={barWidth * Math.min(1, progress)}
            height={6}
            rx={3}
            className="build-bar"
          />
        </g>
      )}
      {built && slots > 0 && (
        <text
          className={`worker-count ${short ? 'is-short' : ''} ${crewCall || hot ? '' : 'is-quiet'}`}
          x={0}
          y={bottom + 14}
        >
          {workers}/{slots}
        </text>
      )}
      {tier > 0 && (
        <text className="tier-mark" x={r * 0.95} y={bottom + 2}>
          <title>{`${name} — tier ${tier}`}</title>
          {'★'.repeat(tier)}
        </text>
      )}
      {upgrade >= 0 && (
        <g className="upgrade-bar-2d">
          <title>{`Upgrading — ${Math.floor(upgrade * 100)}%`}</title>
          <rect x={-barWidth / 2} y={top - 10} width={barWidth} height={5} rx={2.5} className="build-bar-bg" />
          <rect x={-barWidth / 2} y={top - 10} width={barWidth * upgrade} height={5} rx={2.5} className="upgrade-bar" />
          <IconUse id="upArrow" x={-barWidth / 2 - 7} y={top - 7.5} size={10} />
        </g>
      )}
      {road >= 0 && (
        <g className="road-link-2d">
          <title>{`On the road: +${road}% work`}</title>
          <circle cx={-r * 0.9} cy={bottom - 3} r={6.5} />
          <IconUse id="mono/road" x={-r * 0.9} y={bottom - 3} size={9} />
        </g>
      )}
      <StatusBadge2D status={status} x={r * 0.88} y={top + 4} />
      {cold && (
        <g className="status-badge is-cold">
          <title>{district === 'fire' ? 'The fire has gone out' : 'Cold — beyond every fire'}</title>
          <circle cx={-r * 0.88} cy={top + 4} r={8.5} fill={COLD_BADGE.color} className="badge-ring" />
          <IconUse id={COLD_BADGE.art} x={-r * 0.88} y={top + 4} size={12} />
        </g>
      )}
    </g>
  )
})

/** White glyph on a coloured disc: what the building is (not) doing. */
function StatusBadge2D({ status, x, y }: { status: MapBuildingStatus; x: number; y: number }) {
  if (status === 'none') return null
  const badge = STATUS_BADGE[status]
  const small = status === 'working'
  return (
    <g className={`status-badge is-${status}`}>
      <title>{badge.label}</title>
      <circle cx={x} cy={y} r={small ? 4.5 : 9.5} fill={badge.color} className="badge-ring" />
      {!small && <IconUse id={badge.art} x={x} y={y} size={13} />}
    </g>
  )
}

