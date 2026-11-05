import {
  circle,
  ellipse,
  gear,
  mirrorX,
  mul,
  poly,
  rays,
  rect,
  rotateAbout,
  scaleAbout,
  translate,
} from './geometry'
import { CORE_ICONS } from './core'
import { FRAMES, framed, type FrameId } from './frames'
import { MOTIFS } from './motifs'
import {
  F,
  FLAME,
  art,
  bar,
  f,
  l,
  leafShape,
  matrixAttr,
  toneColor,
  xf,
  type IconArt,
  type Shape,
} from './draw'
import { CLOUD, MUG, ROCK, conifer } from './kit'

export { PALETTE, matrixAttr, toneColor, type IconArt, type Shape, type Tone } from './draw'

/**
 * Emberwatch's hand-drawn icon set: the full registry, loaded with the lazy
 * screens. The drawing kit lives in `draw.ts`; the handful of icons the menu
 * needs at startup in `core.ts`.
 */

// ---- the registry ---------------------------------------------------------

const RESOURCE_ICONS = {
  wood: art(
    f('bark', rect(3, 7.5, 15, 9, 4.5)),
    l('ink', 'M6.5 10.5H12M8 13.5H13.5', 1.1, 0.55),
    f('timber', ellipse(17.5, 12, 3.4, 4.5)),
    l('bark', ellipse(17.5, 12, 1.4, 2), 1.1),
  ),
  plank: art(
    f('timber', rect(4.5, 5.5, 17, 5.5, 1)),
    l('bark', 'M7 8.2H14M16.5 8.2H19', 1.1),
    f('timber', rect(2.5, 13, 17, 5.5, 1)),
    l('bark', 'M5 15.7H9M11.5 15.7H17', 1.1),
  ),
  stone: art(
    f('stone', ROCK),
    l('slate', 'M10.5 6.5L12 12L5.5 11M12 12L20.5 12.5M12 12L13 18.5', 1.2),
  ),
  brick: art(
    f('clay', rect(7.5, 5.5, 9, 6, 1)),
    f('clay', rect(2.5, 12.5, 9, 6, 1)),
    f('clay', rect(12.5, 12.5, 9, 6, 1)),
    l('rose', 'M9.5 7.6H13M4.5 14.6H8M14.5 14.6H18', 1.1, 0.6),
  ),
  clay: art(
    f(
      'clay',
      'M4 19C3 15.5 5 11.5 8.5 11C9.5 8 13.5 6.5 16 8.5C18.5 9 20.5 12 20 15C20.5 17.5 19.5 19 17.5 19Z',
    ),
    l('rose', 'M6.6 14.5C7 13.2 8 12.4 9.2 12.2', 1.2, 0.7),
    l('ink', 'M13 14.8C14 15.6 15.6 15.6 16.4 14.6', 1.1, 0.5),
    f('water', 'M19 2.5C19 2.5 16.8 5 16.8 6.3A2.2 2.2 0 0 0 21.2 6.3C21.2 5 19 2.5 19 2.5Z', 1.1),
  ),
  copperOre: art(
    f('slate', 'M2.5 19L4 13L8.5 10L12.5 11.5L13.5 19Z'),
    f('slate', 'M11 19L12 10.5L16 6L20.5 8.5L21.5 19Z'),
    f('copper', circle(7.5, 15, 1.9), 1),
    f('copper', circle(16.5, 10.8, 1.7), 1),
    f('copper', circle(17, 15.8, 1.4), 1),
  ),
  copperBar: art(
    f('copper', 'M2.5 19L4.5 14.5H12L14 19Z'),
    f('copper', 'M8 13.5L10.5 7H19L21.5 13.5Z'),
    l('flame', 'M11.5 8.8H18M5.5 15.8H11', 1.2, 0.85),
  ),
  plantFiber: art(
    bar('leaf', 'M9 21C9 15 7 9 4.5 4M12 21V3.5M15 21C15 15 17 9 19.5 4', 1.5),
    f('gold', rect(7, 13, 10, 3.2, 1)),
  ),
  fabric: art(
    f('plum', 'M6 17H18L21.5 20.5H9.5Z'),
    f('plum', rect(5, 6, 11, 11, 0)),
    l('rose', 'M8.5 6V17M12 6V17', 1.1, 0.6),
    f('plum', ellipse(5, 11.5, 2.3, 5.5)),
    f('rose', ellipse(16, 11.5, 2.3, 5.5)),
    F('plum', ellipse(16, 11.5, 0.8, 1.8)),
  ),
  resin: art(
    f('bark', rect(3, 2.5, 18, 3.2, 1.2)),
    f('flame', 'M12 5C12 5 6.8 10.5 6.8 14.5A5.2 5.2 0 0 0 17.2 14.5C17.2 10.5 12 5 12 5Z'),
    l('cream', 'M9.6 14.5A2.6 2.6 0 0 0 11.2 17', 1.2, 0.8),
  ),
  part: art(f('stone', gear(12, 12, 9.5, 7, 8)), f('slate', circle(12, 12, 3))),
  tool: art(f('timber', rect(10.2, 9, 3.6, 12, 1.5)), f('stone', 'M4 4.5H17L20 6.5V9.5H4Z')),

  berry: art(
    f('leaf', 'M12 6.5C12.5 4 15 2.5 18.5 3C17.5 5.5 15 6.8 12 6.5Z', 1.1),
    f('blue', circle(12, 9.5, 3.5)),
    f('blue', circle(8.2, 15, 3.6)),
    f('blue', circle(15.8, 15, 3.6)),
    F('cream', circle(7.2, 13.8, 0.9), 0.8),
    F('cream', circle(14.8, 13.8, 0.9), 0.8),
    F('cream', circle(11, 8.3, 0.9), 0.8),
  ),
  root: art(
    bar('leaf', 'M15.5 8.5C15.5 6 17 3.8 19 3M16.3 9.3C18 8 20.2 8 21.5 9', 1.4),
    f('ember', 'M3.5 20.5L12.6 9.4C14.2 7.6 17.6 8.8 16.6 11.4C16.2 12.4 15.4 13 14.6 13.4Z'),
    l('ink', 'M8.6 14.6L10.4 15.6M11.1 11.6L12.8 12.6', 1, 0.5),
  ),
  meat: art(
    bar('cream', 'M11 13L6.2 17.8', 2.6),
    f('cream', circle(4.6, 17.2, 1.8), 1.1),
    f('cream', circle(6.8, 19.4, 1.8), 1.1),
    f('red', 'M13.5 3.5C18 3 21 6.5 20.3 10.5C19.6 14 16.5 15.5 13.5 14.8L10.5 16C9.2 13.5 8.8 11 9.6 8.6C10.2 5.6 11.5 3.8 13.5 3.5Z'),
    l('rose', 'M14 6C16 5.6 17.8 6.6 18.2 8.6', 1.3, 0.85),
  ),
  grain: art(
    bar('gold', 'M12 21.5V8', 1.3),
    ...[10.5, 14, 17.5].flatMap((y) => [
      f('gold', `M12 ${y}C9.6 ${y - 0.6} 8.5 ${y - 2.6} 8.6 ${y - 4.2}C10.6 ${y - 3.8} 12 ${y - 2.2} 12 ${y}Z`, 1),
      f('gold', `M12 ${y}C14.4 ${y - 0.6} 15.5 ${y - 2.6} 15.4 ${y - 4.2}C13.4 ${y - 3.8} 12 ${y - 2.2} 12 ${y}Z`, 1),
    ]),
    f('gold', ellipse(12, 5.2, 1.6, 2.7), 1),
  ),
  vegetable: art(
    f('leaf', circle(12, 13, 8.2)),
    l(
      'moss',
      'M12 21V9.5M12 13.5C9.5 12.8 7.5 10.8 6.8 8M12 13.5C14.5 12.8 16.5 10.8 17.2 8M12 17.5C9 17 6.4 15.4 4.8 13M12 17.5C15 17 17.6 15.4 19.2 13',
      1.3,
    ),
  ),
  mushroom: art(
    f('cream', 'M9 12.5H15L15.8 19.5C15.8 20.6 8.2 20.6 8.2 19.5Z'),
    f('red', 'M3.5 12.8C3.5 7.4 7.4 4 12 4S20.5 7.4 20.5 12.8Z'),
    F('cream', circle(8.6, 8.8, 1.4)),
    F('cream', circle(14.4, 7.4, 1.1)),
    F('cream', circle(16.6, 10.6, 1)),
    F('cream', circle(11.6, 10.8, 0.8)),
  ),
  insect: art(
    l('leaf', 'M8 10L4.5 8M8 13.5H4M8 17L4.5 19.5M16 10L19.5 8M16 13.5H20M16 17L19.5 19.5', 1.4),
    l('leaf', 'M10.8 5L9 2.2M13.2 5L15 2.2', 1.1),
    f('moss', ellipse(12, 14, 4.9, 6.6)),
    f('moss', circle(12, 6.4, 2.6)),
    l('ink', 'M12 8.5V20.5', 1.1),
    F('leaf', 'M9.2 11.5C9.6 10 10.4 9 11.3 8.6V12C10.5 12 9.8 11.8 9.2 11.5Z', 0.9),
  ),
  egg: art(
    f('timber', 'M15.5 9C13 9 11.5 12.6 11.5 15.2C11.5 17.8 13.2 20 15.5 20S19.5 17.8 19.5 15.2C19.5 12.6 18 9 15.5 9Z'),
    f('cream', 'M9 5.5C6 5.5 4.5 10.2 4.5 13.4C4.5 16.6 6.5 19.5 9 19.5S13.5 16.6 13.5 13.4C13.5 10.2 12 5.5 9 5.5Z'),
    l('ink', 'M6.4 11.6C6.7 10.2 7.3 9 8.1 8.4', 1.1, 0.3),
  ),
  herb: art(
    bar('moss', 'M10.5 21.5C11 15.5 12 10 15.5 4', 1.2),
    leafShape(11.1, 16.5, 7, 200, 'leaf'),
    leafShape(11.8, 12.6, 7, -25, 'leaf'),
    leafShape(13.2, 9.2, 6, 215, 'leaf'),
    leafShape(15.2, 4.8, 4.5, -40, 'leaf'),
  ),

  biscuit: art(
    f('timber', rect(4, 4, 16, 16, 3.2)),
    ...[
      [8.5, 8.5],
      [15.5, 8.5],
      [12, 12],
      [8.5, 15.5],
      [15.5, 15.5],
    ].map(([x, y]) => F('bark', circle(x, y, 1.1))),
  ),
  skewer: art(
    bar('timber', 'M3.5 20.5L20.5 3.5', 1.4),
    f('red', rect(5.2, 13.2, 5.6, 5.6, 1.5), 1.2),
    f('leaf', rect(9.4, 9.4, 5.2, 5.2, 1.5), 1.2),
    f('red', rect(13.2, 5.2, 5.6, 5.6, 1.5), 1.2),
  ),
  jerky: art(
    f('blood', 'M3.5 9C6.5 6 9.5 9.5 12.5 7C15 5 18 5.6 20.5 7.5L19.5 11.5C17 9.8 15 10 13 11.3C10 13.3 7 10.3 4.5 12.8Z'),
    f('blood', 'M3.5 15C6.5 12 9.5 15.5 12.5 13C15 11 18 11.6 20.5 13.5L19.5 17.5C17 15.8 15 16 13 17.3C10 19.3 7 16.3 4.5 18.8Z'),
    l('rose', 'M6 9.2C8 8.6 9.6 9.8 11.4 9.2M14 13.8C15.5 13 17 13 18.4 13.6', 1, 0.7),
  ),
  porridge: art(
    l('cloud', 'M9 8C8 6.5 10 5.5 9 3.5M14.5 8C13.5 6.5 15.5 5.5 14.5 3.5', 1.3, 0.85),
    f('bark', 'M3.5 11.5H20.5C20.5 16.5 16.5 19.8 12 19.8S3.5 16.5 3.5 11.5Z'),
    f('cream', ellipse(12, 11.5, 8.5, 2.2)),
    F('blue', circle(14.2, 11.3, 1)),
    F('red', circle(10.6, 11.6, 0.9)),
  ),
  pickles: art(
    f('slate', rect(5.5, 7, 13, 14, 3)),
    F('leaf', rect(8, 9.5, 3.6, 9.5, 1.8)),
    F('moss', rect(12.6, 10.5, 3.4, 8.5, 1.7)),
    l('cloud', rect(5.5, 7, 13, 14, 3), 1.3),
    l('cloud', 'M7.6 10V16', 1.1, 0.7),
    f('bark', rect(6.5, 3.5, 11, 3.5, 1.2)),
  ),

  ale: MUG,
  incense: art(
    l('cloud', 'M9.5 7.5C8.5 6 10.5 5 9.5 3M14.5 6.5C13.5 5 15.5 4 14.5 2', 1.2, 0.85),
    bar('bark', 'M9.5 17L9.5 9M14.5 17L14.5 8', 1.2),
    F('ember', circle(9.5, 8.6, 1.1)),
    F('ember', circle(14.5, 7.6, 1.1)),
    f('slate', 'M4.5 15.5H19.5C19.5 18.8 16.5 20.8 12 20.8S4.5 18.8 4.5 15.5Z'),
    l('stone', 'M5 15.5H19', 1.2),
  ),
  scroll: art(
    f('cream', rect(6, 4.5, 12, 15, 0)),
    l('bark', 'M8.5 9H15.5M8.5 12H15.5M8.5 15H13', 1.2),
    f('timber', rect(4.5, 2.8, 15, 3.4, 1.7)),
    f('timber', rect(4.5, 17.8, 15, 3.4, 1.7)),
  ),
  tea: art(
    l('cloud', 'M8.5 7C7.5 5.5 9.5 4.5 8.5 3M12.5 7C11.5 5.5 13.5 4.5 12.5 3', 1.3, 0.85),
    f('cream', ellipse(11.5, 19.6, 8.5, 1.7)),
    bar('cream', 'M16.5 11.2H18C19.2 11.2 19.8 12.2 19.5 13.3C19.2 14.5 18 15 16.6 15', 1.5),
    f('cream', 'M4.5 9.5H17.5V13C17.5 16.6 14.8 19 11 19S4.5 16.6 4.5 13Z'),
    F('moss', ellipse(11, 10.2, 5.8, 1.1)),
    l('leaf', 'M8.5 14.5C9.5 13.2 11 13 12 13.6C11.2 15 9.8 15.4 8.5 14.5Z', 1.1),
  ),
  trainingGear: art(
    f(
      'red',
      'M8.5 17V14C6.8 13 6 11.3 6 9.5C6 6.2 8.8 3.5 12.5 3.5C16.5 3.5 19 6.3 19 10C19 12.8 18 15 16.5 16V17Z',
    ),
    l('ink', 'M6.3 10.5C7.6 11.6 9.6 11.6 11.2 10.3', 1.1, 0.6),
    l('rose', 'M13 5.8C15 5.8 16.6 7 17 8.8', 1.2, 0.7),
    f('cream', rect(7.5, 16.5, 10, 4.5, 1.2)),
  ),
  amber: art(
    f('ember', poly(12, 2.5, 19.8, 7.2, 19.8, 16.8, 12, 21.5, 4.2, 16.8, 4.2, 7.2)),
    F('flame', poly(12, 6.4, 16.4, 9.1, 16.4, 14.9, 12, 17.6, 7.6, 14.9, 7.6, 9.1)),
    l('cream', 'M9.2 10L11.2 8.8', 1.3, 0.9),
  ),
} satisfies Record<string, IconArt>

