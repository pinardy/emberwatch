import { memo, type ReactElement } from 'react'
import { ICONS, isIconId, matrixAttr, toneColor, type IconId } from '../art/icons'
import './icons.css'

/**
 * One of Emberwatch's drawn icons, inline as SVG. It sizes itself in `em`, so
 * it drops in wherever an emoji glyph used to sit and takes that text's size.
 *
 * Decorative by default (`aria-hidden`): the name next to it carries the
 * meaning. Pass `label` when the icon stands alone and must be announced.
 *
 * Give it an icon `id`, or a piece of content via `of` (anything with an
 * optional `art` id and an emoji `icon`). Content without drawn art — or an
 * id that is not in the registry, say from an old save — falls back to its
 * emoji, so nothing ever renders blank.
 */
export interface IconProps {
  id?: IconId | null
  of?: { art?: IconId; icon: string } | null
  /** Emoji to show when there is no drawn art. */
  emoji?: string
  /** Accessible name; omit for a decorative icon. */
  label?: string
  className?: string
}

export function Icon({ id, of, emoji, label, className }: IconProps) {
  const art = id ?? of?.art
  const a11y = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const)
  if (art && isIconId(art)) {
    return (
      <svg
        className={className ? `icon ${className}` : 'icon'}
        viewBox="0 0 24 24"
        focusable="false"
        strokeLinecap="round"
        strokeLinejoin="round"
        data-icon={art}
        {...a11y}
      >
        {shapesOf(art)}
      </svg>
    )
  }
  const glyph = emoji ?? of?.icon
  if (!glyph) return null
  return (
    <span className={className ? `icon-emoji ${className}` : 'icon-emoji'} {...a11y}>
      {glyph}
    </span>
  )
}

/** The paths of each icon, built once and reused by every render. */
const shapeCache = new Map<IconId, ReactElement[]>()

export function shapesOf(id: IconId): ReactElement[] {
  let hit = shapeCache.get(id)
  if (!hit) {
    hit = ICONS[id].map((s, i) => (
      <path
        key={i}
        d={s.d}
        fill={s.fill ? toneColor(s.fill) : 'none'}
        stroke={s.stroke ? toneColor(s.stroke) : undefined}
        strokeWidth={s.stroke ? (s.w ?? 1.3) : undefined}
        opacity={s.o}
        transform={s.m ? matrixAttr(s.m) : undefined}
      />
    ))
    shapeCache.set(id, hit)
  }
  return hit
}

/** Element id of an icon's `<symbol>` inside an SVG that renders `IconSymbols`. */
export function iconSymbolId(id: IconId): string {
  return `art-${id}`
}

/**
 * `<symbol>` definitions for an SVG scene (the 2D map) that stamps the same
 * icon many times: each deposit or building is then a single `<use>`.
 * Memoised on the id list, so it renders once per map, not per tick.
 */
export const IconSymbols = memo(function IconSymbols({ ids }: { ids: readonly IconId[] }) {
  return (
    <defs>
      {ids.map((id) => (
        <symbol
          key={id}
          id={iconSymbolId(id)}
          viewBox="0 0 24 24"
          strokeLinecap="round"
          strokeLinejoin="round"
          overflow="visible"
        >
          {shapesOf(id)}
        </symbol>
      ))}
    </defs>
  )
})

/** One icon inside an SVG scene, centred on (`x`, `y`). Needs `IconSymbols`. */
export function IconUse({ id, x, y, size }: { id: IconId; x: number; y: number; size: number }) {
  return (
    <use
      href={`#${iconSymbolId(id)}`}
      x={x - size / 2}
      y={y - size / 2}
      width={size}
      height={size}
      className="map-icon"
      data-icon={id}
    />
  )
}
