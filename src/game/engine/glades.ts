import { GLADE_EVENTS } from '../content/gladeEvents'
import { EDIBLE, resourceName } from '../content/resources'
import { speciesSingular } from '../content/species'
import type { Glade, GladeEventOptionDef, ResourceBag, ResourceId, RunState } from '../types'
import { CLEAR_RATE_PER_VILLAGER, GLADES_PER_REPUTATION, HOSTILITY_PER_GLADE_CLEARED } from './balance'
import { gladeEventOptions } from './citadel'
import type { Modifiers } from './modifiers'
import { addVillager } from './newcomers'
import { addCondition } from './outcomes'
import { refreshDepositCaches } from './production'
import { canAfford, edibleTotal, grantProduced, spend } from './queries'
import { pushLog } from './runLog'
import { addImpatience, addReputation, loseVillager, pickVictim, unassign } from './society'
import { formatReputation, gainReputation, reputationFor } from './reputation'
import { unleashThreat } from './threats'
import { recordEvent } from './timeline'
import { clearMultiplier } from './traits'

/**
 * Glades: clearing them, what the event waiting in one puts at stake, and
 * paying for and applying the option the player picks when it opens.
 */

/** Scales a resource bag, rounding to whole units. */
function scaleBag(bag: ResourceBag, factor: number): ResourceBag {
  if (factor === 1) return bag
  const out: ResourceBag = {}
  for (const [id, amount] of Object.entries(bag)) {
    const qty = Math.round((amount ?? 0) * factor)
    if (qty > 0) out[id as ResourceId] = qty
  }
  return out
}

