import {
  CITADEL_RUN_MODIFIER_LIST,
  MAX_RUN_MODIFIERS,
  RUN_MODIFIERS,
  RUN_MODIFIER_LIST,
  SECOND_MODIFIER_CHANCE,
} from '../content/runModifiers'
import type { MapgenHooks, ResourceId, RunModifierDef, RunState } from '../types'
import { hashInt, makeRng } from './rng'

/**
 * Run modifiers: drawing them from the seed, handing their hooks to map
 * generation, and recording their run-long effects in the run.
 */

/**
 * Salt for the modifier stream. Modifiers come from their own stream of the
 * run RNG — a pure function of the seed — so the setup screen can preview
 * them before the run exists, and drawing them does not shift the map RNG.
 *
 * The salt is XORed into the seed rather than passed as a cursor: `hashInt`
 * multiplies the cursor in floating point, and a cursor this large would lose
 * the seed's low bits (every small seed would draw the same modifiers).
 */
const MODIFIER_STREAM = 0x6d6f6473

/** The seed of the modifier stream for a run seed. */
export function modifierStreamSeed(seed: number): number {
  return hashInt((seed ^ MODIFIER_STREAM) >>> 0, 0)
}

/** True when `a` and `b` may not be drawn together (either side excludes). */
export function modifiersClash(a: RunModifierDef, b: RunModifierDef): boolean {
  return (a.excludes ?? []).includes(b.id) || (b.excludes ?? []).includes(a.id)
}

export interface DrawOptions {
  /** Citadel-locked modifier ids admitted to the pool. */
  unlocked?: readonly string[]
  /**
   * Which draw of this seed: 0 is the seed's own land, 1 the Second Survey's
   * re-roll. Each is its own deterministic stream.
   */
  reroll?: number
}

/** The pool a run draws from: the open list, then any Citadel-admitted lands. */
export function modifierPool(unlocked: readonly string[] = []): RunModifierDef[] {
  const admitted = CITADEL_RUN_MODIFIER_LIST.filter((d) => unlocked.includes(d.id))
  return admitted.length > 0 ? [...RUN_MODIFIER_LIST, ...admitted] : [...RUN_MODIFIER_LIST]
}

/**
 * The one or two modifiers a seed draws. Deterministic, and seed-only — with
 * no options it is exactly the draw every run has always had.
 */
export function drawRunModifiers(seed: number, options: DrawOptions = {}): string[] {
  const reroll = Math.max(0, Math.floor(options.reroll ?? 0))
  const streamSeed =
    reroll === 0 ? modifierStreamSeed(seed) : hashInt((seed ^ MODIFIER_STREAM) >>> 0, reroll)
  const rng = makeRng(streamSeed, 0)
  const count = rng.chance(SECOND_MODIFIER_CHANCE) ? MAX_RUN_MODIFIERS : 1
  const drawn: RunModifierDef[] = []
  // Admitted lands are appended, so the open pool's indices never move.
  let pool = modifierPool(options.unlocked)
  while (drawn.length < count && pool.length > 0) {
    const pick = rng.pick(pool)
    drawn.push(pick)
    pool = pool.filter((d) => d.id !== pick.id && !modifiersClash(d, pick))
  }
  return drawn.map((d) => d.id)
}

/** What the setup screen lets a Citadel-equipped player do with the land. */
export interface LandChoice {
  /** Use the Second Survey's re-roll instead of the seed's own land. */
  reroll?: boolean
  /** Chosen Ground: this modifier is guaranteed; the draw fills the rest. */
  chosen?: string
}

/** The land-shaping powers a Citadel loadout grants. */
export interface LandPowers {
  unlockModifiers: readonly string[]
  landRerolls: number
  chooseModifier: boolean
}

/**
 * The modifiers a run gets from its seed, the Citadel's land powers and the
 * player's setup choices. Choices the powers do not allow are ignored, so a
 * player without the upgrades always gets the plain seed draw.
 */
export function landFor(seed: number, powers: LandPowers, choice: LandChoice = {}): string[] {
  const unlocked = powers.unlockModifiers
  const drawn = drawRunModifiers(seed, {
    unlocked,
    reroll: choice.reroll && powers.landRerolls > 0 ? 1 : 0,
  })
  const chosen = choice.chosen ? RUN_MODIFIERS[choice.chosen] : undefined
  if (!powers.chooseModifier || !chosen) return drawn
  if (!modifierPool(unlocked).some((d) => d.id === chosen.id)) return drawn
  const rest = runModifierDefs(drawn).filter((d) => d.id !== chosen.id && !modifiersClash(d, chosen))
  return [chosen.id, ...rest.map((d) => d.id)].slice(0, MAX_RUN_MODIFIERS)
}

/** Known modifier defs for a list of ids, skipping unknown ones (old saves). */
export function runModifierDefs(ids: readonly string[]): RunModifierDef[] {
  return ids.map((id) => RUN_MODIFIERS[id]).filter((d): d is RunModifierDef => !!d)
}

function mergeScale<K extends string>(
  into: Partial<Record<K, number>> | undefined,
  from: Partial<Record<K, number>> | undefined,
): Partial<Record<K, number>> | undefined {
  if (!from) return into
  const out: Partial<Record<K, number>> = { ...(into ?? {}) }
  for (const [key, value] of Object.entries(from) as [K, number | undefined][]) {
    out[key] = (out[key] ?? 1) * (value ?? 1)
  }
  return out
}

/** Every drawn modifier's map hooks, combined multiplicatively. */
export function mapgenHooksFor(ids: readonly string[]): MapgenHooks {
  const hooks: MapgenHooks = {}
  for (const def of runModifierDefs(ids)) {
    const h = def.mapgen
    if (!h) continue
    hooks.themeWeights = mergeScale(hooks.themeWeights, h.themeWeights)
    hooks.depositScale = mergeScale(hooks.depositScale, h.depositScale)
    hooks.rewardScale = mergeScale(hooks.rewardScale, h.rewardScale)
    hooks.layoutWeights = mergeScale(hooks.layoutWeights, h.layoutWeights)
    hooks.biomeWeights = mergeScale(hooks.biomeWeights, h.biomeWeights)
    if (h.smallGladeOdds !== undefined) {
      hooks.smallGladeOdds = (hooks.smallGladeOdds ?? 1) * h.smallGladeOdds
    }
  }
  return hooks
}

/** Id of the ongoing effect a modifier records, so the UI can tell them apart. */
export function modifierOngoingId(id: string): string {
  return `land_${id}`
}

/**
 * Records the drawn modifiers on a fresh run: run-long effects become ongoing
 * entries, and one-off grants (impatience, stock) land on the spot.
 */
export function applyRunModifiers(s: RunState, ids: readonly string[]): void {
  s.runModifiers = [...ids]
  for (const def of runModifierDefs(ids)) {
    if (def.effects && def.effects.length > 0) {
      s.ongoing.push({
        id: modifierOngoingId(def.id),
        name: def.name,
        icon: def.icon,
        description: def.description,
        effects: def.effects,
      })
    }
    if (def.startImpatience) {
      s.impatience = Math.min(s.maxImpatience - 1, s.impatience + def.startImpatience)
    }
    for (const [id, amount] of Object.entries(def.startStock ?? {})) {
      const key = id as ResourceId
      s.stock[key] = (s.stock[key] ?? 0) + (amount ?? 0)
    }
  }
}
