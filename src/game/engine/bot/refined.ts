import { ACHIEVEMENT_LIST } from '../../content/achievements'
import { BUILDINGS } from '../../content/buildings'
import { SPECIES_LIST } from '../../content/species'
import type { BuildingInstance, Recipe, RefinedNeedDef, ResourceId, RunState, SpeciesId } from '../../types'
import { population, speciesCounts } from '../queries'
import { computeModifiers } from '../modifiers'
import { refinedNeedOf, refinedStatus, refinedUnlocked } from '../refinedNeeds'
import { resolveBreakdowns } from '../society'
import { recipesAt, recipesOf, tierOf } from '../upgrades'

/**
 * The harness bot's play for second-tier needs (`engine/refinedNeeds.ts`):
 * once the settlement is about to want them, raise the venue a tier or set a
 * workshop to the finer good — only where the base need's venue already
 * stands, and only with what can be afforded at the time.
 */

/** The bot's own moves this needs, lent by `play.ts`. */
export interface RefinedKit {
  tryPlace: (s: RunState, defId: string) => boolean
  tryUpgrade: (s: RunState, defIds: string[]) => boolean
  /** Worker slots per villager (new workplaces wait while it is high). */
  slotPressure: (s: RunState) => number
}

/** Refined needs worth working toward now: species present, need not yet met. */
function wantedRefined(s: RunState): { species: SpeciesId; def: RefinedNeedDef }[] {
  const pop = population(s)
  if (!refinedUnlocked(s, pop)) return []
  const counts = speciesCounts(s)
  // A refined need pays only once the species' base needs are all met.
  const served = new Set(
    resolveBreakdowns(s, computeModifiers(s))
      .filter((b) => b.needsMet >= 1)
      .map((b) => b.species),
  )
  return s.speciesPool
    .filter((sp) => counts[sp] > 0 && served.has(sp))
    .sort((a, b) => counts[b] - counts[a])
    .flatMap((species) => {
      const def = refinedNeedOf(species)
      if (!def) return []
      return refinedStatus(s, species, pop)?.met ? [] : [{ species, def }]
    })
}

/**
 * A workshop recipe that makes `good` from other goods. Camps that gather it
 * (herbs) are left to the bot's usual spread, which already keeps them busy.
 */
function makes(r: Recipe, good: ResourceId): boolean {
  return (r.outputs[good] ?? 0) > 0 && Object.keys(r.inputs).length > 0
}

/** The building (and tier) whose recipe makes `good`, if any. */
function producerOf(good: ResourceId): { defId: string; tier: number; recipe: string } | null {
  for (const def of Object.values(BUILDINGS)) {
    if (def.service) continue
    const tiers = def.upgrades?.length ?? 0
    for (let tier = 0; tier <= tiers; tier++) {
      const recipe = recipesAt(def.id, tier).find((r) => makes(r, good))
      if (recipe) return { defId: def.id, tier, recipe: recipe.id }
    }
  }
  return null
}

const venueOf = (s: RunState, def: RefinedNeedDef) =>
  Object.values(s.buildings).filter((b) => b.built && BUILDINGS[b.defId]?.service?.need === def.need)

/**
 * One build step toward a refined need: an upgrade of the venue or of the
 * workshop that makes the finer good, or that workshop itself. True when
 * something was started.
 */
export function pursueRefinedNeeds(s: RunState, kit: RefinedKit): boolean {
  for (const { def } of wantedRefined(s)) {
    const venues = venueOf(s, def)
    // The base need comes first: its venue is `buildServices`' job.
    if (venues.length === 0) continue
    if ((def.venueTier ?? 0) > 0 && !venues.some((b) => tierOf(b) >= (def.venueTier ?? 0))) {
      if (kit.tryUpgrade(s, [venues[0].defId])) return true
      continue
    }
    if (!def.good) continue
    const maker = producerOf(def.good)
    if (!maker || !s.unlockedBuildings.includes(maker.defId)) continue
    const makers = Object.values(s.buildings).filter((b) => b.defId === maker.defId)
    if (makers.length === 0) {
      if (kit.slotPressure(s) < 1.6 && kit.tryPlace(s, maker.defId)) return true
      continue
    }
    if (!makers.some((b) => b.built && tierOf(b) >= maker.tier) && kit.tryUpgrade(s, [maker.defId])) {
      return true
    }
  }
  return false
}

/** Stock of the finer good at which a workshop switches to it, and back. */
const REFINED_LOW = 6
const REFINED_HIGH = 14

/**
 * The recipe `b` should run for a refined good right now, or null to leave it
 * to the bot's usual recipe spread. One workshop per good at a time switches
 * over while the good runs low and its inputs are plentiful (so a tavern's
 * ale is never brewed away), and back once a stack is laid in.
 */
