import { circle, ellipse, mul, poly, rect, scaleAbout, translate } from './geometry'
import { FLAME, F, art, bar, f, l, leafShape, star, xf, type IconArt } from './draw'

/**
 * The few icons the menu shows — the species, the two race meters, and the
 * menu's own glyphs. They ship in the startup chunk so the menu never flashes
 * emoji while the rest of the registry (`icons.ts`) loads with the screens.
 * Keep this set small: every path here is paid for before first paint.
 */

export const SPECIES_ICONS = {
  human: art(
    f('moss', 'M4 21.8C4.5 18.6 7.5 17.4 9 17.4H15C16.5 17.4 19.5 18.6 20 21.8Z'),
    f('skin', circle(12, 13.2, 5.3)),
    F('ink', circle(10, 13.8, 0.8)),
    F('ink', circle(14, 13.8, 0.8)),
    l('ink', 'M10.5 16.1C11.4 16.8 12.6 16.8 13.5 16.1', 1, 0.8),
    f('gold', ellipse(12, 9.2, 9, 2.2)),
    f('gold', 'M7.6 9.2C7.6 5.6 9.6 3.4 12 3.4S16.4 5.6 16.4 9.2Z'),
    l('bark', 'M7.8 8H16.2', 1.3),
  ),
  beaver: art(
    f('bark', circle(6.4, 6.6, 2.3)),
    f('bark', circle(17.6, 6.6, 2.3)),
    f('bark', ellipse(12, 12, 7.6, 7.2)),
    f('timber', ellipse(12, 15, 4.3, 3.3)),
    F('ink', ellipse(12, 13.3, 1.7, 1.15)),
    f('cream', rect(10.5, 16.4, 3, 3.4, 0.6), 1),
    l('ink', 'M12 16.6V19.6', 0.8),
    F('ink', circle(9, 10.4, 1.05)),
    F('ink', circle(15, 10.4, 1.05)),
    F('cream', circle(9.35, 10.05, 0.35)),
    F('cream', circle(15.35, 10.05, 0.35)),
  ),
  lizard: art(
    bar('leaf', 'M12 16C12 19.8 15 21.6 18 20.2', 1.8),
    bar('leaf', 'M9.8 9.6L6.4 8.2L5.4 6M14.2 9.6L17.6 8.2L18.6 6M9.8 14.4L6.4 15.8L5.4 18M14.2 14.4L17.6 15.8L18.6 18', 1.4),
    f('leaf', ellipse(12, 12, 3.2, 5.4)),
    f('leaf', ellipse(12, 5.4, 2.6, 3.1)),
    F('ink', circle(10.9, 4.6, 0.65)),
    F('ink', circle(13.1, 4.6, 0.65)),
    F('moss', circle(12, 10.2, 0.8)),
    F('moss', circle(12, 13, 0.8)),
  ),
  harpy: art(
    f(
      'plum',
      'M5 21C4.4 15 5.4 8.4 10 5.2C13 3.2 16.8 3.4 18.4 6.2L18.2 10.6C17.4 13 15.8 14.6 14 15.6L15.2 21Z',
    ),
    l('rose', 'M6.6 16.5C8 14.8 10 14 12 13.8M7.4 12.4C8.8 10.6 10.6 9.8 12.6 9.6', 1.1, 0.7),
    f('gold', 'M17.6 5.8L22 8.4L18 11.4Z', 1.1),
    F('cream', circle(15, 7.6, 1.5)),
    F('ink', circle(15.2, 7.6, 0.8)),
    f('plum', 'M9.5 5.6C8.5 3.6 9 2 10.5 1.4C10.8 2.8 11.6 3.6 12.6 4.2Z', 1),
  ),
  fox: art(
    f('ember', 'M3.8 3.2L10.2 7.8L5.2 11.2Z'),
    f('ember', 'M20.2 3.2L13.8 7.8L18.8 11.2Z'),
    F('ink', 'M5 5.4L8.4 7.9L5.9 9.6Z', 0.7),
    F('ink', 'M19 5.4L15.6 7.9L18.1 9.6Z', 0.7),
    f('ember', 'M3.4 10C3.4 7.4 7.4 6 12 6S20.6 7.4 20.6 10C20.6 14 16 19.6 12 21C8 19.6 3.4 14 3.4 10Z'),
    F('cream', 'M3.6 11C6 12.4 9.4 14.8 12 20.8C8.2 19.4 4.6 15.2 3.6 11Z'),
    F('cream', 'M20.4 11C18 12.4 14.6 14.8 12 20.8C15.8 19.4 19.4 15.2 20.4 11Z'),
    F('ink', ellipse(8.8, 11.4, 0.95, 1.25)),
    F('ink', ellipse(15.2, 11.4, 0.95, 1.25)),
    F('ink', ellipse(12, 19, 1.4, 1)),
  ),
} satisfies Record<string, IconArt>