const BUILDING_ICONS = {
  ancientHearth: art(
    FLAME,
    f('stone', 'M2.5 20C2.5 17.8 4 16.6 6.2 16.6S10 17.8 10 20Z'),
    f('stone', 'M14 20C14 17.8 15.5 16.6 17.7 16.6S21.5 17.8 21.5 20Z'),
    f('slate', 'M8 21C8 18.8 9.8 17.6 12 17.6S16 18.8 16 21Z'),
  ),
  brazier: art(
    bar('slate', 'M8.5 14L6 21M15.5 14L18 21M12 15V21', 1.3),
    xf(mul(translate(12, 1.5), mul(scaleAbout(0.6, 0, 0), translate(-12, -3))), FLAME),
    f('slate', 'M4.5 11.5H19.5C19.5 14 16.5 15.6 12 15.6S4.5 14 4.5 11.5Z'),
    f('stone', rect(3.8, 10.4, 16.4, 2.2, 1.1)),
  ),
  shelter: art(
    l('bark', 'M12 4.5L10.5 2.2M12 4.5L13.5 2.2', 1.3),
    f('timber', 'M2.5 19.5L12 4.5L21.5 19.5Z'),
    F('ink', 'M12 9.5L8.6 19.5H15.4Z', 0.85),
    f('cream', 'M12 9.5L15.5 19.5H12.6Z', 1),
    l('bark', 'M2 19.8H22', 1.3),
  ),
  cabin: art(
    f('slate', rect(15, 4.5, 2.6, 5)),
    f('bark', rect(5, 11, 14, 9.5, 0.5)),
    l('ink', 'M5.5 14H9.5M5.5 17.2H9.5M14.5 17.2H18.5', 1, 0.45),
    f('clay', 'M2.8 11.8L12 4L21.2 11.8Z'),
    F('ink', rect(10.3, 14.5, 3.4, 6, 1), 0.85),
    F('flame', rect(14.5, 12.8, 2.6, 2.6, 0.5)),
  ),
  warehouse: art(
    f('timber', rect(3.5, 4, 17, 16, 1.5)),
    l('bark', rect(6.5, 7, 11, 10, 0), 1.4),
    l('bark', 'M6.5 17L17.5 7', 1.6),
  ),
  tradingPost: art(
    l('cream', 'M5 7.2L2.8 13M5 7.2L7.2 13M19 7.2L16.8 13M19 7.2L21.2 13', 1, 0.85),
    bar('gold', 'M12 5V19M4 7.2H20', 1.6),
    f('gold', rect(7, 18.8, 10, 2.6, 1)),
    f('gold', circle(12, 4.6, 1.6), 1),
    f('gold', 'M2.2 13H7.8C7.8 15 6.6 16.2 5 16.2S2.2 15 2.2 13Z'),
    f('gold', 'M16.2 13H21.8C21.8 15 20.6 16.2 19 16.2S16.2 15 16.2 13Z'),
  ),
  woodcuttersCamp: art(
    bar('timber', 'M6 21L15.8 5.8', 1.9),
    f('stone', 'M13.6 4.6L19 2.6C21 5.2 21.2 8.8 19.8 11.6L14.6 9.4Z'),
    l('cream', 'M19.3 4.1C20.3 6 20.3 8.4 19.4 10.3', 1, 0.75),
  ),
  stonecuttersCamp: art(
    bar('timber', 'M6.5 21L13.2 6.2', 1.9),
    f('stone', 'M3.2 10.2C7.2 4.2 15.6 2.6 21.4 6L20.8 8.6C15.8 6.4 9.8 7.2 5.4 11.8Z'),
  ),
  clayPit: art(
    bar('timber', 'M16.5 4V12', 1.6),
    f('timber', rect(14.3, 2.2, 4.4, 2.2, 1)),
    f('stone', 'M14 11.5H19V15C19 16.6 17.9 17.6 16.5 17.6S14 16.6 14 15Z'),
    f('clay', 'M2 20.5C3 17.4 7 15.6 12 15.6S21 17.4 22 20.5Z'),
    l('rose', 'M5.5 18.4C7 17.6 8.6 17.3 10 17.2', 1.1, 0.6),
  ),
  copperMine: art(
    f('slate', 'M1.5 20.5L6.5 9L12 5L17.5 9L22.5 20.5Z'),
    F('ink', 'M8.5 20.5V14C8.5 12 10 10.5 12 10.5S15.5 12 15.5 14V20.5Z', 0.9),
    bar('timber', 'M8.6 20.5V12.6H15.4V20.5', 1.6),
    f('copper', circle(18.4, 15.5, 1.3), 1),
    f('copper', circle(5.4, 16.6, 1.1), 1),
    f('copper', circle(13.5, 7.6, 1), 1),
  ),
  herbalistsCamp: art(
    bar('timber', 'M3 4.5V21M21 4.5V21', 1.5),
    bar('timber', 'M2 5H22', 1.5),
    l('cream', 'M7 5.5V7.5M12 5.5V7.5M17 5.5V7.5', 1),
    f('leaf', 'M7 7.5C9.2 9.5 9.6 13.5 7 17.5C4.4 13.5 4.8 9.5 7 7.5Z'),
    f('moss', 'M12 7.5C14.2 9.5 14.6 13.5 12 17.5C9.4 13.5 9.8 9.5 12 7.5Z'),
    f('leaf', 'M17 7.5C19.2 9.5 19.6 13.5 17 17.5C14.4 13.5 14.8 9.5 17 7.5Z'),
    F('gold', rect(5.7, 8.2, 2.6, 1.3, 0.5)),
    F('gold', rect(10.7, 8.2, 2.6, 1.3, 0.5)),
    F('gold', rect(15.7, 8.2, 2.6, 1.3, 0.5)),
  ),
  foragersCamp: art(
    bar('timber', 'M5.5 11C5.5 4 18.5 4 18.5 11', 1.4),
    f('blue', circle(9, 10, 2.6), 1.1),
    f('blue', circle(13.5, 9, 2.6), 1.1),
    f('red', circle(16.2, 11, 2.2), 1.1),
    f('timber', 'M3.5 11.2H20.5L18.5 20.5H5.5Z'),
    l('bark', 'M4.3 14.6H19.7M4.9 17.6H19.1M9 11.2L9.7 20.5M12 11.2V20.5M15 11.2L14.3 20.5', 1.1),
  ),
  trappersCamp: art(
    bar('slate', 'M1.5 14H5M19 14H22.5', 1.6),
    bar('stone', 'M4 14C4 7 20 7 20 14', 1.8),
    bar('stone', 'M4 14C4 20 20 20 20 14', 1.8),
    F('stone', 'M7.4 10.3L8.5 13L9.6 9.1ZM10.9 8.6L12 11.6L13.1 8.6ZM14.4 9.1L15.5 13L16.6 10.3Z'),
    F('stone', 'M7.4 17.7L8.5 15L9.6 18.9ZM10.9 19.4L12 16.4L13.1 19.4ZM14.4 18.9L15.5 15L16.6 17.7Z'),
    f('gold', ellipse(12, 14, 2.4, 1.1), 1),
  ),
  smallFarm: art(
    bar('leaf', 'M7 11.5V6M12 11.5V5M17 11.5V6', 1.1),
    f('gold', ellipse(7, 5.8, 1.4, 2.4), 1),
    f('gold', ellipse(12, 4.8, 1.4, 2.4), 1),
    f('gold', ellipse(17, 5.8, 1.4, 2.4), 1),
    f('bark', 'M2.5 20.5L5.8 11.5H18.2L21.5 20.5Z'),
    l('timber', 'M8.6 11.5L7.2 20.5M12 11.5V20.5M15.4 11.5L16.8 20.5', 1.2, 0.8),
  ),
  lumberMill: art(
    f('stone', gear(12, 9.5, 7.6, 6.2, 14)),
    f('slate', circle(12, 9.5, 2.2), 1.1),
    f('timber', rect(1.5, 15, 21, 5.5, 1)),
    l('bark', 'M4 17.8H9M13 17.8H20', 1.1),
  ),
  brickyard: art(
    f('clay', 'M3.5 20.5V13C3.5 8 7.5 4.5 12 4.5S20.5 8 20.5 13V20.5Z'),
    l('ink', 'M3.6 12.5H20.4M5.4 8.4H18.6M8 4.9V8.4M16 4.9V8.4M12 8.4V12.5M7.5 12.5V16M16.5 12.5V16', 1, 0.45),
    F('ink', 'M8 20.5V17.2C8 15 9.8 13.4 12 13.4S16 15 16 17.2V20.5Z', 0.9),
    F('ember', 'M9.4 20.5C9.4 18.6 11 17.6 12 15.6C13 17.6 14.6 18.6 14.6 20.5Z'),
    F('flame', 'M10.8 20.5C10.8 19.4 11.6 18.8 12 17.8C12.4 18.8 13.2 19.4 13.2 20.5Z'),
  ),
  weaver: art(
    bar('timber', 'M3.5 20L19.5 3.5', 1.1),
    f('plum', circle(11, 12.5, 7.5)),
    l('rose', 'M4.4 10.2C8 12.4 13 12.2 17.2 9.2M4.2 14.8C8 16.8 14 16.2 18.2 12.6M8 6C7.5 10 9 15 12.6 19.8', 1.1, 0.75),
    bar('plum', 'M17.6 17.4C19.2 19.4 21 19.2 22 17.4', 1.3),
  ),
  smelter: art(
    f('slate', rect(14, 2.5, 4, 7)),
    f('stone', 'M4 20.5V11L8 8H16L20 11V20.5Z'),
    F('ink', rect(8, 12.5, 8, 6, 2), 0.9),
    F('ember', rect(9, 14.6, 6, 3.9, 1.6)),
    F('flame', rect(10.6, 16, 2.8, 2.5, 1)),
  ),
  toolshop: art(
    f(
      'stone',
      'M3 7.5H17C19.4 7.5 21 8.6 21.5 10.2H15V12.5C15 13.6 15.8 14.6 17 15V17H7V15C8.2 14.6 9 13.6 9 12.5V11.6C6 11.6 4 10.2 3 7.5Z',
    ),
    l('cream', 'M5 8.8H16.5', 1.1, 0.7),
    f('slate', rect(5.5, 17, 13, 3.6, 1)),
  ),
  cookhouse: art(
    l('cloud', 'M9 5.4C8 4.2 10 3.2 9 1.6M14.5 5.4C13.5 4.2 15.5 3.2 14.5 1.6', 1.2, 0.85),
    f('ember', 'M6.5 21.5C6.5 19.5 8 18.5 8.6 16.8C9.6 18.5 10.8 19.2 10.8 21.5Z', 1.1),
    f('ember', 'M13.2 21.5C13.2 19.5 14.7 18.5 15.3 16.8C16.3 18.5 17.5 19.2 17.5 21.5Z', 1.1),
    bar('slate', 'M3.2 10.2H1.5M20.8 10.2H22.5', 1.4),
    f('slate', 'M4 8.5H20V12C20 15.5 16.5 17.6 12 17.6S4 15.5 4 12Z'),
    f('stone', rect(3, 7, 18, 2.6, 1.3)),
  ),
  smokehouse: art(
    f('cloud', circle(16.5, 5.2, 2.2), 1.1),
    f('cloud', circle(19.4, 2.8, 1.6), 1.1),
    f('bark', rect(5, 11, 14, 9.5, 0.5)),
    f('slate', 'M2.8 11.8L12 5L21.2 11.8Z'),
    F('ink', rect(9.4, 13.6, 5.2, 6.9, 1), 0.9),
    F('red', rect(10.3, 14.6, 1.3, 3.8, 0.6)),
    F('red', rect(12.4, 14.6, 1.3, 3.2, 0.6)),
  ),
  picklingShed: art(
    f('stone', 'M6 7H18C19.5 9 20 11.5 20 14C20 18 17 20.5 12 20.5S4 18 4 14C4 11.5 4.5 9 6 7Z'),
    l('slate', 'M4.3 11.8H19.7', 1.4),
    f('leaf', 'M9 17.6C9 15.1 11 14 13.2 14C13.2 16.5 11.2 17.6 9 17.6Z', 1),
    f('bark', rect(7, 4.4, 10, 3, 1.2)),
    f('bark', rect(10.5, 2.6, 3, 2, 0.8), 1),
  ),
  brewery: art(
    f('bark', 'M6 3.5H18C19.8 7 19.8 17 18 20.5H6C4.2 17 4.2 7 6 3.5Z'),
    l('ink', 'M10 3.5C9.4 9 9.4 15 10 20.5M14 3.5C14.6 9 14.6 15 14 20.5', 1, 0.45),
    bar('slate', 'M5.2 7.6H18.8M5.2 16.4H18.8', 1.2),
    f('gold', rect(10.4, 10.6, 3.2, 2.8, 0.8), 1.1),
  ),
  scribesOffice: art(
    f('slate', 'M5.5 14.2H14.5V19C14.5 20.1 13 20.6 10 20.6S5.5 20.1 5.5 19Z'),
    f('slate', rect(7.6, 12.2, 4.8, 2.4, 0.6), 1.1),
    f('cream', 'M21 2.5C15.5 3 11 6.5 9.6 12.6L11.2 12.2C12.2 10.4 13.6 9.4 15.2 9C17 7.6 19.6 5.6 21 2.5Z'),
    l('bark', 'M10.4 12.4L18.6 4.4', 0.9),
  ),
  apothecaryWorkshop: art(
    bar('cloud', 'M12.4 6.4L19 9.6V14', 1.3),
    f('cloud', rect(17.2, 13.6, 3.6, 4.6, 1), 1.1),
    f('cloud', rect(9, 3.5, 3.2, 7.5, 0.6)),
    f('plum', circle(10.6, 15, 5.6)),
    F('cream', circle(9, 13.8, 1), 0.85),
    F('cream', circle(12, 16.6, 0.8), 0.85),
    l('cream', 'M6.8 13.2C7.2 12 7.9 11.2 8.6 10.8', 1.1, 0.6),
  ),
  tavern: art(
    xf(mul(translate(-3.2, 1.6), mul(rotateAbout(-14, 10, 14), scaleAbout(0.72, 10, 14))), MUG),
    xf(
      mul(translate(3.4, 1.6), mul(rotateAbout(14, 14, 14), mul(scaleAbout(0.72, 14, 14), mirrorX(12)))),
      MUG,
    ),
  ),
  temple: art(
    f('red', rect(5.6, 7.6, 2.6, 13.4, 0.5)),
    f('red', rect(15.8, 7.6, 2.6, 13.4, 0.5)),
    f('red', rect(3.8, 10.2, 16.4, 2, 0.5)),
    f('red', 'M1.8 4.6C7 6.4 17 6.4 22.2 4.6L21.6 7.8H2.4Z'),
    F('gold', rect(10.9, 7.8, 2.2, 2.4, 0.4)),
  ),
  bathHouse: art(
    l('cloud', 'M8 8C7 6.5 9 5.5 8 3.5M12 8C11 6.5 13 5.5 12 3.5M16 8C15 6.5 17 5.5 16 3.5', 1.3, 0.85),
    f('timber', 'M2.8 10.8H21.2L19.5 19C19.3 20 18.5 20.5 17.5 20.5H6.5C5.5 20.5 4.7 20 4.5 19Z'),
    f('water', ellipse(12, 11, 9, 1.8), 1.1),
    l('bark', 'M3.8 15.5H20.2', 1.4),
    F('cloud', circle(7.6, 10.6, 0.7)),
    F('cloud', circle(15.4, 11.2, 0.6)),
  ),
  apothecary: art(
    leafShape(7.6, 11.4, 6, -110, 'leaf'),
    bar('timber', 'M12.6 12.8L19 3.6', 2.2),
    f('stone', 'M3.5 11.5H20.5C20.5 16.5 16.5 19.6 12 19.6S3.5 16.5 3.5 11.5Z'),
    f('slate', rect(8, 19, 8, 2.2, 0.8), 1.1),
    l('cream', 'M6 14.2C6.6 15.6 7.6 16.6 8.8 17.2', 1.1, 0.6),
  ),
  arena: art(
    bar('stone', 'M3.5 3.5L20.5 20.5M20.5 3.5L3.5 20.5', 1.4),
    bar('gold', 'M16.8 21.2L21.2 16.8M2.8 16.8L7.2 21.2', 1.4),
    f('ember', 'M12 3.8L19 6.4V12C19 16.4 15.6 19.4 12 20.8C8.4 19.4 5 16.4 5 12V6.4Z'),
    l('gold', 'M12 4.6V20', 1.4),
    f('gold', circle(12, 11.6, 2), 1.1),
  ),
} satisfies Record<string, IconArt>



