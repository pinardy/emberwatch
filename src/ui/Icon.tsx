import { memo, useEffect, useSyncExternalStore, type ReactElement } from 'react'
import { CORE_ICONS } from '../art/core'
import { matrixAttr, toneColor, type Shape } from '../art/draw'
import type { IconId } from '../art/icons'
import './icons.css'

/*
 * The icon registry (all the path data) is its own chunk, kept out of the
 * startup bundle. The few icons the menu shows live in `art/core.ts`, which
 * ships eagerly, so the menu draws them on its first frame. The lazy screens
 * fetch the full registry alongside their own code (see `lazyScreens.tsx`),
 * so a screen never renders without it; anything else shows its emoji for
 * the moment before the registry lands, then redraws.
 */
type Registry = typeof import('../art/icons')
let registry: Registry | null = null
let pending: Promise<Registry> | null = null
const listeners = new Set<() => void>()

/** Fetches the icon registry; safe to call any number of times. */
export function loadIcons(): Promise<Registry> {
  // The icon text helper learns the framed families' glyphs at the same time.
  pending ??= Promise.all([import('../art/icons'), import('./iconTextFamilies')]).then(
    ([m]) => {
      registry = m
      for (const listener of listeners) listener()
      return m
    },
    (error: unknown) => {
      pending = null // let a later attempt retry
      throw error
    },
  )
  return pending
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const getRegistry = () => registry

function useRegistry(): Registry | null {
  const reg = useSyncExternalStore(subscribe, getRegistry, getRegistry)
  useEffect(() => {
    if (!reg) void loadIcons().catch(() => undefined)
  }, [reg])
  return reg
}

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
  const reg = useRegistry()
  const art = id ?? of?.art
  const a11y = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const)
  const shapes = art ? shapesFor(reg, art) : null
  if (art && shapes) {
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
        {elementsOf(art, shapes)}
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

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** An icon's shapes: from the eager core, or from the registry once it is loaded. */
function shapesFor(reg: Registry | null, id: IconId): readonly Shape[] | null {
  if (has(CORE_ICONS, id)) return CORE_ICONS[id as keyof typeof CORE_ICONS]
  return reg?.isIconId(id) ? reg.iconShapes(id) : null
}

/** The paths of each icon, built once and reused by every render. */
const elementCache = new Map<string, ReactElement[]>()

function elementsOf(id: IconId, shapes: readonly Shape[]): ReactElement[] {
  let hit = elementCache.get(id)
  if (!hit) {
    hit = shapes.map((s, i) => (
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
    elementCache.set(id, hit)
  }
  return hit
}

/** Element id of an icon's `<symbol>` inside an SVG that renders `IconSymbols`. */
export function iconSymbolId(id: IconId): string {
  return `art-${id.replace('/', '_')}`
}

/**
 * `<symbol>` definitions for an SVG scene (the 2D map) that stamps the same
 * icon many times: each deposit or building is then a single `<use>`.
 * Memoised on the id list, so it renders once per map, not per tick.
 */
export const IconSymbols = memo(function IconSymbols({ ids }: { ids: readonly IconId[] }) {
  const reg = useRegistry()
  if (!reg) return null
  return (
    <defs>
      {ids.map((id) => (
        <SymbolDef key={id} id={id} shapes={shapesFor(reg, id)} />
      ))}
    </defs>
  )
})

function SymbolDef({ id, shapes }: { id: IconId; shapes: readonly Shape[] | null }) {
  if (!shapes) return null
  return (
    <symbol
      id={iconSymbolId(id)}
      viewBox="0 0 24 24"
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
    >
      {elementsOf(id, shapes)}
    </symbol>
  )
}

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