export function refinedRecipeFor(s: RunState, b: BuildingInstance): string | null {
  if (!b.built || !refinedUnlocked(s)) return null
  const counts = speciesCounts(s)
  for (const sp of s.speciesPool) {
    const def = refinedNeedOf(sp)
    if (!def?.good || counts[sp] <= 0 || venueOf(s, def).length === 0) continue
    const recipe = recipesOf(b).find((r) => makes(r, def.good!))
    if (!recipe) continue
    const stock = s.stock[def.good] ?? 0
    if (b.activeRecipeId === recipe.id) {
      const fed = Object.entries(recipe.inputs).every(
        ([id, n]) => (s.stock[id as ResourceId] ?? 0) >= (n ?? 0) + 2,
      )
      return stock < REFINED_HIGH && fed ? recipe.id : null
    }
    const other = Object.values(s.buildings).some(
      (o) => o.id !== b.id && o.built && o.activeRecipeId === recipe.id,
    )
    const plenty = Object.entries(recipe.inputs).every(
      ([id, n]) => (s.stock[id as ResourceId] ?? 0) >= (n ?? 0) * 3 + 4,
    )
    if (!other && stock < REFINED_LOW && plenty) return recipe.id
  }
  return null
}

/**
 * Sets workshops the bot's recipe spread leaves alone (`spread` holds the
 * producers it manages) to a refined good when `refinedRecipeFor` says so,
 * and back to their first recipe once it does not.
 */
export function tuneRefinedRecipes(
  s: RunState,
  spread: ReadonlySet<string>,
  setRecipe: (s: RunState, id: string, recipe: string) => unknown,
): void {
  for (const b of Object.values(s.buildings)) {
    if (!b.built || spread.has(b.defId) || BUILDINGS[b.defId]?.service) continue
    const target = refinedRecipeFor(s, b)
    if (target) setRecipe(s, b.id, target)
    else if (refinedRecipeIds.has(b.activeRecipeId)) setRecipe(s, b.id, recipesOf(b)[0].id)
  }
}

const refinedGoods = new Set<string>(
  SPECIES_LIST.map((d) => d.refined?.good).filter((g): g is ResourceId => !!g),
)

/** Recipes that make a refined good (spiced ale, incense). */
const refinedRecipeIds = new Set(
  Object.values(BUILDINGS).flatMap((def) =>
    [0, ...(def.upgrades ?? []).map((_, i) => i + 1)].flatMap((tier) =>
      recipesAt(def.id, tier)
        .filter((r) => [...refinedGoods].some((g) => makes(r, g as ResourceId)))
        .map((r) => r.id),
    ),
  ),
)

// ---------------------------------------------------------------------------
// What the harness reports about refined needs and style achievements
// ---------------------------------------------------------------------------

export interface RefinedReport {
  /** Species present at the end whose refined need was fully met at some point. */
  refinedMet: number
  /** Species present at the end. */
  refinedOf: number
  /** Their refined needs fully met at the end. */
  refinedAtEnd: number
  /** Every present species' refined need was met at once at some point. */
  refinedAll: boolean
  /** Style achievements the finished run earns. */
  style: string[]
}

export function refinedReport(s: RunState): RefinedReport {
  const counts = speciesCounts(s)
  const present = s.speciesPool.filter((sp) => counts[sp] > 0)
  const met = new Set(s.feats?.refinedMet ?? [])
  return {
    refinedMet: present.filter((sp) => met.has(sp)).length,
    refinedOf: present.length,
    refinedAtEnd: resolveBreakdowns(s, computeModifiers(s)).filter(
      (b) => counts[b.species] > 0 && b.refinedStatus?.met && b.refinedStatus.basicsMet,
    ).length,
    refinedAll: s.feats?.refinedAll === true,
    style: ACHIEVEMENT_LIST.filter(
      (d) => d.tier === 'style' && d.when?.(s, { dailyStreak: 0 }),
    ).map((d) => d.id),
  }
}

/** One harness line: refined needs met, and the style achievements earned. */
export function refinedSummary(reports: RefinedReport[]): string {
  const sum = (pick: (r: RefinedReport) => number) => reports.reduce((n, r) => n + pick(r), 0)
  const styles = new Map<string, number>()
  for (const r of reports) for (const id of r.style) styles.set(id, (styles.get(id) ?? 0) + 1)
  const styleText = ACHIEVEMENT_LIST.filter((d) => d.tier === 'style')
    .map((d) => `${d.id} ${styles.get(d.id) ?? 0}`)
    .join(' ')
  return (
    `refined met ${sum((r) => r.refinedMet)}/${sum((r) => r.refinedOf)} species (at end ${sum((r) => r.refinedAtEnd)})` +
    ` · all at once in ${reports.filter((r) => r.refinedAll).length}/${reports.length} runs` +
    ` · style achievements/run ${(sum((r) => r.style.length) / Math.max(1, reports.length)).toFixed(2)}: ${styleText}`
  )
}
