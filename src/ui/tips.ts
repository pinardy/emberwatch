import { COMMISSIONS } from '../game/content/commissions'
import {
  DECREE_DECLINE_IMPATIENCE,
  PETITION_AMBER,
  PETITION_BROKEN_IMPATIENCE,
  PETITION_FROM_YEAR,
  PETITION_RELIEF,
  PETITION_VOW_REPUTATION,
  PETITION_VOW_SECONDS,
  HEARTH_STORM_REACH_FLOOR,
  IMPATIENCE_STAGNATION_GRACE,
  RESOLVE_EXPECTATION_CROWD_FROM,
  RESOLVE_EXPECTATION_PER_YEAR,
  SPARED_GLADE_RECLAIM_HOSTILITY,
} from '../game/engine/balance'
import { pendingBlight } from '../game/engine/blights'
import { openErrands } from '../game/engine/errands'
import { isFounding } from '../game/engine/founding'
import { architectOffers, architectPrice, petitionOpen, retreatOffered } from '../game/engine/levers'
import { idleVillagers, population, stormEndReach } from '../game/engine/queries'
import { envoyRiding } from '../game/engine/climax'
import { describeProfile, runReputationProfile } from '../game/engine/reputation'
import {
  coldVillagers,
  expectations,
  secondsSinceReputation,
  villagersBeyond,
} from '../game/engine/society'
import { refinedNeedOf, refinedUnlocked } from '../game/engine/refinedNeeds'
import { SPECIES } from '../game/content/species'
import type { RunState } from '../game/types'
import { TERRAIN_TIPS } from './terrainTips'

/**
 * The coach's tips, as data. Each fires once, the first time its situation
 * holds, and is remembered as seen for good (see `TipsCoach`).
 *
 * To add one: append an entry below. Order matters — when several tips hold
 * at once the earliest unseen one shows, and the rest wait their turn, so a
 * tip about something rarer or later goes further down. Keep the text to two
 * or three short sentences: on a phone the card has a few lines.
 */
export interface Tip {
  id: string
  title: TipCopy
  text: TipCopy
  when: (run: RunState) => boolean
  /** Shown inside a dialog (via `DialogTip`) rather than in the corner. */
  inDialog?: boolean
  /**
   * Once this holds the tip has done its job: it is put away (and counted as
   * seen) without waiting for "Got it", or skipped if it never showed.
   */
  doneWhen?: (run: RunState) => boolean
  /**
   * Urgent tips may interrupt the First steps checklist; the rest wait until
   * it is finished or dismissed, so the two never fight for the corner.
   */
  urgent?: boolean
}

/** A tip's words: fixed, or read from the run (to name what it is about). */
export type TipCopy = string | ((run: RunState) => string)

export function tipCopy(copy: TipCopy, run: RunState): string {
  return typeof copy === 'function' ? copy(run) : copy
}

/** The player has done something on purpose: placed a building or put someone to work. */
function hasActed(run: RunState): boolean {
  return (
    Object.values(run.buildings).some((b) => b.defId !== 'ancientHearth') ||
    Object.values(run.villagers).some((v) => v.assignment !== null)
  )
}

/** Villagers who sleep cold now, or will by the Storm's end (warned from Clearance). */
function coldComing(run: RunState): boolean {
  if (run.season.season === 'storm') return coldVillagers(run) > 0
  // The edge the coming Storm leaves warm: further in for the envoy's last
  // stand or a forecast Long Night.
  return run.season.season === 'clearance' && villagersBeyond(run, stormEndReach(run)) > 0
}

function anySpared(run: RunState): boolean {
  return Object.values(run.glades).some((g) => g.spared && !g.cleared)
}

const pct = (share: number) => `${Math.round(share * 100)}%`

/** "Humans: spiced ale, Beavers: blueprint folios": the run's refined needs. */
function refinedList(run: RunState): string {
  return run.speciesPool
    .map((sp) => {
      const def = refinedNeedOf(sp)
      return def ? `${SPECIES[sp].name}: ${def.name}` : ''
    })
    .filter(Boolean)
    .join(', ')
}

