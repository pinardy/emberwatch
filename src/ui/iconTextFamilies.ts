import { runModifierArt } from '../game/content/art'
import { charterArt, conditionArt, cornerstoneArt, gladeEventArt, ongoingArt, threatArt } from '../game/content/artFamilies'
import { CHARTER_LIST } from '../game/content/charters'
import { CORNERSTONE_LIST } from '../game/content/cornerstones'
import { GLADE_EVENT_LIST } from '../game/content/gladeEvents'
import { ALL_RUN_MODIFIER_LIST } from '../game/content/runModifiers'
import { addNamed } from './IconText'

/*
 * Teaches IconText the framed families' glyphs, so a log line such as
 * "🐺 The Wolf Pack strikes" draws the threat's own icon. Loaded with the icon
 * registry (see `loadIcons`), not at startup: the menu never shows these.
 */
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
