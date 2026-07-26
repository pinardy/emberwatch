import type { Hex } from '../types'

/**
 * Axial ("pointy-top") hex helpers. The map is small enough that we key tiles
 * by string and look them up in a plain record.
 */

export const HEX_DIRECTIONS: Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

export function hexKey(q: number, r: number): string {
  return `${q},${r}`
}

export function parseHexKey(key: string): Hex {
  const [q, r] = key.split(',').map(Number)
  return { q, r }
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r
}

export function hexNeighbors(h: Hex): Hex[] {
  return HEX_DIRECTIONS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }))
}

export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr))
}

/** All hexes within `radius` of the origin, ring by ring. */
export function hexesInRadius(center: Hex, radius: number): Hex[] {
  const out: Hex[] = []
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius)
    const rMax = Math.min(radius, -q + radius)
    for (let r = rMin; r <= rMax; r++) {
      out.push({ q: center.q + q, r: center.r + r })
    }
  }
  return out
}

/** Pixel centre for a pointy-top hex of the given size (circumradius). */
export function hexToPixel(h: Hex, size: number): { x: number; y: number } {
  const x = size * Math.sqrt(3) * (h.q + h.r / 2)
  const y = size * 1.5 * h.r
  return { x, y }
}

/** Inverse of `hexToPixel`, rounded to the nearest hex. */
export function pixelToHex(x: number, y: number, size: number): Hex {
  const r = (y * 2) / 3 / size
  const q = x / (size * Math.sqrt(3)) - r / 2
  return hexRound(q, r)
}

function hexRound(qf: number, rf: number): Hex {
  const sf = -qf - rf
  let q = Math.round(qf)
  let r = Math.round(rf)
  const s = Math.round(sf)
  const dq = Math.abs(q - qf)
  const dr = Math.abs(r - rf)
  const ds = Math.abs(s - sf)
  if (dq > dr && dq > ds) q = -r - s
  else if (dr > ds) r = -q - s
  return { q, r }
}

/** SVG polygon points for a pointy-top hex centred at (cx, cy). */
export function hexCorners(cx: number, cy: number, size: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30)
    pts.push(
      `${(cx + size * Math.cos(angle)).toFixed(2)},${(cy + size * Math.sin(angle)).toFixed(2)}`,
    )
  }
  return pts.join(' ')
}