/** The Long Night is forecast for the coming Storm, or has fallen. */
function longNight(run: RunState): boolean {
  return (run.conditions ?? []).some((c) => c.name === 'The Long Night')
}

export const TIPS: Tip[] = [
  {
    id: 'welcome',
    title: 'Welcome, Viceroy',
    text: 'Fill the 👑 Reputation meter to win before the Queen’s ⏳ Impatience fills and she recalls you. Resolve above each species’ threshold is what earns reputation.',
    // The run opens on the founding; welcome the player once it closes.
    // While the First steps checklist is up, it carries this welcome instead.
    when: (run) => run.clock < 30 && run.pendingChoices.length === 0,
    doneWhen: hasActed,
  },
  {
    id: 'founding',
    title: 'The Founding',
    text: 'Nothing moves until the last pick, so take your time. Tap glades and deposits on the map to see what this land offers, and take a writ you can meet in Year 1 — it is your first reputation.',
    when: isFounding,
    inDialog: true,
  },
  {
    id: 'first-draft',
    title: 'Drafting a blueprint',
    text: 'You can never unlock everything — pick buildings that satisfy the services your species actually want. The draft can be rerolled for amber.',
    when: (run) => run.pendingChoices[0]?.kind === 'blueprint',
    inDialog: true,
  },
  {
    id: 'decree-choice',
    title: 'A royal decree',
    text: `Take the one your producers can meet in time — each card says what they make now. A miss costs patience, more with every miss in a row; begging off costs +${DECREE_DECLINE_IMPATIENCE} now and ends your streak.`,
    when: (run) => run.pendingChoices[0]?.kind === 'decree',
    inDialog: true,
  },
  {
    id: 'commission',
    title: (run) => `Commission: ${COMMISSIONS[run.commission ?? '']?.name ?? 'your charge'}`,
    text: 'This settlement has an objective on top of winning, judged when the run ends. Its card at the top of the Orders panel ticks off each term as you go.',
    when: (run) => !!run.commission && !!COMMISSIONS[run.commission] && !isFounding(run),
  },
  // The map's layouts and biomes (`terrainTips.ts`): early, and urgent.
  ...TERRAIN_TIPS,
  {
    id: 'idle-builders',
    title: 'Idle hands build',
    text: 'Idle villagers are your construction crew and your glade clearers. The 💤 count in the top bar is your build speed.',
    when: (run) => run.clock > 45 && idleVillagers(run).length >= 3,
  },
  {
    id: 'first-glade',
    title: 'Push into the forest',
    text: 'Select a fogged glade next to your territory and assign clearers. Dangerous and forbidden glades hide richer loot — and a decision.',
    when: (run) => run.clock > 90 && run.stats.gladesCleared === 0,
  },
  {
    id: 'first-storm',
    title: 'The Blightstorm',
    text: 'Farms stop, gathering halves, and the hearth burns wood fast. Stockpile food and fuel during Clearance, and keep homes near the hearth’s warmth — or raise a brazier beside distant ones.',
    when: (run) => run.season.season === 'storm' && run.season.year === 1,
    urgent: true,
  },
  {
    id: 'frost',
    title: 'The cold closes in',
    text: `Through the Storm the hearth’s warm ring pulls in to ${pct(HEARTH_STORM_REACH_FLOOR)}, and villagers sleeping beyond every fire freeze — the cold takes lives. Raise a brazier by outlying homes, insulate them (a reinforced shelter), or build closer in.`,
    when: coldComing,
    urgent: true,
  },
  {
    id: 'low-resolve',
    title: 'Somebody is miserable',
    text: 'A species below zero resolve will start leaving, and each departure feeds the Queen’s impatience. Check housing, food variety, and their service needs.',
    when: (run) => Object.values(run.resolve).some((r) => r < 0),
    urgent: true,
  },
  {
    id: 'first-threat',
    title: 'A threat is loose',
    text: 'It will strike again and again until you pay it off from the red banner. Weigh the appeasement cost against what each strike is costing you.',
    when: (run) => run.threats.length > 0,
    urgent: true,
  },
  {
    id: 'storm-blight',
    title: (run) => `A blight is coming: ${pendingBlight(run)?.name ?? 'the Storm'}`,
    text: 'The forest has picked a blight for the coming Storm; the conditions bar counts down to it. Make the goods it names before the Storm breaks and it is turned aside — unprepared, it strikes when the Storm comes.',
    when: (run) => pendingBlight(run) !== undefined,
    urgent: true,
  },
  {
    id: 'long-night',
    title: 'The Long Night',
    text: 'This Storm the hearth’s warm ring pulls in to half its reach. Homes past it freeze unless a brazier stands among them — a few braziers by the outer homes (or cutting the wood to turn it aside) is the answer.',
    when: longNight,
    urgent: true,
  },
  {
    id: 'envoy',
    title: 'The envoy is on her way',
    text: (run) =>
      `The Queen is satisfied: impatience no longer matters. Her envoy arrives as ${
        run.season.season === 'storm' ? 'this' : 'the next'
      } Storm ends, the forest’s last stand. Stock wood, light braziers by outer homes, keep everyone fed — collapse first and the run is lost.`,
    when: envoyRiding,
    urgent: true,
  },
  {
    id: 'first-caravan',
    title: 'A caravan is in town',
    text: 'It leaves soon. Check the Trade tab — it pays double for one good this visit, its stock rotates every caravan, and from the second visit it carries a rare blueprint or cornerstone.',
    when: (run) => run.caravan.here,
  },
  {
    id: 'caravan-amber',
    title: 'Amber is for spending',
    text: 'This caravan carries a rare find — a blueprint or cornerstone no draft promises. Amber also commissions 12 of any good for the next visit and signs one trade agreement a run. Unspent amber wins nothing.',
    when: (run) => run.caravan.here && !!run.caravan.rare && !run.caravan.rare.sold,
    doneWhen: (run) => !run.caravan.here,
  },
  {
    id: 'architect',
    title: "The Queen's Architect",
    text: 'Select the hearth: her architect sells plans for a service your settlers want — the next blueprint of its chain, yours at once. Each set costs more. A draft can also be redrawn toward a service.',
    when: (run) =>
      run.clock > 0 &&
      !run.architectPlans &&
      (run.stock.amber ?? 0) >= architectPrice(run) &&
      !run.pendingChoices.some((c) => c.kind === 'blueprint') &&
      architectOffers(run).length > 0,
    doneWhen: (run) => (run.architectPlans ?? 0) > 0,
  },
  {
    id: 'grand-petition',
    title: 'The Grand Petition',
    text: `Once a run, near the end of her patience: ${PETITION_AMBER} amber buys −${PETITION_RELIEF} impatience on a vow of ${PETITION_VOW_REPUTATION} reputation in ${PETITION_VOW_SECONDS / 60} minutes. Break it and she adds +${PETITION_BROKEN_IMPATIENCE}. It is in the Orders panel.`,
    when: petitionOpen,
    doneWhen: (run) => !!run.petition,
    urgent: true,
  },
  {
    id: 'retreat',
    title: 'Retreat to the Citadel',
    text: 'This run looks lost. The Orders panel offers a Retreat: end it now and send home the supplies it has earned so far — or play on for a turnaround.',
    when: retreatOffered,
    doneWhen: (run) => run.phase !== 'playing' || !retreatOffered(run),
    urgent: true,
  },
  {
    id: 'order-offer',
    title: 'An order slot is open',
    text: 'Choose its replacement in the Orders panel — the badge on its tab. The clock keeps running and an empty slot earns nothing; once a year you may ask for a different pair.',
    when: (run) => (run.orderOffers ?? []).length > 0,
    doneWhen: (run) => (run.orderOffers ?? []).length === 0,
  },
  {
    id: 'errand',
    title: 'An errand',
    text: 'While reputation stands still the settlement turns up small jobs — on the chip above the threats and in the Orders panel. Do one for a little reputation or amber; leave it and it lapses, no harm done.',
    when: (run) => openErrands(run).length > 0,
    doneWhen: (run) => (run.errandBook?.met ?? 0) > 0,
  },
  {
    id: 'stagnation',
    title: 'The Queen notices a stall',
    text: 'A minute after your last reputation point her impatience starts climbing faster, and faster the longer it stands still. Any new point resets it: meet an order or a decree, clear a glade, lift resolve over the line.',
    when: (run) =>
      run.reputation >= 1 && secondsSinceReputation(run) >= IMPATIENCE_STAGNATION_GRACE + 30,
  },
  {
    id: 'expectations',
    title: 'Rising expectations',
    text: `From Year 2 settlers take comfort for granted: a served species loses ${RESOLVE_EXPECTATION_PER_YEAR} resolve a year, and more past ${RESOLVE_EXPECTATION_CROWD_FROM} villagers. Keep adding services and food variety — People → Why? shows the cost.`,
    when: (run) => run.season.year >= 2 && population(run) > 0 && expectations(run) > 0,
  },
  {
    id: 'queens-court',
    title: "The Queen's court",
    text: 'From Year 2 the Orders panel lists her three levers on your patience: soothing her with amber, the once-a-run Grand Petition and the Retreat to the Citadel. Each says when it opens — learn them before you need them.',
    when: (run) => run.season.year >= PETITION_FROM_YEAR && run.phase === 'playing' && run.pendingChoices.length === 0,
  },
  {
    id: 'refined-needs',
    title: 'Finer tastes',
    text: (run) =>
      `Each people now hopes for a finer form of one need (${refinedList(run)}). Met, it adds resolve and eases rising expectations; missing it costs nothing. See People.`,
    when: (run) => population(run) > 0 && refinedUnlocked(run),
  },
  {
    id: 'land-profile',
    title: 'What the Queen values here',
    text: (run) =>
      `This land and commission change what earns her favour: ${describeProfile(runReputationProfile(run)).join(', ')}. Lean into it — the Orders panel lists the land.`,
    when: (run) =>
      !isFounding(run) && run.clock > 0 && describeProfile(runReputationProfile(run)).length > 0,
  },
  {
    id: 'glade-truce',
    title: 'The forest keeps count',
    text: `Every glade you reclaim makes hostility grow faster for the rest of the run. A border glade you do not need can be left to the forest from the Inspector: it calms hostility while it stands (breaking the truce costs ${SPARED_GLADE_RECLAIM_HOSTILITY}).`,
    when: (run) => run.stats.gladesCleared >= 3 && !anySpared(run),
    doneWhen: anySpared,
  },
]

/** The tip with this id, if any. */
export function tipById(id: string): Tip | undefined {
  return TIPS.find((t) => t.id === id)
}

/**
 * The corner tip to show next, if any: the first unseen one whose situation
 * holds. While the First steps checklist is open only urgent tips may
 * interrupt it.
 */
export function nextCornerTip(run: RunState, seen: readonly string[], checklist: boolean): Tip | null {
  return (
    TIPS.find(
      (tip) =>
        !tip.inDialog &&
        !seen.includes(tip.id) &&
        (!checklist || tip.urgent) &&
        tip.when(run) &&
        !tip.doneWhen?.(run),
    ) ?? null
  )
}

/**
 * The one dialog tip that may show right now: the first unseen in-dialog tip
 * whose situation holds. A dialog can hold more than one tip's place (the
 * Founding carries its own and the first draft's), but only this one shows,
 * so tips never stack up inside a dialog either.
 */
export function currentDialogTip(run: RunState, seen: readonly string[]): Tip | null {
  return TIPS.find((tip) => tip.inDialog && !seen.includes(tip.id) && tip.when(run)) ?? null
}
