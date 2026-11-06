/**
 * Tiny drawing vocabulary for the icon set. Every helper returns SVG path
 * data on the 24×24 icon grid, so an icon is nothing but a list of paths:
 * the DOM, the 2D map's `<symbol>`s and the 3D map's canvas (via `Path2D`)
 * all draw the same strings.
 */

/** A 2D affine matrix `[a, b, c, d, e, f]`, as in SVG's `matrix()`. */
export type Matrix = readonly [number, number, number, number, number, number]

/** `a` applied after `b`. */
export function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

export function translate(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y]
}

/** Uniform scale about a point (the grid centre by default). */
export function scaleAbout(s: number, cx = 12, cy = 12): Matrix {
  return [s, 0, 0, s, cx - s * cx, cy - s * cy]
}

export function rotateAbout(deg: number, cx = 12, cy = 12): Matrix {
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy]
}

/** Mirror across the vertical line `x = cx`. */
export function mirrorX(cx = 12): Matrix {
  return [-1, 0, 0, 1, 2 * cx, 0]
}

const n = (v: number) => String(Math.round(v * 100) / 100)

export function circle(cx: number, cy: number, r: number): string {
  return ellipse(cx, cy, r, r)
}

export function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0Z`
}

export function rect(x: number, y: number, w: number, h: number, r = 0): string {
  if (r <= 0) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`
  const k = Math.min(r, w / 2, h / 2)
  return (
    `M${n(x + k)} ${n(y)}h${n(w - 2 * k)}a${n(k)} ${n(k)} 0 0 1 ${n(k)} ${n(k)}` +
    `v${n(h - 2 * k)}a${n(k)} ${n(k)} 0 0 1 ${n(-k)} ${n(k)}` +
    `h${n(-(w - 2 * k))}a${n(k)} ${n(k)} 0 0 1 ${n(-k)} ${n(-k)}` +
    `v${n(-(h - 2 * k))}a${n(k)} ${n(k)} 0 0 1 ${n(k)} ${n(-k)}Z`
  )
}

/** Closed polygon through `x0, y0, x1, y1, …`. */
export function poly(...pts: number[]): string {
  const parts: string[] = []
  for (let i = 0; i < pts.length; i += 2) parts.push(`${n(pts[i])} ${n(pts[i + 1])}`)
  return `M${parts.join('L')}Z`
}

/** A cog: `teeth` flat-topped teeth between radii `inner` and `outer`. */
export function gear(cx: number, cy: number, outer: number, inner: number, teeth: number): string {
  const step = (Math.PI * 2) / teeth
  const pts: number[] = []
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2
    for (const [r, da] of [
      [inner, -step * 0.36],
      [outer, -step * 0.2],
      [outer, step * 0.2],
      [inner, step * 0.36],
    ] as const) {
      pts.push(cx + r * Math.cos(a + da), cy + r * Math.sin(a + da))
    }
  }
  return poly(...pts)
}

/** Many-pointed burst (sun rays, sparkles). */
export function rays(cx: number, cy: number, r0: number, r1: number, count: number, offset = 0): string {
  const parts: string[] = []
  for (let i = 0; i < count; i++) {
    const a = ((i + offset) / count) * Math.PI * 2
    parts.push(
      `M${n(cx + r0 * Math.cos(a))} ${n(cy + r0 * Math.sin(a))}L${n(cx + r1 * Math.cos(a))} ${n(cy + r1 * Math.sin(a))}`,
    )
  }
  return parts.join('')
}
