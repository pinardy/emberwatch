import { BUILDINGS } from '../../content/buildings'
import { COMMISSIONS, judgeCommission, type CommissionTerm } from '../../content/commissions'
import type { BuildingInstance, Glade, ResourceBag, RunState, Vec2 } from '../../types'
import { sootheCost, sootheQueen } from '../actions'
import { HEARTH_FUEL_PER_SECOND, SEASON_LENGTH } from '../balance'
import { computeModifiers } from '../modifiers'
import { foodStock, population, totalHousing } from '../queries'
import { AGREEMENT_PRICE, caravanAvailable, signAgreement } from '../trade'

/**
 * The balance harness's commission play (used only by the harness bot in `play.ts`).
 *
 * The harness bot plays every run the same way; with a Citadel commission it
 * also pursues the commission's terms the way a competent player would. Each
 * commission's tactics live here, apart from the bot's general decisions, and
 * reach the bot through a handful of optional hooks. A run without a
 * commission gets no tactics at all, so every hook falls back to the bot's
 * own default and the default-run numbers do not move.
 *
 * Tactics read their targets from the commission's own terms, so retuning a
 * term in `commissions.ts` retargets the bot with it.
 */

/** What the bot lends its tactics: its own placement and housing moves. */
export interface BotKit {
  tryPlace(s: RunState, defId: string, accept?: (pos: Vec2) => boolean): boolean
  buildHousing(s: RunState): boolean
  /** The building's recipe makes what the live decree asks for. */
  servesDecree(s: RunState, b: BuildingInstance): boolean
}

/** Amber the tactics keep back, like the bot's own threat reserve. */
const RESERVE = 30

export interface CommissionTactics {
  /** A build step ahead of services; true when it started something. */
  build?(s: RunState, kit: BotKit): boolean
  /** Staffing priority for a building, overriding the bot's (undefined = the bot's). */
  staffPriority?(s: RunState, b: BuildingInstance, kit: BotKit): number | undefined
  /** Wood below which woodcutters are an emergency and nothing is built or paved from wood. */
  woodFloor?(s: RunState): number
  /** Keep clearing glades as if an order asked for them. */
  wantsGlades?(s: RunState): boolean
  /** The border glade to clear next, ahead of the cheapest (undefined = the bot's). */
  preferGlade?(s: RunState, border: readonly Glade[]): Glade | undefined
  /** Hostility at which to spare the border (undefined = the bot's). */
  spareAt?(s: RunState): number | undefined
  /** The firekeeper's thresholds (undefined = the bot's). */
  ward?(s: RunState): { start: number; stop: number; minPopulation: number } | undefined
  /** A blueprint to take from a draft before the bot's own preferences. */
  blueprint?(s: RunState, options: readonly string[]): string | undefined
  /** Odds below which the bot begs off a decree (undefined = the bot's). */
  decreeBar?(s: RunState): number | undefined
  /** Once per decision, before trading: amber moves the commission wants. */
  act?(s: RunState): void
}

const NO_TACTICS: CommissionTactics = {}

function term<K extends CommissionTerm['kind']>(
  s: RunState,
  kind: K,
): Extract<CommissionTerm, { kind: K }> | undefined {
  const def = s.commission ? COMMISSIONS[s.commission] : undefined
  return def?.terms.find((t): t is Extract<CommissionTerm, { kind: K }> => t.kind === kind)
}

/** The target of the commission's first goal term of this kind. */
function goalAmount(s: RunState, goalKind: string, fallback: number): number {
  const def = s.commission ? COMMISSIONS[s.commission] : undefined
  for (const t of def?.terms ?? []) {
    if (t.kind === 'goal' && t.goal.kind === goalKind && 'amount' in t.goal) return t.goal.amount
  }
  return fallback
}

function countPlanned(s: RunState, defId: string): number {
  return Object.values(s.buildings).filter((b) => b.defId === defId).length
}

/** The opening a competent player lays before anything else: wood and food. */
function openingDone(s: RunState): boolean {
  const food =
    countPlanned(s, 'foragersCamp') + countPlanned(s, 'trappersCamp') + countPlanned(s, 'smallFarm')
  return countPlanned(s, 'woodcuttersCamp') >= 2 && food >= 2
}

