import { ACHIEVEMENTS } from '../game/content/achievements'
import { COMMISSIONS } from '../game/content/commissions'
import { CORNERSTONES } from '../game/content/cornerstones'
import { ACHIEVEMENT_UNLOCKS, META_UPGRADES, type AchievementUnlock } from '../game/content/meta'

/**
 * Words for what a style achievement opens in the Citadel, shared by the
 * achievements screen, the Citadel's own list and the end screen.
 */
export function unlockText(unlock: AchievementUnlock): string {
  if (unlock.cornerstone) {
    const c = CORNERSTONES[unlock.cornerstone]
    return `${c?.icon ?? '🪨'} ${c?.name ?? unlock.cornerstone} joins your cornerstone drafts`
  }
  if (unlock.upgrade) {
    const u = META_UPGRADES[unlock.upgrade]
    return `${u?.icon ?? '🏛️'} ${u?.name ?? unlock.upgrade} can be bought early, without its prerequisites`
  }
  if (unlock.commission) {
    const c = COMMISSIONS[unlock.commission]
    return `${c?.icon ?? '📜'} The ${c?.name ?? unlock.commission} commission goes on the board early`
  }
  return ''
}

export interface CitadelUnlockRow {
  achievementId: string
  name: string
  icon: string
  description: string
  text: string
  earned: boolean
}

/** Every achievement-granted unlock, in list order, and whether it is open. */
export function citadelUnlockRows(unlocked: Readonly<Record<string, number>>): CitadelUnlockRow[] {
  return Object.entries(ACHIEVEMENT_UNLOCKS).map(([id, unlock]) => {
    const def = ACHIEVEMENTS[id]
    return {
      achievementId: id,
      name: def?.name ?? id,
      icon: def?.icon ?? '🏅',
      description: def?.description ?? '',
      text: unlockText(unlock),
      earned: unlocked[id] !== undefined,
    }
  })
}
