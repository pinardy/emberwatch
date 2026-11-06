import type { Obstacle } from '../game/types'
import type { District } from './mapShared'

/**
 * 2D map art: every building stands on a plate whose silhouette and tint say
 * what kind of building it is, so a grown settlement reads as districts — a
 * terracotta row of homes, green camps on the forest edge, the copper glow of
 * the workshops — instead of a field of identical discs. The building's own
 * icon sits on top; the plate is sized by the building's footprint.
 *
 * Plates are plain path strings centred on (0, 0) for a footprint radius `r`
 * in SVG units, so the map can stamp them with a translate and the villager
 * canvas can reuse the same outline to tuck walkers under the roofs.
 */

export interface DistrictStyle {
  /** Short name for titles and the legend. */
  label: string
  /** Plate fill: a deep tint, so the icon on top keeps its contrast. */
  fill: string
  /** Plate edge: the district's colour at full strength. */
  edge: string
}

export const DISTRICT_STYLE: Record<District, DistrictStyle> = {
  hearth: { label: 'Hearth', fill: '#4a2c12', edge: '#f0b44c' },
  fire: { label: 'Fire', fill: '#47200e', edge: '#ff9640' },
  housing: { label: 'Housing', fill: '#3f2a1b', edge: '#dc9a5c' },
  camp: { label: 'Gathering camp', fill: '#1d3523', edge: '#7cc46e' },
  farm: { label: 'Farm', fill: '#38341a', edge: '#e2cb5c' },
  industry: { label: 'Workshop', fill: '#3d2218', edge: '#e2703f' },
  service: { label: 'Service', fill: '#2c2240', edge: '#b48ae0' },
  storage: { label: 'Storage & trade', fill: '#1a2a3a', edge: '#6aa8dc' },
}

export interface PlateShape {
  /** Outline, centred on (0, 0). */
  d: string
  /** Optional inner detail (furrows, barn braces), drawn faintly. */
  detail?: string
  /** Lowest point of the outline below the centre (labels go beneath). */
  bottom: number
  /** Highest point above the centre (bars go above). */
  top: number
  /** Where the icon sits, relative to the centre (a house's door, not its roof). */
  iconDy: number
  /** Icon size relative to `r`. */
  iconScale: number
}

const n = (v: number) => Math.round(v * 10) / 10

function polygon(points: [number, number][], r: number): string {
  return `M${points.map(([x, y]) => `${n(x * r)} ${n(y * r)}`).join('L')}Z`
}

/** A star / sunburst with `count` points between radii `outer` and `inner`. */
function burst(count: number, outer: number, inner: number, r: number, turn = 0): string {
  const pts: [number, number][] = []
  for (let i = 0; i < count * 2; i++) {
    const a = turn + (i / (count * 2)) * Math.PI * 2 - Math.PI / 2
    const k = i % 2 === 0 ? outer : inner
    pts.push([Math.cos(a) * k, Math.sin(a) * k])
  }
  return polygon(pts, r)
}

function regular(count: number, radius: number, r: number, turn: number): string {
  const pts: [number, number][] = []
  for (let i = 0; i < count; i++) {
    const a = turn + (i / count) * Math.PI * 2
    pts.push([Math.cos(a) * radius, Math.sin(a) * radius])
  }
  return polygon(pts, r)
}

function roundedRect(hw: number, hh: number, rx: number, r: number): string {
  const [w, h, c] = [n(hw * r), n(hh * r), n(rx * r)]
  return (
    `M${-w + c} ${-h}H${w - c}Q${w} ${-h} ${w} ${-h + c}V${h - c}Q${w} ${h} ${w - c} ${h}` +
    `H${-w + c}Q${-w} ${h} ${-w} ${h - c}V${-h + c}Q${-w} ${-h} ${-w + c} ${-h}Z`
  )
}

const plateCache = new Map<string, PlateShape>()

/** The plate outline for a district at footprint radius `r` (SVG units). */
export function plateShape(district: District, r: number): PlateShape {
  const cacheKey = `${district}:${r}`
  const hit = plateCache.get(cacheKey)
  if (hit) return hit
  let shape: PlateShape
  switch (district) {
    case 'hearth':
      shape = { d: burst(12, 1.12, 0.9, r), bottom: 1.12 * r, top: 1.12 * r, iconDy: 0, iconScale: 1.15 }
      break
    case 'fire':
      shape = { d: burst(8, 1.25, 0.85, r), bottom: 1.25 * r, top: 1.25 * r, iconDy: 0, iconScale: 1.5 }
      break
    case 'housing':
      // A cottage: walls, a pitched roof.
      shape = {
        d: polygon([[-0.92, 0.88], [0.92, 0.88], [0.92, -0.18], [0, -1.08], [-0.92, -0.18]], r),
        bottom: 0.88 * r,
        top: 1.08 * r,
        iconDy: 0.06 * r,
        iconScale: 1.15,
      }
      break
    case 'camp':
      // A pointy-topped hexagon: a lean-to on the forest edge.
      shape = { d: regular(6, 1.08, r, -Math.PI / 2), bottom: 1.08 * r, top: 1.08 * r, iconDy: 0, iconScale: 1.1 }
      break
    case 'farm':
      // A square field with furrows.
      shape = {
        d: roundedRect(0.92, 0.92, 0.18, r),
        detail: [-0.5, 0, 0.5]
          .map((x) => `M${n((x - 0.25) * r)} ${n(0.8 * r)}L${n((x + 0.25) * r)} ${n(-0.8 * r)}`)
          .join(''),
        bottom: 0.92 * r,
        top: 0.92 * r,
        iconDy: 0,
        iconScale: 1.05,
      }
      break
    case 'industry':
      // A sawtooth workshop roof.
      shape = {
        d: polygon(
          [[-0.95, 0.85], [0.95, 0.85], [0.95, -0.98], [0.32, -0.5], [0.32, -0.98], [-0.32, -0.5], [-0.32, -0.98], [-0.95, -0.5]],
          r,
        ),
        bottom: 0.85 * r,
        top: 0.98 * r,
        iconDy: 0.12 * r,
        iconScale: 1.05,
      }
      break
    case 'service':
      // An octagonal hall.
      shape = { d: regular(8, 1.04, r, Math.PI / 8), bottom: 0.96 * r, top: 0.96 * r, iconDy: 0, iconScale: 1.15 }
      break
    case 'storage':
      // A long barn with braced doors.
      shape = {
        d: roundedRect(1.08, 0.74, 0.12, r),
        detail: `M${n(-0.8 * r)} ${n(-0.5 * r)}L${n(-0.45 * r)} ${n(0.5 * r)}M${n(-0.45 * r)} ${n(-0.5 * r)}L${n(-0.8 * r)} ${n(0.5 * r)}M${n(0.8 * r)} ${n(-0.5 * r)}L${n(0.45 * r)} ${n(0.5 * r)}M${n(0.45 * r)} ${n(-0.5 * r)}L${n(0.8 * r)} ${n(0.5 * r)}`,
        bottom: 0.74 * r,
        top: 0.74 * r,
        iconDy: 0,
        iconScale: 1.0,
      }
      break
  }
  plateCache.set(cacheKey, shape)
  return shape
}

/** What an obstacle is, and what the player can do about it. */
export function obstacleTitle(kind: Obstacle['kind']): string {
  return kind === 'mire'
    ? 'Mire — sodden, sucking bog. It can never be drained or cleared: place buildings and roads around it.'
    : 'Crag — bare bedrock. It can never be cleared: place buildings and roads around it.'
}