// ---------------------------------------------------------------------------
// The commissions
// ---------------------------------------------------------------------------

/** A firekeeper from well under the forest's limit, for any calm-forest term. */
function forestWard(s: RunState): { start: number; stop: number; minPopulation: number } | undefined {
  const max = term(s, 'calmForest')?.max
  return max === undefined ? undefined : { start: max - 12, stop: max - 20, minPopulation: 8 }
}

/**
 * Hold the Frontier: keep clearing until the commission's count, then leave
 * every border glade to the forest at once and keep a firekeeper at the
 * hearth from a lower hostility, so the forest ends calm enough.
 */
const holdFrontier: CommissionTactics = {
  wantsGlades: (s) => s.stats.gladesCleared < goalAmount(s, 'gladesCleared', 12),
  spareAt: (s) => (s.stats.gladesCleared >= goalAmount(s, 'gladesCleared', 12) ? 0 : undefined),
  ward: forestWard,
}

/**
 * Found a Trade Town: raise the Trading Post as soon as wood and food are
 * laid down, raise it again if it falls, and buy the River Barges (more
 * frequent, longer caravans) while the count of caravans is short.
 */
const tradeTown: CommissionTactics = {
  build: (s, kit) =>
    countPlanned(s, 'tradingPost') < 1 && openingDone(s) && kit.tryPlace(s, 'tradingPost'),
  act: (s) => {
    const need = term(s, 'caravans')?.amount ?? 0
    if (!caravanAvailable(s) || s.caravan.agreement || s.caravan.visits >= need) return
    if ((s.stock.amber ?? 0) >= AGREEMENT_PRICE + RESERVE) signAgreement(s, 'barges')
  },
}

/**
 * The Queen's Favourite: amber the run would otherwise leave unspent buys
 * the Queen's patience back once the settlement is close to its charter, so
 * the run ends with her calm. Soothing early only gets refilled.
 */
const queensFavourite: CommissionTactics = {
  act: (s) => {
    const share = term(s, 'calmCourt')?.share ?? 0
    const limit = Math.floor(s.maxImpatience * share)
    if (s.reputation < s.maxReputation * 0.6) return
    let guard = 0
    while (
      Math.floor(s.impatience) > limit &&
      (s.stock.amber ?? 0) >= sootheCost(s) + RESERVE &&
      guard++ < 10
    ) {
      if (sootheQueen(s) !== null) break
    }
  },
}

/** Open Gates: homes kept well ahead of the people, while there is food. */
const openGates: CommissionTactics = {
  build: (s, kit) => {
    const pop = population(s)
    if (pop >= goalAmount(s, 'population', 24)) return false
    return totalHousing(s) < pop + 7 && foodStock(s) >= pop * 3 && kit.buildHousing(s)
  },
}

/**
 * Storm Watch: a woodpile that never empties, and a quiet forest. From the
 * Clearance on, the bot keeps back what the hearth and braziers will burn
 * through the rest of the coming Storm (ramping up as it nears): it places
 * nothing and lays no road from wood below that floor — except more
 * woodcutters — and staffs woodcutters as an emergency once the pile runs
 * under it. A firekeeper starts early and the border is spared sooner.
 */
const stormWatch: CommissionTactics = {
  ward: forestWard,
  spareAt: (s) => {
    const max = term(s, 'calmForest')?.max
    return max === undefined ? undefined : max - 8
  },
  woodFloor: (s) => {
    const { season, elapsed, length } = s.season
    if (season === 'drizzle') return 8
    const mods = computeModifiers(s)
    const braziers = Object.values(s.buildings).filter((b) => b.built && BUILDINGS[b.defId]?.warmth)
    const perSecond =
      HEARTH_FUEL_PER_SECOND * mods.hearthFuel +
      braziers.reduce((sum, b) => sum + (BUILDINGS[b.defId]?.warmth?.fuelPerSecond ?? 0), 0) *
        mods.hearthFuel *
        mods.brazierFuel
    if (season === 'storm') return 8 + perSecond * Math.max(0, length - elapsed)
    return 8 + perSecond * SEASON_LENGTH.storm * mods.seasonLength.storm * (elapsed / length)
  },
}

