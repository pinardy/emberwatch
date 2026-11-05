import type { ReactNode } from 'react'
import type { IconId } from '../art/icons'
import {
  charterArt,
  conditionArt,
  cornerstoneArt,
  gladeEventArt,
  ongoingArt,
  runModifierArt,
  threatArt,
} from '../game/content/art'
import { BUILDING_LIST } from '../game/content/buildings'
import { CHARTER_LIST } from '../game/content/charters'
import { CORNERSTONE_LIST } from '../game/content/cornerstones'
import { GLADE_EVENT_LIST } from '../game/content/gladeEvents'
import { RESOURCE_LIST } from '../game/content/resources'
import { ALL_RUN_MODIFIER_LIST } from '../game/content/runModifiers'
import { SPECIES_LIST } from '../game/content/species'
import { Icon } from './Icon'

/**
 * The sim narrates in plain strings with emoji in them (the log, warnings,
 * threat summaries), and those strings are also what the Log tab and saves
 * hold. Rather than change the engine's text, `IconText` swaps in drawn icons
 * where a glyph's meaning is certain:
 *
 * - a glyph immediately followed by the name of the thing it stands for —
 *   a resource, building, species, cornerstone, glade event, threat, pact,
 *   lingering condition, land or charter ("2 🪵 Wood", "🐺 The Wolf Pack
 *   strikes");
 * - a small set of glyphs at the very start of a line, where the sim uses
 *   them as a headline icon ("🔥 Hearth wood runs out…").
 *
 * Every other emoji stays as it is, so nothing is ever misdrawn.
 */

const VS16 = /️/g
const strip = (s: string) => s.replace(VS16, '')

/** glyph → candidates `{ name, art }` it may stand for when a name follows. */
const NAMED = new Map<string, { name: string; art: IconId }[]>()
function addNamed(glyph: string, name: string, art: IconId | undefined) {
  if (!art) return
  const key = strip(glyph)
  const list = NAMED.get(key) ?? []
  list.push({ name: name.toLowerCase(), art })
  NAMED.set(key, list)
}
for (const d of RESOURCE_LIST) addNamed(d.icon, d.name, d.art)
for (const d of BUILDING_LIST) addNamed(d.icon, d.name, d.art)
for (const d of SPECIES_LIST) addNamed(d.icon, d.name, d.art)
for (const d of CORNERSTONE_LIST) addNamed(d.icon, d.name, cornerstoneArt(d))
for (const d of GLADE_EVENT_LIST) {
  addNamed(d.icon, d.name, gladeEventArt(d))
  for (const o of d.options) {
    if (o.threat) addNamed(o.threat.icon, o.threat.name, threatArt(o.threat))
    if (o.ongoing) addNamed(o.ongoing.icon, o.ongoing.name, ongoingArt({ id: '', name: o.ongoing.name }))
    if (o.condition) addNamed(o.condition.icon, o.condition.name, conditionArt(o.condition))
  }
}
for (const d of ALL_RUN_MODIFIER_LIST) addNamed(d.icon, d.name, runModifierArt(d))
for (const d of CHARTER_LIST) addNamed(d.icon, d.name, charterArt(d))

/** Headline glyphs at the start of a line, as the sim and HUD use them. */
export const LEADING_GLYPH_ART: Record<string, IconId> = {
  '🔥': 'ancientHearth',
  '🏮': 'brazier',
  '📦': 'warehouse',
  '⏳': 'impatience',
  '👑': 'reputation',
  '⛈': 'storm',
  '🌩': 'hostility',
  '🛌': 'rest',
  '🍺': 'luxury',
  '🕯': 'religion',
  '📜': 'education',
  '🥊': 'brawling',
  '🍵': 'treatment',
  '🛤': 'road',
  '🚪': 'door',
  '🍽': 'plate',
  '🛏': 'bed',
  '🔨': 'tool',
  '📯': 'horn',
  '❄': 'snowflake',
  '⚡': 'lightning',
  '🎲': 'die',
  '🕊': 'dove',
  '🐫': 'camel',
  '📐': 'setSquare',
  '🔍': 'magnifier',
  '🌫': 'fog',
  '📅': 'calendar',
  '🪦': 'grave',
  '🎗': 'ribbon',
  '⏸': 'pause',
  '⛏': 'stonecuttersCamp',
}

const GLYPHS = [...new Set([...NAMED.keys(), ...Object.keys(LEADING_GLYPH_ART)])].sort(
  (a, b) => b.length - a.length,
)
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PATTERN = new RegExp(`(${GLYPHS.map(escape).join('|')})️?`, 'gu')

/** Split `text` into strings and icon ids. Exported for tests. */
export function tokenizeIconText(
  text: string,
  anywhere = false,
): (string | { art: IconId; glyph: string })[] {
  const out: (string | { art: IconId; glyph: string })[] = []
  let last = 0
  for (const match of text.matchAll(PATTERN)) {
    const at = match.index ?? 0
    const glyph = match[0]
    const key = match[1]
    const after = text
      .slice(at + glyph.length)
      .replace(/^\s/, '')
      .toLowerCase()
    let art: IconId | undefined = NAMED.get(key)?.find((c) => after.startsWith(c.name))?.art
    if (!art && (anywhere || text.slice(0, at).trim() === '')) art = LEADING_GLYPH_ART[key]
    if (!art) continue
    if (at > last) out.push(text.slice(last, at))
    out.push({ art, glyph })
    last = at + glyph.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * `anywhere` also swaps headline glyphs mid-line — for short UI strings the
 * app writes itself ("👑 +2 ⏳ −1"), never for the sim's free text.
 */
export function IconText({ text, anywhere = false }: { text: string; anywhere?: boolean }): ReactNode {
  const parts = tokenizeIconText(text, anywhere)
  if (parts.length === 1 && typeof parts[0] === 'string') return text
  return parts.map((p, i) => (typeof p === 'string' ? p : <Icon key={i} id={p.art} emoji={p.glyph} />))
}
