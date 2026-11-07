import { GLADE_ART } from '../../game/content/art'
import type { GladeStake } from '../../game/engine/events'
import type { Glade } from '../../game/types'
import {
  GLADE_KIND_STYLE,
  GLADE_STAKE_ART,
  GLADE_STAKE_STYLE,
  gladeAccessText,
  SPARED_STYLE,
  type GladeAccess,
} from '../mapShared'
import { drawIcon, type SpriteTile } from './sprites'

/**
 * A fogged glade's name plate, painted into the plate atlas: kind (icon and
 * label in the kind's colour), name, clearing progress and how to reach it.
 * Its stakes hang under it as chips of their own (`stakeChipTile`).
 * The look follows the old DOM plate — dark glass, a kind-coloured border
 * that glows when reachable, green while a crew is clearing, grey when out of
 * reach. A canvas plate costs nothing per frame; the DOM plates rewrote their
 * transforms every rendered frame.
 */
export function plateTile(glade: Glade, access: GladeAccess, percent: number, clearers: number): SpriteTile {
  const locked = access === 'locked'
  // Left to the forest: a soft leaf-green border with no glow, the kind
  // muted, and the truce on the status line beside a trees badge.
  const spared = access === 'spared'
  const style = GLADE_KIND_STYLE[glade.kind]
  const text = gladeAccessText(access, percent / 100, clearers)
  return {
    key: `p:${glade.id}:${access}:${percent}:${clearers}`,
    draw: (ctx, w, h) => {
      const font = 'system-ui, -apple-system, "Segoe UI", sans-serif'
      const small = `600 30px ${font}`
      const name = `700 44px ${font}`
      const em = `500 30px ${font}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = small
      const kindW = ctx.measureText(style.label.toUpperCase()).width + 40
      ctx.font = name
      const nameW = ctx.measureText(glade.name).width
      ctx.font = em
      const emW = ctx.measureText(text).width + (spared ? 44 : 0)
      const showBar = percent > 0
      const inner = Math.max(kindW, nameW, emW, showBar ? 260 : 0)
      const pw = Math.min(w - 16, inner + 56)
      const ph = plateHeight(percent)
      const x = (w - pw) / 2
      const y = (h - ph) / 2

      const border = locked
        ? 'rgba(255,255,255,0.18)'
        : access === 'clearing'
          ? '#6fbf72'
          : spared
            ? 'rgba(159, 220, 180, 0.6)'
            : style.edge
      ctx.save()
      if (access === 'reachable') {
        ctx.shadowColor = style.edge
        ctx.shadowBlur = 18
      }
      ctx.fillStyle = spared ? 'rgba(12, 22, 15, 0.84)' : 'rgba(9, 13, 16, 0.86)'
      ctx.beginPath()
      ctx.roundRect(x, y, pw, ph, 22)
      ctx.fill()
      ctx.restore()
      ctx.lineWidth = access === 'clearing' ? 6 : 4
      ctx.strokeStyle = border
      ctx.beginPath()
      ctx.roundRect(x, y, pw, ph, 22)
      ctx.stroke()

      const cx = w / 2
      let cy = y + 36
      const kindColor = locked ? '#6d7a7a' : spared ? '#9db394' : style.edge
      ctx.font = small
      ctx.fillStyle = kindColor
      const label = style.label.toUpperCase()
      const lw = ctx.measureText(label).width
      ctx.fillText(label, cx + 18, cy)
      drawIcon(ctx, GLADE_ART[glade.kind], 30 / 24, [cx + 18 - lw / 2 - 40, cy - 15], false)

      cy += 50
      ctx.font = name
      ctx.fillStyle = locked ? '#b8c2bf' : spared ? '#cfdcc9' : '#eef3f0'
      ctx.fillText(glade.name, cx, cy, pw - 30)

      if (showBar) {
        cy += 40
        const bw = 260
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
        ctx.beginPath()
        ctx.roundRect(cx - bw / 2, cy - 7, bw, 14, 7)
        ctx.fill()
        ctx.fillStyle = '#6fbf72'
        ctx.beginPath()
        ctx.roundRect(cx - bw / 2, cy - 7, Math.max(14, (bw * Math.min(100, percent)) / 100), 14, 7)
        ctx.fill()
      }

      cy += showBar ? 36 : 46
      if (spared) {
        ctx.font = `italic ${em}`
        ctx.fillStyle = '#aee0bd'
        const tw = Math.min(ctx.measureText(text).width, pw - 74)
        ctx.fillText(text, cx + 22, cy, pw - 74)
        drawIcon(ctx, SPARED_STYLE.art, 34 / 24, [cx + 22 - tw / 2 - 44, cy - 18], false)
      } else {
        ctx.font = em
        ctx.fillStyle = locked ? '#7d8a8a' : '#d9b46a'
        ctx.fillText(text, cx, cy, pw - 30)
      }

    },
  }
}

/** Plate height in tile pixels: taller while a progress bar shows. */
export function plateHeight(percent: number): number {
  return percent > 0 ? 196 : 172
}

/** Plate tiles are this many pixels tall (the plate atlas's tile height). */
const PLATE_TILE_H = 256
/** A stake chip's height as a share of the plate sprite's. */
export const STAKE_CHIP_SHARE = 0.4

export interface StakeChipPlacement {
  stake: GladeStake
  /** Height in world units. */
  size: number
  /** Screen-space shifts from the plate's anchor, world units. */
  offsetX: number
  offsetY: number
}

/**
 * Where a glade's stake chips sit for a plate drawn `plateSize` world units
 * tall: one row, centred just under the plate. The chips are sprites of
 * their own (one shared tile per stake), so they can be far larger than the
 * plate's text without making every plate taller.
 */
export function stakeChipPlacements(
  stakes: readonly GladeStake[],
  percent: number,
  plateSize: number,
): StakeChipPlacement[] {
  const size = plateSize * STAKE_CHIP_SHARE
  const pitch = size * 1.08
  const plateBottom = ((plateHeight(percent) / 2) * plateSize) / PLATE_TILE_H
  const offsetY = -(plateBottom + size / 2 + size * 0.04)
  return stakes.map((stake, i) => ({
    stake,
    size,
    offsetX: (i - (stakes.length - 1) / 2) * pitch,
    offsetY,
  }))
}

/**
 * One stake as a round chip: its icon on dark glass inside a ring of the
 * stake's colour (the lingering task's writ and the pact's handshake differ
 * in colour as well as shape). Shared by every glade with that stake.
 */
export function stakeChipTile(stake: GladeStake): SpriteTile {
  const style = GLADE_STAKE_STYLE[stake]
  return {
    key: `stake:${stake}`,
    draw: (ctx, w, h) => {
      const cx = w / 2
      const cy = h / 2
      const r = Math.min(w, h) / 2 - 6
      ctx.fillStyle = 'rgba(9, 13, 16, 0.92)'
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = 7
      ctx.strokeStyle = style.color
      ctx.stroke()
      const icon = r * 1.5
      drawIcon(ctx, GLADE_STAKE_ART[stake], icon / 24, [cx - icon / 2, cy - icon / 2], true)
    },
  }
}