/** Advances any glade with villagers assigned to clearing it. */
export function stepClearing(s: RunState, dt: number, mods: Modifiers): void {
  // Per-glade clearing power: harpies and pathfinders count for more.
  const power: Record<string, number> = {}
  for (const v of Object.values(s.villagers)) {
    if (!v.assignment?.startsWith('clearing:')) continue
    const gladeId = v.assignment.slice('clearing:'.length)
    power[gladeId] = (power[gladeId] ?? 0) + CLEAR_RATE_PER_VILLAGER * clearMultiplier(v)
  }

  for (const glade of Object.values(s.glades)) {
    if (glade.cleared || glade.clearers <= 0) continue
    glade.clearProgress += (power[glade.id] ?? 0) * mods.clearSpeed * dt
    if (glade.clearProgress < glade.clearWork) continue

    // --- glade taken ------------------------------------------------------
    glade.cleared = true
    glade.clearProgress = glade.clearWork
    s.stats.gladesCleared++
    recordEvent(s, 'glade')

    // Send the clearing crew back to the idle pool.
    for (const v of Object.values(s.villagers)) {
      if (v.assignment === `clearing:${glade.id}`) unassign(s, v.id)
    }
    glade.clearers = 0

    for (const id of glade.neighbors) s.glades[id].discovered = true
    glade.discovered = true

    const loot = scaleBag(glade.reward, mods.gladeLoot)
    grantProduced(s, loot)
    s.hostility += HOSTILITY_PER_GLADE_CLEARED * mods.gladeHostility

    refreshDepositCaches(s)

    pushLog(s, `${glade.name} has been cleared. The forest pushes back.`, 'good')

    /*
     * Reclaimed land is what the Queen actually sent you for, so expansion pays
     * reputation as well as costing hostility. Without this, clearing is a pure
     * downside once you have the deposits you need, and the run has no engine
     * other than waiting for resolve to tick over.
     */
    if (s.stats.gladesCleared % GLADES_PER_REPUTATION === 0) {
      const reputation = reputationFor(s, 'glades', 1)
      gainReputation(s, reputation, 'glades')
      pushLog(
        s,
        `The Citadel notes your reclaimed land. +${formatReputation(reputation)} ${s.envoy ? 'glory' : 'reputation'}.`,
        'good',
      )
    }

    if (glade.eventId) {
      s.pendingChoices.push({
        kind: 'gladeEvent',
        options: [glade.eventId],
        gladeId: glade.id,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// What a glade's event puts at stake
// ---------------------------------------------------------------------------

/** Kinds of outcome a glade's waiting event can lead to, worst first. */
export type GladeStake = 'lives' | 'threat' | 'condition' | 'reputation' | 'pact'

/**
 * What the event waiting in a glade could lead to — read from its options,
 * never naming the event — so the map can say "a threat may wait here" and
 * clearing order is a decision rather than whichever glade is cheapest.
 * Empty for a glade with no event (or one already cleared).
 */
export function gladeStakes(s: RunState, gladeId: string): GladeStake[] {
  const glade = s.glades[gladeId]
  return glade ? gladeStakesOf(glade) : []
}

/** `gladeStakes` for a glade in hand (pure: reads only its waiting event). */
export function gladeStakesOf(glade: Pick<Glade, 'cleared' | 'eventId'>): GladeStake[] {
  const def = !glade.cleared && glade.eventId ? GLADE_EVENTS[glade.eventId] : undefined
  if (!def) return []
  const found = new Set<GladeStake>()
  for (const o of def.options) {
    if (o.villagerLoss || o.threat?.strike.villagerLoss) found.add('lives')
    if (o.threat) found.add('threat')
    if (o.condition) found.add('condition')
    if (o.reputation || o.condition?.onResolve?.reputation) found.add('reputation')
    if (o.ongoing) found.add('pact')
  }
  const order: GladeStake[] = ['lives', 'threat', 'condition', 'reputation', 'pact']
  return order.filter((k) => found.has(k))
}

/** Short words for each stake, for plates' titles and the Inspector. */
export const GLADE_STAKE_LABEL: Record<GladeStake, { text: string }> = {
  lives: { text: 'lives' },
  threat: { text: 'a threat' },
  condition: { text: 'a lingering task' },
  reputation: { text: 'reputation' },
  pact: { text: 'a pact' },
}

/** "a threat, lives or reputation" — the stakes in a sentence. */
export function describeStakes(stakes: GladeStake[]): string {
  const words = stakes.map((k) => GLADE_STAKE_LABEL[k].text)
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`
}

// ---------------------------------------------------------------------------
// Option prices
// ---------------------------------------------------------------------------

/** True when the stockpile can pay everything a glade-event option asks for. */
export function optionAffordable(stock: ResourceBag, option: GladeEventOptionDef): boolean {
  if (option.requires && !canAfford(stock, option.requires)) return false
  if (option.foodCost && edibleTotal(stock) < option.foodCost) return false
  return true
}

/**
 * Why an option cannot be chosen, in words: "Needs 10 food — you have 6".
 * Null when the stockpile can pay. Mirrors `optionAffordable`.
 */
export function describeOptionShortfall(
  stock: ResourceBag,
  option: GladeEventOptionDef,
): string | null {
  const parts: string[] = []
  if (option.foodCost) {
    const have = Math.floor(edibleTotal(stock))
    if (have < option.foodCost) parts.push(`${option.foodCost} food — you have ${have}`)
  }
  for (const [id, amount] of Object.entries(option.requires ?? {})) {
    const have = Math.floor(stock[id as ResourceId] ?? 0)
    if (have < (amount ?? 0)) {
      parts.push(`${amount} ${resourceName(id as ResourceId)} — you have ${have}`)
    }
  }
  return parts.length > 0 ? `Needs ${parts.join('; ')}` : null
}
/**
 * Plain-text price of an option, e.g. "10 food, 5 Ale". Pure, so the UI can
 * show `foodCost` alongside the resource bag without knowing the rule.
 */
export function describeOptionCost(option: GladeEventOptionDef): string {
  const parts: string[] = []
  if (option.foodCost) parts.push(`${option.foodCost} food`)
  for (const [id, amount] of Object.entries(option.cost ?? {})) {
    if ((amount ?? 0) > 0) parts.push(`${amount} ${resourceName(id as ResourceId)}`)
  }
  return parts.join(', ')
}

/**
 * Pays `amount` food from whatever is edible, one unit at a time from the
 * largest stack — the same order villagers eat in, so a price never wipes out
 * a whole food type (and its variety bonus) while another stack sits full.
 */
export function spendFood(stock: ResourceBag, amount: number): void {
  for (let paid = 0; paid < amount; paid++) {
    let best: ResourceId | null = null
    for (const id of EDIBLE) {
      if ((stock[id] ?? 0) <= 0) continue
      if (!best || (stock[id] ?? 0) > (stock[best] ?? 0)) best = id
    }
    if (!best) return
    stock[best] = (stock[best] ?? 0) - 1
    if ((stock[best] ?? 0) <= 0) delete stock[best]
  }
}

/** Applies the chosen option of the front-of-queue glade event. */
export function resolveGladeEvent(s: RunState, optionIndex: number): void {
  const choice = s.pendingChoices[0]
  if (!choice || choice.kind !== 'gladeEvent') return
  const def = GLADE_EVENTS[choice.options[0]]
  const option = def ? gladeEventOptions(s, def)[optionIndex] : undefined
  if (!def || !option) return
  if (!optionAffordable(s.stock, option)) return

  if (option.cost) spend(s.stock, option.cost)
  if (option.foodCost) spendFood(s.stock, option.foodCost)
  if (option.gain) {
    grantProduced(s, option.gain)
  }
  if (option.hostility) s.hostility = Math.max(0, s.hostility + option.hostility)
  if (option.impatience) addImpatience(s, option.impatience)
  if (option.reputation) addReputation(s, option.reputation)
  if (option.villagerLoss) {
    for (let i = 0; i < option.villagerLoss; i++) {
      const victim = pickVictim(s)
      if (!victim) break
      loseVillager(s, victim)
      pushLog(s, `${victim.name} the ${speciesSingular(victim.species)} is lost.`, 'bad')
    }
  }
  if (option.villagerGain) {
    for (let i = 0; i < option.villagerGain; i++) addVillager(s)
  }

  if (option.threat) unleashThreat(s, option.threat, choice.gladeId ?? '')

  if (option.ongoing) {
    s.ongoing.push({ ...option.ongoing, id: `g${s.ongoing.length}_${def.id}` })
    pushLog(s, `${option.ongoing.name}: ${option.ongoing.description}`, 'info')
  }

  if (option.condition) addCondition(s, option.condition, choice.gladeId ?? '')

  pushLog(s, `${def.name}: ${option.label}.`, option.hostility && option.hostility > 0 ? 'bad' : 'info')
  s.pendingChoices.shift()
}
