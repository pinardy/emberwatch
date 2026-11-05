import {
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

/** The one or two modifiers a seed draws. Deterministic, and seed-only. */
export function drawRunModifiers(seed: number): string[] {
  const rng = makeRng(modifierStreamSeed(seed), 0)
  const count = rng.chance(SECOND_MODIFIER_CHANCE) ? MAX_RUN_MODIFIERS : 1
  const drawn: RunModifierDef[] = []
  let pool = [...RUN_MODIFIER_LIST]
  while (drawn.length < count && pool.length > 0) {
    const pick = rng.pick(pool)
    drawn.push(pick)
    pool = pool.filter((d) => d.id !== pick.id && !modifiersClash(d, pick))
  }
  return drawn.map((d) => d.id)
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