const NEED_ICONS = {
  rest: art(
    f(
      'cream',
      'M14.5 3.5C9.6 4 6 8 6 13C6 17.6 10 21 14.5 21C17 21 19 20 20.6 18.4C13.8 18.6 10.6 13 12 8.6C12.7 6.4 13.5 4.8 14.5 3.5Z',
    ),
    l('cloud', 'M15.5 5.5H19L15.5 9.5H19', 1.3),
  ),
  luxury: art(
    f('gold', 'M6.5 3.5H17.5C17.5 8.6 15.4 11.6 12 11.6S6.5 8.6 6.5 3.5Z'),
    F('red', 'M7.4 5.2H16.6C16.2 8.6 14.6 10.4 12 10.4S7.8 8.6 7.4 5.2Z'),
    f('gold', rect(11, 11.4, 2, 6.4, 0), 1.1),
    f('gold', ellipse(12, 19.4, 5, 1.6)),
    l('flame', 'M19.4 12.5V17M17.15 14.75H21.65', 1.2),
  ),
  religion: art(
    F('flame', circle(12, 6.4, 5), 0.22),
    xf(mul(translate(12, 1.4), mul(scaleAbout(0.48, 0, 0), translate(-12, -3))), FLAME),
    l('ink', 'M12 10.4V9.2', 1),
    f('cream', rect(8.8, 10.4, 6.4, 9.6, 1)),
    l('cream', 'M10.4 10.6V13.6', 1.2, 0.5),
    f('gold', ellipse(12, 20.4, 6.2, 1.6)),
  ),
  education: art(
    f('cream', 'M12 6.5C9.5 5 6 4.8 2.8 5.5V18.5C6 17.8 9.5 18 12 19.5Z'),
    f('cream', 'M12 6.5C14.5 5 18 4.8 21.2 5.5V18.5C18 17.8 14.5 18 12 19.5Z'),
    l('slate', 'M5 9C7 8.6 8.8 8.8 10.4 9.5M5 12C7 11.6 8.8 11.8 10.4 12.5M5 15C7 14.6 8.8 14.8 10.4 15.5M13.6 9.5C15.2 8.8 17 8.6 19 9M13.6 12.5C15.2 11.8 17 11.6 19 12', 1),
    l('bark', 'M12 6.5V19.5', 1.3),
  ),
  brawling: art(
    l('flame', 'M3 4.5L5 6.5M21 4.5L19 6.5M12 1.5V3.5', 1.4),
    f('skin', rect(7.5, 15, 9, 6.5, 1)),
    F('red', rect(7.5, 17.4, 9, 2)),
    f('skin', rect(4.8, 5.8, 14.4, 10.2, 3)),
    l('bark', 'M8.4 6.4V10.2M12 6.4V10.2M15.6 6.4V10.2', 1.1),
    f('skin', 'M4.9 10.8H12.4C13.4 10.8 13.8 11.8 13.2 12.6L12.4 13.6H6.4', 1.1),
  ),
  treatment: art(
    f('leaf', 'M9 3.5H15V9H20.5V15H15V20.5H9V15H3.5V9H9Z'),
    l('cream', 'M10.6 5.4V10.6H5.4', 1.1, 0.55),
  ),
} satisfies Record<string, IconArt>

