import { rect } from './geometry'
import { art, bar, f, l, xf, type Shape, type Tone } from './draw'
import type { Matrix } from './geometry'

/**
 * Motifs shared by several lazily loaded icons (clouds, rocks, the beer mug,
 * conifers). They live apart from `draw.ts` so the menu's startup chunk does
 * not carry them.
 */

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