/**
 * Royal Works: until the count is met, take decrees the bot would beg off and
 * staff the live decree's makers ahead of the services.
 */
const decreesShort = (s: RunState) => (s.feats?.decreesMet ?? 0) < (term(s, 'decrees')?.amount ?? 0)
const royalWorks: CommissionTactics = {
  decreeBar: (s) => (decreesShort(s) ? 0.3 : undefined),
  staffPriority: (s, b, kit) => (decreesShort(s) && kit.servesDecree(s, b) ? 5.5 : undefined),
}

/**
 * The Deep Works: take the copper chain from a draft if the plans are not in
 * hand, clear toward a copper seam if none is at home, raise the smelter (the
 * dear part, in bricks — so a clay pit and brickyard first if none stands)
 * and then a mine on the seam, and keep them staffed — the mine only while
 * ore is short — until the bars are made.
 */
const COPPER_CHAIN = ['copperMine', 'smelter']
const copperShort = (s: RunState) =>
  (s.producedTotals.copperBar ?? 0) < goalAmount(s, 'produced', 15)
const deepWorks: CommissionTactics = {
  blueprint: (s, options) =>
    copperShort(s)
      ? COPPER_CHAIN.find((id) => options.includes(id) && !s.unlockedBuildings.includes(id))
      : undefined,
  preferGlade: (s, border) => {
    if (!copperShort(s) || countPlanned(s, 'copperMine') > 0) return undefined
    const seams = new Set(
      Object.values(s.deposits).filter((d) => d.kind === 'orePatch').map((d) => d.gladeId),
    )
    if ([...seams].some((id) => s.glades[id]?.cleared)) return undefined
    return border
      .filter((g) => !g.spared && seams.has(g.id))
      .sort((a, b) => a.clearWork - b.clearWork)[0]
  },
  build: (s, kit) => {
    if (!copperShort(s) || !openingDone(s) || population(s) < 8) return false
    if (countPlanned(s, 'smelter') < 1) {
      if (kit.tryPlace(s, 'smelter')) return true
      // Short of bricks: the brick chain the smelter is priced in.
      return ['clayPit', 'brickyard'].some((id) => countPlanned(s, id) < 1 && kit.tryPlace(s, id))
    }
    return countPlanned(s, 'copperMine') < 1 && kit.tryPlace(s, 'copperMine')
  },
  staffPriority: (s, b) => {
    if (!COPPER_CHAIN.includes(b.defId) || !copperShort(s)) return undefined
    const ore = s.stock.copperOre ?? 0
    if (b.defId === 'copperMine') return ore < 20 ? 4.6 : undefined
    return ore >= 2 ? 4.6 : undefined
  },
}

const TACTICS: Record<string, CommissionTactics> = {
  holdFrontier,
  tradeTown,
  queensFavourite,
  openGates,
  stormWatch,
  royalWorks,
  deepWorks,
  // Light Wagons and the Royal Survey ask nothing of a competent player but
  // to play well: no villager lost, the charter by Year 3.
}

/** The run's commission tactics; none (every hook at the bot's default) without one. */
export function tacticsFor(s: RunState): CommissionTactics {
  return (s.commission && TACTICS[s.commission]) || NO_TACTICS
}

/** True when the tactics allow spending `cost` (Storm Watch guards its woodpile). */
export function commissionAllowsSpend(s: RunState, defId: string, cost: ResourceBag): boolean {
  if (defId === 'woodcuttersCamp') return true
  const floor = tacticsFor(s).woodFloor?.(s)
  if (floor === undefined) return true
  const wood = cost.wood ?? 0
  return wood <= 0 || (s.stock.wood ?? 0) - wood >= floor
}

/** The commission's terms as they stand, for the harness log ('' without one). */
export function describeCommission(s: RunState): string {
  const verdict = judgeCommission(s)
  if (!verdict) return ''
  return verdict.terms
    .slice(1)
    .map((t) => `${t.label}: ${t.state} ${t.detail}`)
    .join('; ')
}
