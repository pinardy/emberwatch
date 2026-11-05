import { mul, poly, rect, rotateAbout, translate, type Matrix } from './geometry'

/**
 * The drawing kit shared by every icon module: the palette, the shape type,
 * a few helpers and the motifs several icons reuse.
 *
 * Emberwatch's hand-drawn icon set: every resource, building, species,
 * service need, HUD meter, season, map deposit and glade kind, drawn as path
 * data on a 24×24 grid. There are no image files — the same paths render as
 * inline SVG in the UI, as `<symbol>`s on the 2D map and onto canvas textures
 * on the 3D map.
 *
 * One style throughout: flat fills from a small palette with a dark ink
 * outline (it reads on bright ground in 3D and disappears into the dark UI),
 * round caps and joins, light detail strokes, and ember accents.
 */

/**
 * The palette. Hues are taken from the theme tokens in `styles.css`
 * (`--gold`, `--good`, `--bad`, `--warn`, `--text`) and extended with a few
 * earth tones; every fill is light enough to read on `--panel` (#141b21).
 * `current` follows the surrounding text colour (`currentColor`).
 */
export const PALETTE = {
  ink: '#16110d',
  gold: '#d9b46a',
  ember: '#e2763a',
  flame: '#f4c55a',
  leaf: '#7fbf7a',
  moss: '#4f9a5a',
  bark: '#a06a41',
  timber: '#d8a46a',
  stone: '#aab3b5',
  slate: '#6f7e85',
  clay: '#c46f4c',
  copper: '#e08d55',
  cream: '#ecdcbc',
  skin: '#e2b48c',
  red: '#d9695f',
  blood: '#b54a40',
  rose: '#eea79c',
  blue: '#7397dc',
  water: '#5f8fd4',
  plum: '#a978c8',
  cloud: '#c9d3da',
  warn: '#e0a755',
  forbid: '#d4567f',
  bronze: '#c4875a',
  white: '#f4efe4',
  /** The dark well inside a frame (a shade under `--panel`). */
  deep: '#1d252b',
  current: 'currentColor',
} as const

export type Tone = keyof typeof PALETTE

export interface Shape {
  /** SVG path data on the 24×24 grid. */
  d: string
  fill?: Tone
  stroke?: Tone
  /** Stroke width in grid units. */
  w?: number
  /** Opacity. */
  o?: number
  /** Optional transform. */
  m?: Matrix
}

export type IconArt = readonly Shape[]

// ---- shape helpers --------------------------------------------------------

export const OUTLINE = 1.3

/** A filled shape with the ink outline. */
export function f(fill: Tone, d: string, w = OUTLINE): Shape {
  return { d, fill, stroke: 'ink', w }
}
/** A filled shape, no outline (highlights, inner detail). */
export function F(fill: Tone, d: string, o?: number): Shape {
  return o === undefined ? { d, fill } : { d, fill, o }
}
/** A stroke-only line. */
export function l(stroke: Tone, d: string, w = 1.3, o?: number): Shape {
  return o === undefined ? { d, stroke, w } : { d, stroke, w, o }
}
/** A thick line with an ink outline (handles, poles, stems). */
export function bar(tone: Tone, d: string, w = 2): Shape[] {
  return [l('ink', d, w + OUTLINE * 2), l(tone, d, w)]
}
/** Apply a transform to a group of shapes. */
export function xf(m: Matrix, shapes: readonly Shape[]): Shape[] {
  return shapes.map((s) => ({ ...s, m: s.m ? mul(m, s.m) : m }))
}
export function art(...items: (Shape | readonly Shape[])[]): Shape[] {
  return items.flat()
}

// ---- shared motifs --------------------------------------------------------

export const FLAME_OUTER =
  'M12 3C13 6.5 17.5 8.5 17.5 13C17.5 16 15.2 18 12 18S6.5 16 6.5 13C6.5 10.5 8 9 9.2 8C9.2 9.8 10 11 11 11.2C10.4 8 11 5 12 3Z'
export const FLAME_INNER =
  'M12 9.5C12.8 11.5 14.8 12.5 14.8 14.8C14.8 16.4 13.6 17.5 12 17.5S9.2 16.4 9.2 14.8C9.2 13.2 10.4 12.5 11 11.2C11.4 12.2 12 12.5 12.4 12.3C12 11.4 11.8 10.4 12 9.5Z'
/** Flame spanning x 6.5–17.5, y 3–18. */
export const FLAME = [f('ember', FLAME_OUTER), F('flame', FLAME_INNER)]

export const CLOUD =
  'M6.5 16.5C4.3 16.5 3 15 3 13.2C3 11.4 4.4 10 6.2 10C6.7 7.4 8.9 5.5 11.5 5.5C14 5.5 16 7.2 16.6 9.5C18.9 9.5 20.8 11.1 20.8 13.2C20.8 15.1 19.3 16.5 17.3 16.5Z'

export const ROCK = 'M3.5 18.5L5.5 11L10.5 6.5L16.5 7.5L20.5 12.5L19.5 18.5Z'

/** Beer mug, body x 4.5–15.5, handle to x 20. */
export const MUG = art(
  bar('gold', 'M15.5 10.5H18C19.3 10.5 20 11.2 20 12.5V15C20 16.3 19.3 17 18 17H15.5', 1.8),
  f('gold', rect(4.5, 7.5, 11, 13, 2)),
  l('bark', 'M8 11.5V17.5M12 11.5V17.5', 1.2),
  f(
    'cream',
    'M4 8.5C4 6 6 5 7.5 5.6C8.3 4 11 3.7 12.3 5C13.8 4.2 16.3 4.8 16.3 7.2C16.3 8.5 15.5 9.2 14.8 9.3H5.2C4.5 9.3 4 9 4 8.5Z',
  ),
)

/** A conifer whose tip is at (cx, top) and which is `h` tall. */
export function conifer(cx: number, top: number, h: number, tone: Tone): Shape[] {
  const s = h / 17
  const m: Matrix = [s, 0, 0, s, cx - 12 * s, top - 2.5 * s]
  return xf(m, [
    f('bark', rect(10.6, 15, 2.8, 4.5, 0.6)),
    f(tone, 'M12 2.5L16.5 8.8H14.4L18.5 15.5H5.5L9.6 8.8H7.5Z'),
  ])
}

export function leafShape(x: number, y: number, len: number, angle: number, tone: Tone): Shape {
  // A pointed leaf from (x, y) along `angle` degrees.
  const d = `M0 0C${len * 0.3} ${-len * 0.32} ${len * 0.75} ${-len * 0.3} ${len} 0C${len * 0.75} ${len * 0.3} ${len * 0.3} ${len * 0.32} 0 0Z`
  return { ...f(tone, d, 1.1), m: mul(translate(x, y), rotateAbout(angle, 0, 0)) }
}

/** A five-pointed star centred on (cx, cy). */
export function star(cx: number, cy: number, r: number, inner = 0.45): string {
  const pts: number[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 === 0 ? r : r * inner
    pts.push(cx + rr * Math.cos(a), cy + rr * Math.sin(a))
  }
  return poly(...pts)
}

/** Resolve a tone to a concrete colour; `current` becomes `currentColor` unless overridden. */
export function toneColor(tone: Tone, current: string = PALETTE.current): string {
  return tone === 'current' ? current : PALETTE[tone]
}

export function matrixAttr(m: Matrix): string {
  return `matrix(${m.map((v) => Math.round(v * 10000) / 10000).join(' ')})`
}