export const METER_ICONS = {
  reputation: art(
    f('gold', 'M3.6 17.4L2.6 7.6L8 11.4L12 4.4L16 11.4L21.4 7.6L20.4 17.4Z'),
    f('gold', rect(3.4, 16.8, 17.2, 3.4, 1)),
    F('red', circle(12, 18.5, 1.05)),
    F('blue', circle(7.6, 18.5, 0.9)),
    F('blue', circle(16.4, 18.5, 0.9)),
    f('flame', circle(2.6, 7.4, 1.3), 1),
    f('flame', circle(12, 4.2, 1.3), 1),
    f('flame', circle(21.4, 7.4, 1.3), 1),
  ),
  impatience: art(
    l('current', 'M6.6 5C6.6 9 11 10.5 11 12S6.6 15 6.6 19M17.4 5C17.4 9 13 10.5 13 12S17.4 15 17.4 19', 1.4),
    F('flame', 'M8.4 7.6H15.6C14.8 9.3 12.8 10.4 12 11.4C11.2 10.4 9.2 9.3 8.4 7.6Z'),
    F('flame', 'M12 14.6C13.6 15.6 15.8 17 16.4 19H7.6C8.2 17 10.4 15.6 12 14.6Z'),
    l('flame', 'M12 11.4V15', 0.8),
    f('bark', rect(4.5, 2.4, 15, 2.8, 1)),
    f('bark', rect(4.5, 18.8, 15, 2.8, 1)),
  ),
} satisfies Record<string, IconArt>

/** The menu's own glyphs: new settlement, saves, Citadel, daily, achievements. */
export const MENU_ICONS = {
  guildHouse: art(
    f('cream', 'M2.5 8.5L12 3L21.5 8.5Z'),
    f('stone', rect(3.5, 8.5, 17, 2.2, 0.4)),
    ...[4.8, 8.8, 12.8, 16.8].map((x) => f('cream', rect(x, 10.7, 2.4, 7.8, 0), 1.1)),
    f('stone', rect(2.5, 18.5, 19, 2.6, 0.4)),
  ),
  settlement: art(
    xf(mul(translate(12, 2), mul(scaleAbout(1.2, 0, 0), translate(-12, -3))), FLAME),
  ),
  small: art(
    bar('moss', 'M12 21V11', 1.3),
    leafShape(12, 13, 8, -150, 'leaf'),
    leafShape(12, 11, 9, -35, 'leaf'),
  ),
  folder: art(
    f('gold', 'M3 6C3 5 3.7 4.4 4.5 4.4H9.5L11.5 6.4H19.5C20.3 6.4 21 7 21 8V18.5C21 19.3 20.3 20 19.5 20H4.5C3.7 20 3 19.3 3 18.5Z'),
    F('cream', rect(5, 7.8, 14, 7, 0.5)),
    f('timber', 'M2.6 10H21.4L20.2 19C20.1 19.6 19.5 20 18.9 20H5.1C4.5 20 3.9 19.6 3.8 19Z'),
  ),
  calendar: art(
    f('cream', rect(3.5, 5, 17, 16, 2)),
    f('red', 'M3.5 7C3.5 5.9 4.4 5 5.5 5H18.5C19.6 5 20.5 5.9 20.5 7V9.6H3.5Z'),
    bar('slate', 'M8 3.2V6.6M16 3.2V6.6', 0.9),
    ...[
      [6.4, 12], [10.4, 12], [14.4, 12], [6.4, 16], [10.4, 16],
    ].map(([x, y]) => F('slate', rect(x, y, 2.4, 2.2, 0.4))),
    F('red', rect(14.4, 16, 3, 2.6, 0.5)),
  ),
  medal: art(
    f('blue', poly(6.6, 1.6, 11, 1.6, 12.6, 10.2, 9.4, 11.2), 1),
    f('red', poly(17.4, 1.6, 13, 1.6, 11.4, 10.2, 14.6, 11.2), 1),
    f('gold', circle(12, 15.6, 6)),
    l('bark', circle(12, 15.6, 4.4), 0.9),
    F('flame', star(12, 15.6, 3)),
  ),
  fog: art(
    l(
      'cloud',
      'M3 7.5C6 6 8 9 11 7.5S16 6 21 7.5M3 12.5C6 11 8 14 11 12.5S16 11 21 12.5M3 17.5C6 16 8 19 11 17.5S16 16 21 17.5',
      2,
    ),
  ),
} satisfies Record<string, IconArt>

export const CORE_ICONS = { ...SPECIES_ICONS, ...METER_ICONS, ...MENU_ICONS }
