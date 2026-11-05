import { circle, mul, poly, rect, scaleAbout, translate, type Matrix } from './geometry'
import { F, f, xf, type Shape, type Tone } from './draw'
import { mono } from './motifs'

/**
 * Frames give each large family one silhouette, so a cornerstone reads as a
 * cornerstone and a threat as a threat before its motif is even made out:
 *
 * - cornerstones: a carved hexagonal slab, its rim the rarity's colour;
 * - glade events: a ring in the glade kind's colour (amber or rose);
 * - threats: a spiked red ring; pacts: a green rosette; lingering
 *   conditions: a plum octagon; lands: a mossy tile;
 * - charters: a gold seal with ribbon tails; Citadel upgrades: a swallowtail
 *   banner in the branch colour; edicts: a red-rimmed shield;
 * - achievements: a medal on a ribbon, bronze, silver or gold by tier;
 * - `mono`: no frame — a one-colour glyph for a coloured status badge.
 *
 * Every frame has a dark well, so motifs keep their own colours inside it.
 */

interface Frame {
  back: Shape[]
  /** Where the 24×24 motif lands inside the frame. */
  place: Matrix
  front?: Shape[]
  /** Recolour the motif instead of framing it. */
  recolour?: (shapes: readonly Shape[]) => Shape[]
}

function fit(scale: number, cx = 12, cy = 12): Matrix {
  return mul(translate(cx - 12, cy - 12), scaleAbout(scale))
}

function ring(rim: Tone): Frame {
  return {
    back: [f(rim, circle(12, 12, 10.6)), F('deep', circle(12, 12, 8.4))],
    place: fit(0.62),
  }
}

const HEX_OUT = poly(12, 1.2, 21.2, 6.4, 21.2, 17.6, 12, 22.8, 2.8, 17.6, 2.8, 6.4)
const HEX_IN = poly(12, 3.6, 19, 7.7, 19, 16.3, 12, 20.4, 5, 16.3, 5, 7.7)
function slab(rim: Tone): Frame {
  return { back: [f(rim, HEX_OUT), F('deep', HEX_IN)], place: fit(0.6) }
}

const BANNER_OUT = poly(3.6, 1.6, 20.4, 1.6, 20.4, 22.4, 12, 18.2, 3.6, 22.4)
const BANNER_IN = poly(5.6, 3.6, 18.4, 3.6, 18.4, 19.2, 12, 16, 5.6, 19.2)
function banner(rim: Tone): Frame {
  return { back: [f(rim, BANNER_OUT), F('deep', BANNER_IN)], place: fit(0.52, 12, 10.2) }
}

function medal(rim: Tone): Frame {
  return {
    back: [
      f('blue', poly(5.6, 0.8, 10.6, 0.8, 12.4, 7.2, 8.6, 8.4), 1),
      f('red', poly(18.4, 0.8, 13.4, 0.8, 11.6, 7.2, 15.4, 8.4), 1),
      f(rim, circle(12, 14, 9.4)),
      F('deep', circle(12, 14, 7.4)),
    ],
    place: fit(0.54, 12, 14),
  }
}

function spikes(cx: number, cy: number, outer: number, inner: number, n: number): string {
  const pts: number[] = []
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n
    const r = i % 2 === 0 ? outer : inner
    pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
  return poly(...pts)
}

/** A scalloped circle: `n` round bumps on radius `r` (a rosette or a wax seal). */
function lobes(cx: number, cy: number, r: number, n: number, bump: number): string {
  const at = (k: number) => {
    const a = (k / n) * Math.PI * 2 - Math.PI / 2
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)].map((v) => Math.round(v * 100) / 100)
  }
  const [x0, y0] = at(0)
  let d = `M${x0} ${y0}`
  for (let k = 1; k <= n; k++) {
    const [x, y] = at(k)
    d += `A${bump} ${bump} 0 0 1 ${x} ${y}`
  }
  return d + 'Z'
}

const OCT = (r: number) => {
  const k = r * 0.414
  return poly(12 - k, 12 - r, 12 + k, 12 - r, 12 + r, 12 - k, 12 + r, 12 + k, 12 + k, 12 + r, 12 - k, 12 + r, 12 - r, 12 + k, 12 - r, 12 - k)
}

const SHIELD_OUT = 'M12 1.4L21 4.6V11.4C21 17 17 20.8 12 22.6C7 20.8 3 17 3 11.4V4.6Z'
const SHIELD_IN = 'M12 3.8L18.8 6.2V11.4C18.8 15.8 15.8 18.8 12 20.2C8.2 18.8 5.2 15.8 5.2 11.4V6.2Z'

export const FRAMES = {
  'stone-common': slab('stone'),
  'stone-rare': slab('blue'),
  'stone-epic': slab('plum'),
  'event-dangerous': ring('warn'),
  'event-forbidden': ring('forbid'),
  threat: {
    back: [f('red', spikes(12, 12, 11.4, 8.6, 12)), F('deep', circle(12, 12, 7.8))],
    place: fit(0.56),
  },
  pact: {
    back: [f('leaf', lobes(12, 12, 8.6, 12, 2.2)), F('deep', circle(12, 12, 7.6))],
    place: fit(0.56),
  },
  condition: { back: [f('plum', OCT(10.8)), F('deep', OCT(8.6))], place: fit(0.6) },
  land: {
    back: [f('leaf', rect(1.6, 1.6, 20.8, 20.8, 5)), F('deep', rect(3.8, 3.8, 16.4, 16.4, 3.4))],
    place: fit(0.62),
  },
  charter: {
    back: [
      f('red', poly(8, 15, 5.4, 23, 8.4, 21.4, 10.6, 23, 11.4, 16), 1),
      f('red', poly(16, 15, 18.6, 23, 15.6, 21.4, 13.4, 23, 12.6, 16), 1),
      f('gold', lobes(12, 10.4, 7.6, 14, 1.8)),
      F('deep', circle(12, 10.4, 6.8)),
    ],
    place: fit(0.5, 12, 10.4),
  },
  'citadel-provisions': banner('timber'),
  'citadel-charters': banner('red'),
  'citadel-knowledge': banner('blue'),
  'citadel-crown': banner('gold'),
  edict: { back: [f('red', SHIELD_OUT), F('deep', SHIELD_IN)], place: fit(0.54, 12, 11.4) },
  'medal-early': medal('bronze'),
  'medal-mid': medal('cloud'),
  'medal-late': medal('gold'),
  mono: { back: [], place: fit(1), recolour: (s) => mono(s) },
} satisfies Record<string, Frame>

export type FrameId = keyof typeof FRAMES

/** A motif set in a frame. */
export function framed(frame: FrameId, motif: readonly Shape[]): Shape[] {
  const def: Frame = FRAMES[frame]
  const inner = def.recolour ? def.recolour(motif) : motif
  return [...def.back, ...xf(def.place, inner), ...(def.front ?? [])]
}
