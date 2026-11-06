import { circle, ellipse, poly, rays, rect, rotateAbout, scaleAbout, translate, mul } from './geometry'
import { F, art, bar, f, l, leafShape, star, xf, type IconArt, type Shape } from './draw'
import { CLOUD } from './kit'

/**
 * Motifs: the small single-subject drawings behind the larger families —
 * cornerstones, glade events, threats, pacts, conditions, lands, charters,
 * Citadel upgrades, edicts, achievements — and the plain UI glyphs (tabs,
 * status badges, the odds and ends that were emoji). Each stands alone as an
 * icon too; `frames.ts` sets one inside a family's frame.
 */


const SNOW_ARM = 'M12 12V3.4M12 6.6L9.8 4.6M12 6.6L14.2 4.6'

const PICK_HEAD = 'M3.2 10.2C7.2 4.2 15.6 2.6 21.4 6L20.8 8.6C15.8 6.4 9.8 7.2 5.4 11.8Z'

export const MOTIFS = {
  // ---- tools, works and things --------------------------------------------
  scaffold: art(
    bar('timber', 'M5 21.5V3.5M19 21.5V3.5M5 8H19M5 14H19', 1.5),
    bar('timber', 'M5 14L19 8', 1.1),
    l('cream', 'M12 8V14.6', 1),
    f('stone', rect(9.8, 14.6, 4.4, 4.4, 0.6)),
  ),
  pantry: art(
    f('stone', rect(6, 5.5, 12, 15, 2)),
    f('red', rect(6, 10, 12, 6, 0)),
    l('rose', 'M8.5 13H15.5', 1.1, 0.8),
    f('cloud', ellipse(12, 5.6, 6, 1.7)),
  ),
  compass: art(
    f('timber', circle(12, 12, 9.2)),
    F('cream', circle(12, 12, 7)),
    l('bark', 'M12 5.8V7M12 17V18.2M5.8 12H7M17 12H18.2', 1.1),
    f('red', poly(12, 5.6, 14.2, 12, 9.8, 12), 0.8),
    f('slate', poly(12, 18.4, 14.2, 12, 9.8, 12), 0.8),
    F('ink', circle(12, 12, 1)),
  ),
  bolt: art(
    f('stone', rect(10.2, 10, 3.6, 11.5, 0.6)),
    l('slate', 'M10.2 13L13.8 12.2M10.2 15.6L13.8 14.8M10.2 18.2L13.8 17.4', 1),
    f('stone', poly(12, 2.2, 17, 4.8, 17, 9.6, 12, 12.2, 7, 9.6, 7, 4.8)),
    F('slate', circle(12, 7.2, 1.8)),
  ),
  bucket: art(
    l('slate', 'M5 8.5C5 2.5 19 2.5 19 8.5', 1.4),
    f('stone', 'M5 8.5H19L17.4 21H6.6Z'),
    l('slate', 'M5.6 13.6H18.4', 1.1),
    f('cloud', ellipse(12, 8.5, 7, 1.8)),
    F('water', ellipse(12, 8.5, 5.4, 1.1)),
  ),
  feather: art(
    f('cream', 'M20 2.5C13 3.6 6.4 10 5.4 19C9 17 14.2 13.2 20 2.5Z'),
    l('timber', 'M11.2 10.6L9 9.6M13.6 8.4L11.8 7.2M9.4 13.4L7.2 12.8M15.6 6.4L14.2 5.2', 1),
    l('bark', 'M19 4C14.4 8.8 9.6 13.6 3.6 21', 1.1),
  ),
  lantern: art(
    l('slate', 'M12 4.2V1.6', 1.2),
    f('red', ellipse(12, 12.5, 6.6, 7.2)),
    F('flame', ellipse(12, 12.5, 2.6, 3.8), 0.7),
    l('blood', 'M12 5.6V19.4M8.6 6.4C7 9 7 16 8.6 18.6M15.4 6.4C17 9 17 16 15.4 18.6', 1),
    f('bark', rect(8.4, 4, 7.2, 2.2, 0.6)),
    f('bark', rect(8.4, 18.8, 7.2, 2.2, 0.6)),
    l('flame', 'M12 21V23', 1.2),
  ),
  sunflower: art(
    bar('moss', 'M12 13V22.5', 1.3),
    leafShape(12, 18.6, 5.4, -30, 'leaf'),
    ...Array.from({ length: 10 }, (_, i) => leafShape(12, 9.5, 8, i * 36 - 90, 'flame')),
    f('bark', circle(12, 9.5, 3.4)),
    F('ink', circle(11, 8.6, 0.5), 0.5),
    F('ink', circle(13, 10.2, 0.5), 0.5),
  ),
  dove: art(
    l('leaf', 'M4.2 17.4L7.6 15.4M5.6 16.6L5.2 15', 1.2),
    f(
      'white',
      'M2.5 12.5C5.5 12.8 8 11 10 8.6C12 6 15.6 4.8 18.8 6.2L21.6 5.8L20.2 8C20.4 12 16.6 16 10.6 16C7.4 16 4.4 14.8 2.5 12.5Z',
    ),
    f('cloud', 'M8.6 11C9.4 6.4 12.6 3.2 16.4 2.6C15.6 6.6 13.4 9.8 8.6 11Z'),
    f('gold', 'M21.6 5.8L23.2 6.4L21 7.4Z', 0.8),
    F('ink', circle(17.8, 7.2, 0.6)),
  ),
  window: art(
    f('timber', 'M4 21V10C4 5.5 7.5 2.8 12 2.8S20 5.5 20 10V21Z'),
    F('water', 'M6 19.2V10.5C6 7 8.6 4.8 12 4.8S18 7 18 10.5V19.2Z', 0.75),
    l('timber', 'M12 4.8V19.2M6 12H18', 1.4),
    leafShape(9, 19, 3.4, -120, 'leaf'),
    leafShape(9, 19, 3.4, -60, 'leaf'),
    l('cloud', 'M7.8 9.6C8.2 8.2 9 7.2 10.2 6.6', 1, 0.8),
  ),
  horn: art(
    l('red', 'M9 14C9 18 12 19.5 13.5 17.5', 1.3),
    f('gold', 'M4.4 10.4H13L19.6 4.6V19.4L13 13.6H4.4Z'),
    f('gold', rect(2, 10.6, 3, 2.8, 0.8), 1),
    f('flame', ellipse(19.6, 12, 1.6, 7.4)),
  ),
  speech: art(
    f(
      'cream',
      'M4 4.5H20C21 4.5 21.5 5 21.5 6V14C21.5 15 21 15.5 20 15.5H11L6.5 19.8V15.5H4C3 15.5 2.5 15 2.5 14V6C2.5 5 3 4.5 4 4.5Z',
    ),
    F('slate', circle(8, 10, 1.25)),
    F('slate', circle(12, 10, 1.25)),
    F('slate', circle(16, 10, 1.25)),
  ),
  pit: art(
    f('slate', ellipse(12, 14, 9.5, 5.6)),
    F('ink', ellipse(12, 14.6, 7.2, 3.8)),
    F('ember', ellipse(12, 16, 4, 1.6), 0.85),
    F('flame', ellipse(12, 16.4, 1.8, 0.7), 0.9),
    f('stone', ellipse(4.5, 12, 2, 1.4), 1),
    f('stone', ellipse(19, 11, 2.2, 1.4), 1),
  ),
  door: art(
    f('bark', 'M6 20.5V5C6 3.5 7 2.5 8.5 2.5H15.5C17 2.5 18 3.5 18 5V20.5Z'),
    l('ink', 'M10 3V20.5M14 3V20.5', 1, 0.4),
    f('gold', circle(15.4, 12.5, 1.1), 0.9),
    f('stone', rect(3.5, 20, 17, 2.2, 0.6)),
  ),
  coins: art(
    f('timber', 'M8 7.5C4 10 3 14 4 17.5C5 20.5 8 21.5 12 21.5S19 20.5 20 17.5C21 14 20 10 16 7.5Z'),
    f('timber', 'M9 6L7.4 2.5H16.6L15 6Z'),
    f('bark', rect(8.4, 5.6, 7.2, 2.6, 1)),
    f('gold', circle(12, 15, 3.4), 1),
    l('bark', 'M12 13.2V16.8', 1.1),
    f('gold', ellipse(20, 20.6, 2.4, 1.2), 1),
  ),
  ladder: art(
    bar('timber', 'M7 22L9 2M17 22L15 2', 1.4),
    bar('timber', 'M8.5 17.4H15.6M8.9 12.8H15.1M9.4 8.2H14.6M9.8 4.4H14.2', 1.1),
  ),
  telescope: art(
    bar('slate', 'M11 14L7 22M11 14L15 22M11 14V21.5', 1.1),
    xf(rotateAbout(-28, 12, 10), [
      f('bark', rect(3, 8.4, 8.4, 4.6, 1.2)),
      f('gold', rect(10.6, 7.2, 9, 7, 1.2)),
      f('cloud', ellipse(19.8, 10.7, 1.3, 3.4), 1),
    ]),
  ),
  houses: art(
    f('timber', rect(12.5, 8.5, 8.5, 8, 0.4)),
    f('clay', poly(11.5, 9, 16.75, 3.8, 22, 9)),
    F('flame', rect(15.6, 10.6, 2.2, 2.2, 0.4)),
    f('timber', rect(3, 12.5, 9.5, 9, 0.4)),
    f('red', poly(2, 13, 7.75, 7.2, 13.5, 13)),
    F('ink', rect(6.4, 16.4, 2.8, 5.1, 0.8), 0.85),
  ),
  horse: art(
    f(
      'bark',
      'M7 21.5C7 16 6 13 6.5 10C7 6 10 3.5 13 3L13.6 1.4L15 3.2C17.5 4 19.5 7 20.5 10.5C21 12.5 20 13.6 18.5 13.2C17 12.8 15.6 12 14.5 12.6C13.5 13.6 14 17.2 15.5 21.5Z',
    ),
    bar('ink', 'M12.2 4C10 6 8.8 9 8.8 13.6', 1.4),
    l('gold', 'M14 6.6L19.2 11.2M16.6 12.6L14 6.6', 1),
    F('ink', circle(15.6, 7.6, 0.85)),
    F('ink', circle(19.4, 11.6, 0.5)),
  ),
  monolith: art(
    // A trilithon: two standing stones under a lintel, a rune glowing on one.
    l('moss', 'M2 21.2H22', 1.4),
    f('slate', 'M4 21.2L4.6 9.6H9.4L10 21.2Z'),
    f('slate', 'M14 21.2L14.6 9.6H19.4L20 21.2Z'),
    f('stone', 'M2.6 9.8L3.4 5.6H20.6L21.4 9.8Z'),
    l('flame', 'M7.2 12.4L6.2 14.6H8L7 17', 1.1, 0.95),
    f('stone', ellipse(12, 20.4, 2.2, 1), 1),
  ),
  seal: art(
    f('red', poly(...gearPoints(12, 13, 8.6, 7.4, 12))),
    F('blood', circle(12, 13, 5.2)),
    l('rose', 'M9.2 14.6L9.6 11.6L11 13L12 11L13 13L14.4 11.6L14.8 14.6Z', 1),
    bar('gold', 'M12 4.4V1.6', 1.6),
  ),
  ledger: art(
    f('timber', rect(5, 2.8, 14.5, 18.4, 1.5)),
    F('cream', rect(17.6, 4.2, 1.2, 15.6)),
    f('bark', rect(5, 2.8, 3.4, 18.4, 1)),
    f('cream', rect(10.2, 6.6, 6.2, 3.4, 0.6), 1),
    l('bark', 'M8.4 15.6H19.5', 1.2),
  ),
  writ: art(
    f('cream', rect(4.5, 2.5, 14, 17, 1)),
    l('slate', 'M7.5 6.5H15.5M7.5 9.5H15.5M7.5 12.5H12.5', 1),
    f('red', 'M13.6 18.4L12.6 22.6L14.6 21.4L15.6 22.6L16.2 18.8Z', 0.9),
    f('red', circle(15, 16.2, 3.2)),
  ),
  swirl: art(
    bar(
      'blue',
      'M12 12C12 10 14 9.6 15 11C16 13 13.6 16 11 15C8 14 7.6 10 10 8C13 6 18 7 19 11.6C20 16 16 20 11.6 20C6 20 3 15 4.6 10',
      1.8,
    ),
  ),
  chest: art(
    f('bark', rect(3.5, 10, 17, 10.5, 1)),
    f('timber', 'M3.5 10.5V8C3.5 5.5 5.5 4 8 4H16C18.5 4 20.5 5.5 20.5 8V10.5Z'),
    l('gold', 'M3.5 10.5H20.5M8.5 4.4V20.5M15.5 4.4V20.5', 1.4),
    f('gold', rect(10.4, 8.6, 3.2, 4.2, 0.8), 1),
    F('ink', circle(12, 10.6, 0.6)),
  ),
  notes: art(
    f('blue', poly(9.2, 4.6, 20.6, 2.4, 20.6, 5.6, 9.2, 7.8)),
    bar('blue', 'M9.8 17.6V5.6M19.8 15.6V3.6', 1.2),
    f('blue', ellipse(7.2, 18, 3, 2.2)),
    f('blue', ellipse(17.2, 16, 3, 2.2)),
  ),
  wolf: art(
    f('slate', poly(4.6, 2.2, 10.2, 7.4, 5.4, 10.4)),
    f('slate', poly(19.4, 2.2, 13.8, 7.4, 18.6, 10.4)),
    F('ink', poly(5.6, 4.4, 8.6, 7.4, 6, 8.8), 0.7),
    F('ink', poly(18.4, 4.4, 15.4, 7.4, 18, 8.8), 0.7),
    f('stone', 'M3.8 9.2C5 6.6 8 5.6 12 5.6S19 6.6 20.2 9.2L18.6 14L13.6 21.4H10.4L5.4 14Z'),
    F('cloud', 'M9 13.4C10 12.2 14 12.2 15 13.4L12.9 21H11.1Z'),
    F('ink', ellipse(12, 20, 1.5, 1)),
    F('flame', poly(7.2, 10.8, 10.6, 11.6, 7.8, 12.8)),
    F('flame', poly(16.8, 10.8, 13.4, 11.6, 16.2, 12.8)),
  ),
  miasma: art(
    xf(mul(translate(0, -2.4), scaleAbout(0.95, 12, 11)), [f('moss', CLOUD)]),
    F('leaf', circle(9, 10.4, 1.1), 0.9),
    F('leaf', circle(14.4, 9.6, 1.3), 0.9),
    f('leaf', 'M8 15.6C8 15.6 6.4 18 6.4 19A1.6 1.6 0 0 0 9.6 19C9.6 18 8 15.6 8 15.6Z', 1),
    f('leaf', 'M15.4 16C15.4 16 13.6 18.8 13.6 20A1.8 1.8 0 0 0 17.2 20C17.2 18.8 15.4 16 15.4 16Z', 1),
  ),
  tower: art(
    bar('timber', 'M7 22L9.4 9.6M17 22L14.6 9.6', 1.4),
    bar('timber', 'M8.2 17.8L15.8 13M15.8 17.8L8.2 13', 0.9),
    f('bark', rect(7, 5.8, 10, 4.6, 0.5)),
    F('flame', rect(10.4, 7, 3.2, 2.2, 0.4)),
    f('clay', poly(6, 6, 12, 1.6, 18, 6)),
  ),
  bee: art(
    f('cloud', ellipse(10, 7, 2.6, 3.6), 1),
    f('cloud', ellipse(14.6, 7.2, 2.6, 3.6), 1),
    f('flame', ellipse(12.4, 14, 6, 4.8)),
    l('ink', 'M10.6 9.6V18.4M13.8 9.4V18.6', 1.6),
    F('ink', poly(18.2, 13.4, 20.6, 14, 18.2, 15)),
    f('slate', circle(6, 14, 2.4)),
    F('cream', circle(5.4, 13.4, 0.6)),
  ),
  wave: art(
    f(
      'water',
      'M2 20.5V14C4 10 8 9 10.5 11.5C11.5 8 14.5 5.5 18 6C20.5 6.4 22 8 22 10C19.5 8.6 17 10 17 12.5C17 15 19 16 22 15.5V20.5Z',
    ),
    l('cloud', 'M18 6C15.5 6.5 14 9 14.5 11.5M4 15C5.5 13.4 7.4 13 9 13.6', 1.3),
  ),
  lute: art(
    bar('bark', 'M12 12L19.6 4.4', 1.7),
    f('bark', rect(18, 1.6, 4, 3.2, 0.8), 1),
    f('timber', ellipse(9, 15.5, 6.2, 6)),
    F('ink', circle(9, 15.5, 1.8)),
    l('cream', 'M5.6 18.6L20 4.2M6.6 19.4L20.6 5', 0.5, 0.8),
  ),
  map: art(
    f('cream', poly(2.5, 6, 8.8, 4, 15.2, 6, 21.5, 4, 21.5, 18, 15.2, 20, 8.8, 18, 2.5, 20)),
    F('leaf', ellipse(5.8, 9, 1.8, 1.3), 0.75),
    F('water', ellipse(17.6, 15, 1.8, 1.2), 0.6),
    l('timber', 'M8.8 4V18M15.2 6V20', 1),
    l('red', 'M5 16C7 13 9 14 11 11S15 9 17.5 8.4', 1.2),
    l('red', 'M17 6.4L19 8.4M19 6.4L17 8.4', 1.2),
  ),
  oak: art(
    f('bark', 'M10.4 21.6L11 14.6H13L13.6 21.6Z'),
    f('moss', 'M12 3C15.4 3 17.6 5.2 17.8 7.6C20 8.4 21 10.4 20.4 12.6C19.8 15 17.4 16.2 15 15.6C13.8 16.8 10.2 16.8 9 15.6C6.6 16.2 4.2 15 3.6 12.6C3 10.4 4 8.4 6.2 7.6C6.4 5.2 8.6 3 12 3Z'),
    F('leaf', circle(9.2, 8.6, 2.4), 0.85),
    F('leaf', circle(15, 10.6, 2), 0.85),
  ),
  wheel: art(
    f('bark', circle(12, 12, 9.2)),
    F('deep', circle(12, 12, 6.8)),
    l('timber', rays(12, 12, 2, 6.8, 8), 1.4),
    f('slate', circle(12, 12, 2.4), 1),
  ),
  rat: art(
    l('rose', 'M4.6 16.4C2 16.4 1.4 19.4 4 20.8C6 21.8 9 20.2 11 20.6', 1.2),
    f(
      'slate',
      'M4 16C4 11.5 8 9 12 9C15 9 17.5 10.5 19 12.5L21.6 14L19.5 15.6C18 17 16 17.6 14 17.6H6C4.8 17.6 4 17 4 16Z',
    ),
    f('rose', circle(15.4, 9.6, 1.9), 1),
    F('ink', circle(18, 12.6, 0.7)),
    F('rose', circle(21.4, 14, 0.6)),
  ),
  ferry: art(
    f('slate', rect(14, 3.6, 2.2, 4.4, 0.4), 1),
    f('cream', rect(6.8, 8.6, 9.6, 5, 0.6)),
    f('clay', rect(6, 7.4, 11.2, 2, 0.6), 1),
    F('water', rect(8.4, 10, 2, 1.8, 0.3)),
    F('water', rect(12.4, 10, 2, 1.8, 0.3)),
    f('bark', 'M2.5 13.6H21.5L18.6 19H5.4Z'),
    l('water', 'M2 21.4C4 20.4 5 22.4 7 21.4S10 20.4 12 21.4S16 22.4 18 21.4S21 20.4 22 21.4', 1.3),
  ),
  moth: art(
    f('ember', 'M12 11C9 5 4 3.4 3 6C2 9 5 12 12 12Z'),
    f('ember', 'M12 11C15 5 20 3.4 21 6C22 9 19 12 12 12Z'),
    f('flame', 'M12 12C8 12 4.6 14 5.6 17C6.6 19.6 10 17.6 12 13Z'),
    f('flame', 'M12 12C16 12 19.4 14 18.4 17C17.4 19.6 14 17.6 12 13Z'),
    F('ink', circle(6.4, 7.2, 1)),
    F('ink', circle(17.6, 7.2, 1)),
    f('bark', ellipse(12, 12.6, 1.2, 5), 1),
    l('bark', 'M11.6 8.2L10 4.6M12.4 8.2L14 4.6', 0.9),
  ),
  hermit: art(
    f('bark', 'M3.5 22C3.5 12 7 4 12 4S20.5 12 20.5 22Z'),
    f('skin', ellipse(12, 12, 4.2, 4.6)),
    l('ink', 'M9.6 11H10.8M13.2 11H14.4', 1.1),
    f('cream', 'M7.8 13.4C8.4 19 10.4 21.2 12 21.2S15.6 19 16.2 13.4C14.6 15 9.4 15 7.8 13.4Z'),
  ),
  mirror: art(
    bar('gold', 'M12 15.6V22', 1.8),
    f('gold', ellipse(12, 9, 6.6, 7.6)),
    F('cloud', ellipse(12, 9, 5, 6)),
    F('plum', ellipse(13.2, 10.6, 2.6, 2.9), 0.45),
    l('white', 'M9.4 6.6L10.8 5', 1.2),
  ),
  envelope: art(
    f('cream', rect(3, 6, 18, 13, 1.2)),
    l('slate', 'M3.6 6.6L12 13L20.4 6.6', 1.2),
    f('red', circle(12, 13, 2.1), 1),
  ),
  key: art(
    bar('gold', 'M10 11L20.2 21.2', 1.7),
    bar('gold', 'M16.6 17.6L14.6 19.6M18.8 19.8L17 21.6', 1.3),
    f('gold', circle(7, 8, 4.6)),
    F('ink', circle(7, 8, 1.8)),
  ),
  books: art(
    f('red', rect(3, 16.2, 17.5, 4.6, 1)),
    F('cream', rect(18.4, 17, 1.2, 3)),
    f('blue', rect(4.6, 11.6, 16, 4.6, 1)),
    F('cream', rect(18.6, 12.4, 1.2, 3)),
    f('leaf', rect(3.6, 7, 15, 4.6, 1)),
    F('cream', rect(16.4, 7.8, 1.2, 3)),
    l('gold', 'M6.4 7.2V11.4M7.6 11.8V16M5.8 16.4V20.6', 1, 0.8),
  ),
  mountain: art(
    f('slate', poly(1.5, 20.5, 9, 5.6, 13, 13, 15.6, 9, 22.5, 20.5)),
    f('white', poly(9, 5.6, 11.4, 10.2, 9.9, 9.4, 8.6, 10.8, 6.8, 9.9), 1),
    f('white', poly(15.6, 9, 17.2, 11.8, 15.9, 11.2, 14.4, 11.8), 1),
    l('stone', 'M9 5.6L7.6 14L5 18.6', 1, 0.6),
  ),
  forge: art(
    xf(mul(rotateAbout(38, 12, 12), scaleAbout(0.82, 12, 12)), [
      f('timber', rect(10.2, 9, 3.6, 12, 1.5)),
      f('stone', 'M4 4.5H17L20 6.5V9.5H4Z'),
    ]),
    xf(mul(rotateAbout(-34, 12, 12), scaleAbout(0.82, 12, 12)), [
      ...bar('timber', 'M12 5.4V22', 1.8),
      f('stone', PICK_HEAD),
    ]),
  ),
  comet: art(
    F('ember', poly(13.4, 5, 2.6, 17.4, 4.6, 19.6, 18.8, 10.6), 0.85),
    l('flame', 'M11.6 9L5.2 15M14 11.2L7.8 17.6', 1.2, 0.9),
    f('flame', circle(16, 8, 4)),
    F('white', circle(15, 7, 1.4), 0.8),
  ),
  bell: art(
    l('gold', 'M12 3V1.4', 1.4),
    f('gold', circle(12, 19.4, 1.9), 1),
    f('gold', 'M12 2.8C8 2.8 6 6.4 6 10.4V15L4 18H20L18 15V10.4C18 6.4 16 2.8 12 2.8Z'),
    l('flame', 'M9 7C8.4 8.6 8.4 10.2 8.6 12', 1.1, 0.85),
  ),
  witch: art(
    f('plum', 'M6.4 18L11 3.4C11.6 2.4 13 2.4 14 4L15 7L13.4 8.6L17.6 18Z'),
    f('plum', ellipse(12, 18, 10, 2.6)),
    F('gold', poly(7.2, 15.4, 16.8, 15.4, 17.4, 17.2, 6.6, 17.2)),
    f('gold', rect(10.5, 14.8, 3, 2.8, 0.4), 0.9),
    F('flame', star(15.4, 10.6, 1.6)),
  ),
  camel: art(
    bar('timber', 'M5.6 14V21M8 14V21M14 14V21M16.4 14V21', 1.2),
    f(
      'timber',
      'M3 14C3 11 5 9.4 7 9.4C8 6.8 10 6.4 11.6 8.4C13 6.4 15.6 6.8 16 9.4C16.6 9 17.2 7.4 17.6 5.8L20.2 4.8L21.6 6.4L19.6 8C19 11 18.6 13 17 14Z',
    ),
    F('ink', circle(20.2, 6, 0.5)),
  ),
  deer: art(
    bar('timber', 'M10 7.4C8 5 7 3.4 7.4 1.4M8.4 5.2L5.4 4.6M14 7.4C16 5 17 3.4 16.6 1.4M15.6 5.2L18.6 4.6', 1),
    leafShape(9.8, 8.4, 4.2, 200, 'bark'),
    leafShape(14.2, 8.4, 4.2, -20, 'bark'),
    f('bark', 'M8.8 9C8.8 7.4 10.4 6.4 12 6.4S15.2 7.4 15.2 9L14.1 17.2C13.7 18.8 12.9 19.8 12 19.8S10.3 18.8 9.9 17.2Z'),
    F('timber', 'M10.4 14C11.4 13.4 12.6 13.4 13.6 14L13.2 17C12.9 18 12.5 18.6 12 18.6S11.1 18 10.8 17Z'),
    F('ink', ellipse(12, 18.6, 1.1, 0.8)),
    F('ink', circle(10.6, 10.6, 0.65)),
    F('ink', circle(13.4, 10.6, 0.65)),
  ),
  snowflake: art(
    ...Array.from({ length: 6 }, (_, i) => xf(rotateAbout(i * 60, 12, 12), bar('cloud', SNOW_ARM, 1.4))).flat(),
    f('white', circle(12, 12, 1.6), 1),
  ),
  owl: art(
    f('bark', poly(5.4, 6.2, 6.8, 2.2, 9.4, 6.6)),
    f('bark', poly(18.6, 6.2, 17.2, 2.2, 14.6, 6.6)),
    f('bark', ellipse(12, 13.6, 7.2, 8.2)),
    F('timber', ellipse(12, 16.2, 4.6, 4.8)),
    l('bark', 'M10 15.4L11 16.4L12 15.4L13 16.4L14 15.4M10.4 18L11.4 19L12.4 18L13.4 19', 0.8, 0.8),
    f('cream', circle(9, 10.6, 2.8), 1),
    f('cream', circle(15, 10.6, 2.8), 1),
    F('ink', circle(9, 10.6, 1.25)),
    F('ink', circle(15, 10.6, 1.25)),
    f('gold', poly(11, 12.6, 13, 12.6, 12, 14.6), 0.8),
  ),
  drop: art(
    f('water', 'M12 2.4C12 2.4 5.4 10 5.4 14.6A6.6 6.6 0 0 0 18.6 14.6C18.6 10 12 2.4 12 2.4Z'),
    l('cloud', 'M8.8 14.6A3.2 3.2 0 0 0 10.8 17.6', 1.3, 0.85),
  ),
  shield: art(
    f('stone', 'M12 2.4L20.2 5.4V11.6C20.2 16.6 16.6 20.2 12 21.8C7.4 20.2 3.8 16.6 3.8 11.6V5.4Z'),
    F('blue', 'M12 4.8L17.9 7V11.6C17.9 15.4 15.4 18.3 12 19.5Z'),
    F('slate', 'M12 4.8L6.1 7V11.6C6.1 15.4 8.6 18.3 12 19.5Z', 0.55),
  ),
  setSquare: art(
    f('timber', poly(3, 21, 3, 3, 21, 21)),
    F('deep', poly(6.6, 17.4, 6.6, 11, 13, 17.4)),
    l('bark', 'M3 7H5M3 10.6H5M3 14.2H5M7 21V19M10.6 21V19M14.2 21V19', 1),
  ),
  cart: art(
    f('cream', ellipse(8, 7.6, 3.2, 2.2), 1),
    f('cream', ellipse(13.2, 7.2, 3.2, 2.4), 1),
    bar('bark', 'M18 9.6L22 6.4', 1.2),
    f('timber', rect(3, 8.6, 15, 7, 1)),
    l('bark', 'M3 12H18', 1),
    f('bark', circle(7, 17.6, 2.9)),
    f('bark', circle(15, 17.6, 2.9)),
    F('slate', circle(7, 17.6, 1)),
    F('slate', circle(15, 17.6, 1)),
  ),
  die: art(
    f('cream', poly(12, 2.6, 20.6, 7.4, 12, 12.2, 3.4, 7.4)),
    f('cloud', poly(3.4, 7.4, 12, 12.2, 12, 21.6, 3.4, 16.8)),
    f('stone', poly(12, 12.2, 20.6, 7.4, 20.6, 16.8, 12, 21.6)),
    F('red', ellipse(12, 7.4, 1.4, 0.8)),
    F('ink', circle(6, 11.6, 0.9)),
    F('ink', circle(9.4, 17.2, 0.9)),
    F('ink', circle(14.4, 13.8, 0.9)),
    F('ink', circle(16.3, 16.3, 0.9)),
    F('ink', circle(18.2, 18.6, 0.9)),
  ),
  magnifier: art(
    bar('bark', 'M15.2 15.2L21 21', 2.2),
    f('slate', circle(10, 10, 7)),
    F('cloud', circle(10, 10, 5.2), 0.55),
    l('white', 'M6.8 8.4C7.4 7 8.4 6.2 9.8 5.8', 1.2),
  ),
  ring: art(
    bar('gold', 'M12 21.6A6.4 6.4 0 1 1 12 8.8A6.4 6.4 0 1 1 12 21.6Z', 1.8),
    f('cloud', poly(8.4, 8.8, 15.6, 8.8, 17.2, 5.6, 14.6, 2.8, 9.4, 2.8, 6.8, 5.6)),
    l('blue', 'M6.8 5.6H17.2M12 8.8L9.4 2.8M12 8.8L14.6 2.8', 0.8),
  ),
  ear: art(
    l('cloud', 'M4.6 9C3.8 10.8 3.8 13.2 4.6 15M2.4 7.4C1.2 10.2 1.2 13.8 2.4 16.6', 1.2),
    f('skin', 'M8.6 9C8.6 5 11 2.6 14.4 2.6S20.4 5 20.4 9C20.4 12 18.4 13.4 17 14.8C15.6 16.2 15.6 19 13.6 20.6C12 21.8 9.4 21.2 9 19.2C8.6 17.4 8.6 12 8.6 9Z'),
    l('bark', 'M11.8 9C11.8 7 13 5.6 14.6 5.6S17.2 7 17.2 9C17.2 10.6 15.8 11.2 14.8 12.2', 1.2),
  ),
  gem: art(
    f('blue', poly(3.6, 9, 7.8, 3.6, 16.2, 3.6, 20.4, 9, 12, 21)),
    l('cloud', 'M3.6 9H20.4M7.8 3.6L10 9L12 21M16.2 3.6L14 9L12 21M10 9L12 3.6L14 9', 0.9, 0.8),
  ),
  pin: art(
    bar('stone', 'M12 11V21.6', 0.9),
    f('red', 'M8 2.8H16L15 8.4L17.6 11H6.4L9 8.4Z'),
    l('rose', 'M10.4 4.4L10 7.6', 1),
  ),
  bread: art(
    xf(rotateAbout(-32, 12, 12), [
      f('timber', ellipse(12, 12, 10, 3.8)),
      l('bark', 'M7 10.4L8.8 13.6M11 10.4L12.8 13.6M15 10.4L16.8 13.6', 1.2),
    ]),
  ),
  chain: art(
    xf(rotateAbout(-45, 12, 12), [
      ...bar('stone', rect(2.4, 9, 10.6, 6, 3), 1.7),
      ...bar('stone', rect(11, 9, 10.6, 6, 3), 1.7),
    ]),
  ),
  walker: art(
    bar('slate', 'M11 13.4L8 21M11 13.4L14.6 16.8L15 21.4', 1.8),
    bar('slate', 'M12 9L8.4 12M12.4 9L15.6 11.6', 1.4),
    bar('slate', 'M12.6 7.4L11 13.4', 2.2),
    f('skin', circle(13.2, 4.4, 2.3)),
  ),
  coin: art(
    f('gold', circle(12, 12, 9)),
    l('bark', circle(12, 12, 6.6), 1.1),
    l('bark', 'M9 14.2L9.4 10L11 11.6L12 9.4L13 11.6L14.6 10L15 14.2Z', 1),
    l('white', 'M6.4 9C7 7.4 8.2 6.2 9.8 5.6', 1.1, 0.7),
  ),
  lightning: art(f('flame', 'M13.6 1.8L4.6 13.6H11L9.4 22.2L19.4 9.4H13Z')),
  handshake: art(
    f('blue', poly(1.4, 13.2, 6, 8.8, 8.2, 11.4, 3.6, 16)),
    f('red', poly(22.6, 13.2, 18, 8.8, 15.8, 11.4, 20.4, 16)),
    f('skin', 'M6.4 10L11 7.4C12 6.9 13.2 7.1 14 7.7L17.6 10.5L16 13.6L12.4 16.6C11.5 17.4 10.2 17.3 9.4 16.5L6.4 13Z'),
    l('bark', 'M10 12L12.6 14.6M11.6 10.4L14.2 13M13.2 9.2L15.4 11.4', 0.9),
  ),
  star: art(f('flame', star(12, 12.6, 10, 0.46)), F('white', star(12, 12.6, 3.4, 0.5), 0.5)),
  sunrise: art(
    l('flame', 'M12 4.6V7M4.8 8.4L6.4 10M19.2 8.4L17.6 10M2.4 15.2H4.4M19.6 15.2H21.6', 1.4),
    f('flame', 'M5 16A7 7 0 0 1 19 16Z'),
    l('water', 'M2 16.2H22', 1.6),
    l('water', 'M5 19H10M13 19H19M8 21.6H16', 1.3),
  ),
  castle: art(
    f(
      'stone',
      'M2.5 21.5V7H4V5H5.6V7H7V5H8.6V7H9.6V11H14.4V7H15.4V5H17V7H18.4V5H20V7H21.5V21.5Z',
    ),
    bar('slate', 'M12 11V3.6', 0.8),
    F('red', poly(12, 3.4, 16.2, 4.6, 12, 6.2)),
    F('ink', 'M9.8 21.5V16.6C9.8 15.4 10.8 14.4 12 14.4S14.2 15.4 14.2 16.6V21.5Z', 0.85),
    F('ink', rect(4.6, 10.4, 2, 3, 1), 0.8),
    F('ink', rect(17.4, 10.4, 2, 3, 1), 0.8),
  ),
  arm: art(
    // A flexed arm: upper arm along the bottom, forearm up, fist on top.
    f(
      'skin',
      'M2.6 15.4C2.6 13.4 4 12 6 12H12.4C13 10.4 13 8 12.6 6.2C12.3 4.8 13.2 3.6 14.6 3.6H18.6C20 3.6 21 4.6 21 6V9C21 10 20.4 10.8 19.6 11.2L20.2 16.4C20.4 19 18.6 20.8 16 20.8H6C4 20.8 2.6 19.4 2.6 17.4Z',
    ),
    l('bark', 'M7.4 12C9.6 9.8 12.8 10 14.6 12.4M14.2 6.4H20.4M14.2 8.8H20.4', 1.1),
    l('cream', 'M5.6 18.4H11', 1.1, 0.5),
  ),
  sleepy: art(
    f('flame', circle(12, 13, 8.6)),
    l('bark', 'M7 11.4C8 12.4 9 12.4 10 11.4M14 11.4C15 12.4 16 12.4 17 11.4', 1.2),
    f('bark', ellipse(12, 16.6, 2.2, 2.6), 1),
    l('cloud', 'M16.6 1.4H20L16.6 4.8H20', 1.2),
  ),
  spoon: art(
    bar('stone', 'M12 11.4V21.6', 1.4),
    f('stone', ellipse(12, 6.6, 3.8, 4.8)),
    F('cloud', ellipse(12, 6, 2.2, 3), 0.6),
  ),
  // ---- UI glyphs ------------------------------------------------------------
  people: art(
    f('moss', 'M11 21.4V15.4C11 12.8 13 11.2 16 11.2S21 12.8 21 15.4V21.4Z'),
    f('skin', circle(16, 7, 2.9)),
    f('blue', 'M3 21.4V15.4C3 12.8 5 11.2 8 11.2S13 12.8 13 15.4V21.4Z'),
    f('skin', circle(8, 7, 2.9)),
  ),
  person: art(
    f('cream', circle(12, 7.6, 4)),
    f('cream', 'M4 21C4 16 7.4 13.4 12 13.4S20 16 20 21Z'),
  ),
  // Follows the text colour, so it reads on the gold of an active speed button.
  pause: art(f('current', rect(5.8, 4.4, 4.2, 15.2, 1.2)), f('current', rect(14, 4.4, 4.2, 15.2, 1.2))),
  noEntry: art(...bar('red', 'M12 3.6A8.4 8.4 0 1 1 12 20.4A8.4 8.4 0 1 1 12 3.6Z', 2.2), ...bar('red', 'M6.2 6.2L17.8 17.8', 2.2)),
  rain: art(
    xf(translate(0, -2), [f('cloud', CLOUD)]),
    l('water', 'M8 17.6L7 20.8M12 17.6L11 20.8M16 17.6L15 20.8', 1.6),
  ),
  plate: art(
    bar('stone', 'M3 11V21.4', 1),
    l('stone', 'M2 3.6V8.4M3 3.6V8.4M4 3.6V8.4', 0.7),
    l('stone', 'M2 8.4C2 10 4 10 4 8.4', 0.8),
    bar('stone', 'M21 3.6C22.6 6 22.6 10 21 11.6V21.4', 1),
    f('cloud', circle(12, 12.6, 7.4)),
    l('stone', circle(12, 12.6, 5), 1),
  ),
  bed: art(
    bar('bark', 'M3.4 17V20.4M20.6 17V20.4', 1.1),
    f('bark', rect(2.4, 7.6, 3, 9.6, 0.8)),
    f('bark', rect(2.4, 13, 19.2, 4.2, 0.8)),
    f('blue', rect(8, 10.4, 13.6, 3.6, 1)),
    f('cream', rect(5.4, 10, 4, 3, 1), 1),
  ),
  zzz: art(l('cloud', 'M3.6 13.4H9L3.6 19.6H9M11.6 6.4H16L11.6 11.4H16M18 2.2H21.4L18 5.6H21.4', 1.6)),
  worker: art(
    f('skin', 'M7 15.6H17C17 18.8 15 21 12 21S7 18.8 7 15.6Z'),
    f('flame', 'M4.2 14C4.2 9 7.6 5.6 12 5.6S19.8 9 19.8 14Z'),
    l('warn', 'M12 5.8V11M8.2 7.4L9.4 11.4M15.8 7.4L14.6 11.4', 1.1),
    f('flame', rect(2.4, 13.4, 19.2, 2.6, 1.2)),
  ),
  upArrow: art(f('leaf', 'M12 2.4L20.4 11.2H15.2V21.4H8.8V11.2H3.6Z')),
  ribbon: art(...bar('red', 'M8.6 21.4L14.6 11C16 8.2 15 4 12 4S8 8.2 9.4 11L15.4 21.4', 2)),
  lock: art(
    bar('stone', 'M7.4 11V7.6C7.4 5 9.4 3 12 3S16.6 5 16.6 7.6V11', 1.6),
    f('gold', rect(4.6, 10.4, 14.8, 11, 1.6)),
    F('ink', circle(12, 15, 1.6)),
    F('ink', rect(11.3, 15, 1.4, 3.4, 0.4)),
  ),
  grave: art(
    l('moss', 'M2.5 21.4H21.5', 1.4),
    f('stone', 'M6 21.4V9C6 5.6 8.6 3 12 3S18 5.6 18 9V21.4Z'),
    l('slate', 'M12 7.6V14M9.4 10H14.6', 1.4),
  ),
} satisfies Record<string, IconArt>

/** Flat-sided cog points (a wax seal's crimped edge). */
function gearPoints(cx: number, cy: number, outer: number, inner: number, lobes: number): number[] {
  const pts: number[] = []
  for (let i = 0; i < lobes * 2; i++) {
    const a = (i * Math.PI) / lobes
    const r = i % 2 === 0 ? outer : inner
    pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
  return pts
}

const DARK = new Set(['ink', 'slate', 'bark', 'blood', 'moss', 'deep'])

/**
 * A one-colour glyph for a coloured status badge: light parts become `tone`,
 * dark parts (outlines, holes, seams) become ink, so the shape keeps its holes.
 */
export function mono(shapes: readonly Shape[], tone: NonNullable<Shape['fill']> = 'white'): Shape[] {
  const pick = (t: Shape['fill']) => (t === undefined ? undefined : DARK.has(t) ? 'ink' : tone)
  return shapes.map((s) => ({ ...s, fill: pick(s.fill), stroke: pick(s.stroke) }))
}