const HUD_ICONS = {
  hostility: art(
    // Three claw rakes: wide enough to read as marks, not lines, at 16px.
    ...[1.2, 7, 12.8].map((a) =>
      f('red', `M${a} 2.6C${a + 5.4} 7.6 ${a + 7} 14 ${a + 4.6} 21.4C${a + 9.6} 15 ${a + 8.8} 7.8 ${a} 2.6Z`, 0.9),
    ),
  ),
  drizzle: art(
    f('flame', circle(16.4, 7.2, 3.6), 1.1),
    l('flame', rays(16.4, 7.2, 4.8, 6.2, 6, 0.5), 1.2),
    f('cloud', CLOUD),
    l('water', 'M8 18.4L7 21M12 18.4L11 21M16 18.4L15 21', 1.6),
  ),
  clearance: art(
    l('flame', rays(10, 9.5, 6.2, 8.4, 8), 1.4),
    f('flame', circle(10, 9.5, 4.6)),
    xf(mul(translate(5.4, 6.2), scaleAbout(0.62, 12, 12)), [f('cloud', CLOUD, 1.9)]),
  ),
  storm: art(
    f('slate', CLOUD),
    l('cloud', 'M6.2 10C6.7 7.4 8.9 5.5 11.5 5.5', 1.1, 0.7),
    f('flame', 'M12.6 12.4L9 18.4H12L10.4 22.8L16.2 15.8H13L14.8 12.4Z', 1.1),
    l('water', 'M6 18.5L5 21M18.5 18.5L17.5 21', 1.5),
  ),
} satisfies Record<string, IconArt>

