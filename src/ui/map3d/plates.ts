import { GLADE_ART } from '../../game/content/art'
import { gladeStakesOf } from '../../game/engine/events'
import type { Glade } from '../../game/types'
import { GLADE_KIND_STYLE, gladeAccessText, type GladeAccess } from '../mapShared'
import { drawIcon, type SpriteTile } from './sprites'

/**
 * A fogged glade's name plate, painted into the plate atlas: kind (icon and
 * label in the kind's colour), name, clearing progress and how to reach it.
 * The look follows the old DOM plate — dark glass, a kind-coloured border
 * that glows when reachable, green while a crew is clearing, grey when out of
 * reach. A canvas plate costs nothing per frame; the DOM plates rewrote their
 * transforms every rendered frame.
 */
export function plateTile(glade: Glade, access: GladeAccess, percent: number, clearers: number): SpriteTile {
  const locked = access === 'locked'
  const style = GLADE_KIND_STYLE[glade.kind]
  const text = gladeAccessText(
    { access, reachable: !locked, pct: percent / 100, clearers },
    gladeStakesOf(glade),
  )
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
      const emW = ctx.measureText(text).width
      const showBar = percent > 0
      const inner = Math.max(kindW, nameW, emW, showBar ? 260 : 0)
      const pw = Math.min(w - 16, inner + 56)
      const ph = showBar ? 196 : 172
      const x = (w - pw) / 2
      const y = (h - ph) / 2

      const border = locked ? 'rgba(255,255,255,0.18)' : access === 'clearing' ? '#6fbf72' : style.edge
      ctx.save()
      if (access === 'reachable') {
        ctx.shadowColor = style.edge
        ctx.shadowBlur = 18
      }
      ctx.fillStyle = 'rgba(9, 13, 16, 0.86)'
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
      const kindColor = locked ? '#6d7a7a' : style.edge
      ctx.font = small
      ctx.fillStyle = kindColor
      const label = style.label.toUpperCase()
      const lw = ctx.measureText(label).width
      ctx.fillText(label, cx + 18, cy)
      drawIcon(ctx, GLADE_ART[glade.kind], 30 / 24, [cx + 18 - lw / 2 - 40, cy - 15], false)

      cy += 50
      ctx.font = name
      ctx.fillStyle = locked ? '#b8c2bf' : '#eef3f0'
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
      ctx.font = em
      ctx.fillStyle = locked ? '#7d8a8a' : '#d9b46a'
      ctx.fillText(text, cx, cy, pw - 30)
    },
  }
}
