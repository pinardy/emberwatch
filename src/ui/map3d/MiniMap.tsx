import { useEffect, useState } from 'react'
import type { MapControls as MapControlsImpl } from 'three-stdlib'
import { TERRAIN_COLORS } from '../../game/engine/mapgen'
import { useGameStore } from '../../game/store'
import type { RunState } from '../../game/types'

const WIDTH_PX = 168

/**
 * Corner minimap: the whole world at a glance, with the camera's focus and
 * facing. Clicking jumps the camera there. Redraws with the sim tick; the
 * camera indicator polls the controls a few times a second.
 */
export function MiniMap({
  run,
  controls,
}: {
  run: RunState
  controls: React.MutableRefObject<MapControlsImpl | null>
}) {
  const [cam, setCam] = useState({ x: 0, z: 0, deg: 0 })

  useEffect(() => {
    const id = window.setInterval(() => {
      const c = controls.current
      if (!c) return
      const ox = c.object.position.x - c.target.x
      const oz = c.object.position.z - c.target.z
      const next = {
        x: c.target.x,
        z: c.target.z,
        deg: (Math.atan2(ox, oz) * 180) / Math.PI,
      }
      setCam((prev) =>
        Math.abs(prev.x - next.x) < 0.05 &&
        Math.abs(prev.z - next.z) < 0.05 &&
        Math.abs(prev.deg - next.deg) < 1
          ? prev
          : next,
      )
    }, 150)
    return () => window.clearInterval(id)
  }, [controls])

  const { width: w, height: h } = run.world
  const heightPx = Math.round((WIDTH_PX * h) / w)

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    useGameStore.getState().focusCamera({
      x: ((e.clientX - rect.left) / rect.width) * w - w / 2,
      y: ((e.clientY - rect.top) / rect.height) * h - h / 2,
    })
  }

  return (
    <svg
      className="minimap"
      width={WIDTH_PX}
      height={heightPx}
      viewBox={`${-w / 2} ${-h / 2} ${w} ${h}`}
      onClick={onClick}
      role="img"
      aria-label="Minimap"
    >
      <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="#0a0e11" />
      {Object.values(run.glades).map((glade) => (
        <polygon
          key={glade.id}
          points={glade.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
          fill={
            glade.cleared
              ? TERRAIN_COLORS[glade.terrain]
              : glade.discovered
                ? '#1a2320'
                : '#0e1418'
          }
          stroke="rgba(0, 0, 0, 0.5)"
          strokeWidth={0.15}
        />
      ))}
      {Object.values(run.buildings).map((b) => (
        <circle
          key={b.id}
          cx={b.pos.x}
          cy={b.pos.y}
          r={b.defId === 'ancientHearth' ? 0.6 : 0.35}
          fill={b.defId === 'ancientHearth' ? '#ffab52' : '#e6c37c'}
        />
      ))}
      {run.threats.map((threat) => {
        const glade = run.glades[threat.gladeId]
        if (!glade) return null
        return (
          <text
            key={threat.id}
            x={glade.center.x}
            y={glade.center.y + 0.9}
            textAnchor="middle"
            fontSize={2.6}
          >
            ⚠
          </text>
        )
      })}
      {/* The camera: a wedge at its focus, opening the way it looks. */}
      <g transform={`translate(${cam.x} ${cam.z}) rotate(${-cam.deg})`}>
        <path
          d="M0 0 L-1.5 -3 L1.5 -3 Z"
          fill="rgba(217, 180, 106, 0.45)"
          stroke="#d9b46a"
          strokeWidth={0.2}
        />
      </g>
    </svg>
  )
}