const MAP_ICONS = {
  // ---- deposits
  trees: art(conifer(8, 3, 15, 'moss'), conifer(15, 4.5, 17, 'leaf')),
  stoneVein: art(
    f('slate', 'M2.5 19.5L5 11L10 7.5L14 9.5L15 19.5Z'),
    f('stone', 'M10 19.5L11.5 12.5L16 9L20.5 12L21.5 19.5Z'),
    l('cream', 'M12.4 15L15.6 14L18 15.6M15.6 14L16.4 11.2', 1.1, 0.8),
  ),
  clayPatch: art(
    f('clay', 'M6.5 13C7.5 9.4 10.2 7.6 13 7.6S18.5 9.4 19.5 13Z'),
    f('clay', 'M2.5 16.5C2.5 13.5 6.5 11.5 12 11.5S21.5 13.5 21.5 16.5C21.5 19 17.5 20.5 12 20.5S2.5 19 2.5 16.5Z'),
    F('water', ellipse(9.4, 15.4, 3.2, 1.1), 0.85),
    F('water', ellipse(15.6, 17.2, 2.2, 0.8), 0.7),
  ),
  orePatch: art(
    f('slate', ROCK),
    bar('copper', 'M5 14.4L8.8 12.4L12 13.8L15.8 10.8L19.6 11.8', 1.3),
    f('copper', circle(13.6, 16.2, 1.3), 1),
    f('copper', circle(8.2, 16.8, 1), 1),
  ),
  vegetation: art(
    f('leaf', 'M3 19.5C2.5 16 4.5 13.5 7 13.5C7 10 9.5 7.6 12 7.6S17 10 17 13.5C19.5 13.5 21.5 16 21 19.5Z'),
    l('moss', 'M7 13.5C7.6 15.4 9 16.4 10.6 16.6M12 7.6C12.6 9.6 13.8 10.8 15.4 11.2M17 13.5C16.4 15.2 15.4 16.2 14 16.8', 1.2),
    F('red', circle(9.4, 11.6, 1)),
    F('red', circle(15.4, 15.6, 1)),
    F('red', circle(5.8, 17.4, 0.9)),
  ),
  game: art(
    f('timber', 'M12 12C15 12 17 14.6 17 16.8C17 18.8 15.4 20 13.6 19.6L12 19.2L10.4 19.6C8.6 20 7 18.8 7 16.8C7 14.6 9 12 12 12Z'),
    f('timber', ellipse(5.4, 11, 1.9, 2.5)),
    f('timber', ellipse(9.2, 6.8, 1.9, 2.6)),
    f('timber', ellipse(14.8, 6.8, 1.9, 2.6)),
    f('timber', ellipse(18.6, 11, 1.9, 2.5)),
  ),
  fertileSoil: art(
    bar('moss', 'M12 15V9.5', 1.1),
    leafShape(12, 10.5, 6, -150, 'leaf'),
    leafShape(12, 9.5, 6.5, -30, 'leaf'),
    f('bark', 'M2 20.5C3.5 16.2 7.6 14.6 12 14.6S20.5 16.2 22 20.5Z'),
    F('ink', circle(8, 18.4, 0.6), 0.5),
    F('ink', circle(15, 17.6, 0.6), 0.5),
    F('ink', circle(12, 19.4, 0.6), 0.5),
  ),
  // ---- glade kinds
  dangerous: art(
    f('warn', 'M12 2.8L22 19.8H2Z', 1.5),
    F('ink', rect(10.9, 8.4, 2.2, 6.6, 1.1)),
    F('ink', circle(12, 17.2, 1.3)),
  ),
  forbidden: art(
    f(
      'cream',
      'M12 2.8C7.4 2.8 4.4 6.2 4.4 10.4C4.4 13 5.5 14.8 7.4 15.8V19.2C7.4 20 8.1 20.8 9 20.8H15C15.9 20.8 16.6 20 16.6 19.2V15.8C18.5 14.8 19.6 13 19.6 10.4C19.6 6.2 16.6 2.8 12 2.8Z',
    ),
    F('ink', ellipse(8.9, 11, 2.1, 2.3)),
    F('ink', ellipse(15.1, 11, 2.1, 2.3)),
    F('ink', 'M12 13.6L10.9 15.6H13.1Z'),
    l('ink', 'M10.4 18V20.8M13.6 18V20.8', 1),
  ),
  // ---- roads (the road tool, the road card and the Inspector's road line)
  road: art(
    F('leaf', 'M2 21.5C2.6 19 3.8 17.6 5 17.2C5.2 18.8 4.4 20.4 2 21.5Z'),
    F('leaf', 'M22 13.5C21.2 11.6 20 10.8 18.8 10.8C19 12.2 20 13.2 22 13.5Z'),
    f('timber', 'M3.5 21.5L10.2 2.5H13.8L20.5 21.5Z'),
    l('bark', 'M7.6 12.5H16.4M5.6 17.5H18.4M9.2 7.5H14.8', 1.1, 0.75),
    l('cream', 'M12 4.2V5.8M12 9.6V11.4M12 14.4V16.6M12 19.4V21.5', 1.4),
  ),
  // ---- terrain (beyond what the deposits already draw)
  marsh: art(
    f('water', ellipse(12, 18, 9.5, 3)),
    l('cloud', 'M6 18H9.5M13.5 19H17', 1.1, 0.7),
    bar('moss', 'M8 17V8M12 16.5V5M16 17V9', 1.1),
    f('bark', rect(6.9, 6.8, 2.2, 4.6, 1.1), 1),
    f('bark', rect(14.9, 7.8, 2.2, 4.6, 1.1), 1),
  ),
} satisfies Record<string, IconArt>

export const ICONS = {
  ...CORE_ICONS,
  ...RESOURCE_ICONS,
  ...BUILDING_ICONS,
  ...NEED_ICONS,
  ...HUD_ICONS,
  ...MAP_ICONS,
  ...MOTIFS,
}

/** A drawn icon on its own. */
export type BaseIconId = keyof typeof ICONS

/**
 * Every drawn icon: a base icon, or a base icon set in one of the family
 * frames (`'stone-rare/compass'`, `'threat/wolf'`). Both halves are checked,
 * so a typo in `<Icon id="…">` or in `content/art.ts` is a compile error.
 */
export type IconId = BaseIconId | `${FrameId}/${BaseIconId}`

export const ICON_IDS = Object.keys(ICONS) as BaseIconId[]

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

export function isIconId(id: unknown): id is IconId {
  if (typeof id !== 'string') return false
  if (has(ICONS, id)) return true
  const slash = id.indexOf('/')
  return slash > 0 && has(FRAMES, id.slice(0, slash)) && has(ICONS, id.slice(slash + 1))
}

const composed = new Map<string, readonly Shape[]>()

/** The shapes of any icon id, framed ones composed once and cached. */
export function iconShapes(id: IconId): readonly Shape[] {
  if (has(ICONS, id)) return ICONS[id as BaseIconId]
  let hit = composed.get(id)
  if (!hit) {
    const slash = id.indexOf('/')
    hit = framed(id.slice(0, slash) as FrameId, ICONS[id.slice(slash + 1) as BaseIconId])
    composed.set(id, hit)
  }
  return hit
}

/**
 * The icon as a standalone SVG document string — for contact sheets, the
 * 2D map's `<symbol>`s, or anywhere a string is wanted. `current` resolves
 * the `currentColor` tone when the SVG will not live inside styled text.
 */
export function iconSvgMarkup(id: IconId, opts: { size?: number; current?: string } = {}): string {
  const size = opts.size ?? 24
  const body = iconShapes(id)
    .map((s) => {
      const attrs = [`d="${s.d}"`, `fill="${s.fill ? toneColor(s.fill, opts.current) : 'none'}"`]
      if (s.stroke) attrs.push(`stroke="${toneColor(s.stroke, opts.current)}"`, `stroke-width="${s.w ?? 1.3}"`)
      if (s.o !== undefined) attrs.push(`opacity="${s.o}"`)
      if (s.m) attrs.push(`transform="${matrixAttr(s.m)}"`)
      return `<path ${attrs.join(' ')}/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}

