import { BUILDINGS } from '../content/buildings'
import { NEED_LABELS, SPECIES, speciesSingular } from '../content/species'
import { RESOURCES } from '../content/resources'
import type { BuildingInstance, ResourceId, RunState, SpeciesId } from '../types'
import { DEPARTURE_GRACE, SECONDS_TO_LEAVE } from './balance'
import {
  RUNWAY_WARNING_SECONDS,
  STORM_FOOD_WARNING_LEAD,
  deadlineForecast,
  foodForecast,
  formatDuration,
  hearthForecast,
  secondsUntilStorm,
  storageBlocked,
  stormFoodForecast,
  type StormFoodForecast,
} from './forecast'
import { computeModifiers, type Modifiers } from './modifiers'
import { isFoodCamp } from './onboarding'
import {
  stormEndReach,
  activeRecipe,
  canAfford,
  idleVillagers,
  population,
  secondsUntilDeparture,
  totalHousing,
} from './queries'
import { coldVillagers, secondsUntilFrostLoss, villagersBeyond } from './society'
import { despairRate } from './traits'
import { petitionOpen, petitionVowLeft, retreatOffered } from './levers'
import { envoyPopulationFloor, envoyRiding } from './climax'
import { ENVOY_COLD_HEARTH_SECONDS, ENVOY_UNREST_SECONDS } from './balance'

/**
 * Things that are quietly going wrong.
 *
 * Every entry here is a failure mode the balance harness actually hit — an
 * unsupplied tavern, construction with nobody to build it, a settlement that
 * grew past its housing. They are invisible in the raw numbers, so the game
 * says them out loud rather than letting a run rot for five minutes.
 */
export interface Warning {
  id: string
  text: string
  severity: 'danger' | 'caution'
}

/**
 * Values a caller has already worked out for this state, so the HUD's shared
 * per-step bundle does not compute them twice. `stormFood` may be a throttled
 * stand-in for `stormFoodForecast`.
 */
export interface WarningInputs {
  mods?: Modifiers
  blocked?: BuildingInstance[]
  stormFood?: (s: RunState, mods: Modifiers) => StormFoodForecast
}

export function collectWarnings(s: RunState, inputs: WarningInputs = {}): Warning[] {
  const out: Warning[] = []
  if (s.phase !== 'playing') return out

  if (s.starving) {
    out.push({
      id: 'starving',
      severity: 'danger',
      text: '🍽️ Villagers are going hungry — resolve is collapsing.',
    })
  }

  const braziers = Object.values(s.buildings).filter(
    (b) => b.built && BUILDINGS[b.defId]?.warmth,
  )
  const unlit = braziers.filter((b) => b.unlit).length
  if (s.coldHearth) {
    out.push({
      id: 'cold',
      severity: 'danger',
      text:
        braziers.length > 0
          ? '🔥 The hearth and its braziers have gone out. They need wood.'
          : '🔥 The hearth has gone out. It needs wood.',
    })
  } else if (unlit > 0) {
    out.push({
      id: 'cold-braziers',
      severity: 'danger',
      text: `🏮 ${unlit} brazier${unlit > 1 ? 's have' : ' has'} gone cold — the homes around ${unlit > 1 ? 'them' : 'it'} are freezing. Bring wood.`,
    })
  }

  out.push(...envoyWarnings(s))

  // The cold kills: say who is out in it and how long until it takes someone.
  const frozen = coldVillagers(s)
  if (frozen > 0) {
    const eta = secondsUntilFrostLoss(s)
    out.push({
      id: 'frost',
      severity: 'danger',
      text: `🥶 ${frozen} villager${frozen > 1 ? 's sleep' : ' sleeps'} beyond every fire — the cold takes one in about ${formatDuration(eta)}. Raise a brazier or insulate their homes.`,
    })
  } else if (s.season.season === 'clearance') {
    // The hearth's reach pulls in through the Storm (further in a Long Night
    // or the forest's last stand): warn while there is time.
    const exposed = villagersBeyond(s, stormEndReach(s))
    if (exposed > 0) {
      out.push({
        id: 'frost-forecast',
        severity: 'caution',
        text: `🥶 By the Storm's end the hearth's reach leaves ${exposed} villager${exposed > 1 ? 's' : ''} sleeping in the cold, and the cold kills. A brazier or insulated homes keep them warm.`,
      })
    }
  }

  // A species in despair is on a visible countdown, not a silent one.
  for (const [sp, seconds] of Object.entries(secondsUntilDeparture(s))) {
    out.push({
      id: `leaving-${sp}`,
      severity: 'danger',
      text: departureText(s, sp as SpeciesId, seconds ?? 0),
    })
  }

  const mods = inputs.mods ?? computeModifiers(s)

  // Say so *before* the hearth goes out, while there is still time to chop.
  // The forecast counts every lit brazier, which shares the woodpile.
  if (!s.coldHearth) {
    const hearth = hearthForecast(s, mods)
    const fires = braziers.length > 0 ? 'Hearth and brazier' : 'Hearth'
    const seasonLeft = s.season.length - s.season.elapsed
    if (hearth.runway < RUNWAY_WARNING_SECONDS) {
      out.push({
        id: 'hearth-low',
        severity: 'danger',
        text: `🔥 ${fires} wood runs out in ${formatDuration(hearth.runway)}. Cut more wood.`,
      })
    } else if (s.season.season === 'storm' && hearth.stormShortfall > 0) {
      out.push({
        id: 'hearth-storm',
        severity: 'caution',
        text: `🔥 ${fires} wood lasts ${formatDuration(hearth.runway)}; the Storm has ${formatDuration(seasonLeft)} left.`,
      })
    } else if (s.season.season === 'clearance' && hearth.stormShortfall > 0) {
      out.push({
        id: 'hearth-storm',
        severity: 'caution',
        text: `🔥 Not enough wood for the Storm — about ${Math.ceil(hearth.stormShortfall)} more needed (it burns ${hearth.stormRate.toFixed(2)}/s).`,
      })
    }
  }

  const pop = population(s)
  if (!s.starving && pop > 0) {
    const food = foodForecast(s, mods)
    if (food.runway < RUNWAY_WARNING_SECONDS) {
      out.push({
        id: 'food-low',
        severity: 'caution',
        text: `🍽️ Food runs out in ${formatDuration(food.runway)} at the current rate.`,
      })
    } else {
      // The Storm halves gathering and stops farms: say so while there is
      // still a Drizzle or Clearance left to stock up in.
      const untilStorm = secondsUntilStorm(s)
      if (untilStorm !== null && untilStorm <= STORM_FOOD_WARNING_LEAD) {
        const storm = (inputs.stormFood ?? stormFoodForecast)(s, mods)
        if (storm.shortfall >= 1) {
          out.push({
            id: 'food-storm',
            severity: 'caution',
            text: `🍽️ Food won't last the Storm — about ${Math.ceil(storm.shortfall)} meals short. ${foodAdvice(s)}`,
          })
        }
      }
    }
  }

  const housing = totalHousing(s)
  if (pop > housing) {
    out.push({
      id: 'unhoused',
      severity: 'caution',
      text: `🛏 ${pop - housing} villagers have no bed. Build housing.`,
    })
  }

  // Construction only advances while somebody is idle.
  const sites = Object.values(s.buildings).filter((b) => !b.built).length
  if (sites > 0 && idleVillagers(s).length === 0) {
    out.push({
      id: 'no-builders',
      severity: 'caution',
      text: `🔨 ${sites} building${sites > 1 ? 's' : ''} stalled — idle villagers are your builders.`,
    })
  }

  // A full stockpile silently halts every producer at the brim.
  const blocked = inputs.blocked ?? storageBlocked(s, mods)
  if (blocked.length > 0) {
    out.push({
      id: 'storage-full',
      severity: 'caution',
      text: storageAdvice(s, blocked),
    })
  }

  // A service with no goods to hand out contributes nothing at all.
  const unsupplied = new Map<string, ResourceId[]>()
  const unstaffed = new Set<string>()
  for (const b of Object.values(s.buildings)) {
    const def = BUILDINGS[b.defId]
    if (!def?.service || !b.built || b.paused) continue
    if (b.workers.length === 0) {
      unstaffed.add(def.service.need)
      continue
    }
    const recipe = def.recipes[0]
    if (recipe && !canAfford(s.stock, recipe.inputs)) {
      const missing = (Object.keys(recipe.inputs) as ResourceId[]).filter(
        (id) => (s.stock[id] ?? 0) <= 0,
      )
      unsupplied.set(def.service.need, missing)
    }
  }

  for (const [need, missing] of unsupplied) {
    const goods = missing.map((id) => RESOURCES[id]?.name ?? id).join(', ')
    out.push({
      id: `unsupplied-${need}`,
      severity: 'caution',
      text: `${NEED_LABELS[need]?.icon ?? '🛎'} Your ${NEED_LABELS[need]?.name ?? need} service has no ${goods}.`,
    })
  }

  for (const need of unstaffed) {
    if (unsupplied.has(need)) continue
    out.push({
      id: `unstaffed-${need}`,
      severity: 'caution',
      text: `${NEED_LABELS[need]?.icon ?? '🛎'} Your ${NEED_LABELS[need]?.name ?? need} service has no worker.`,
    })
  }

  // The deadline is what ends a stalled run: count it down for its last year.
  const deadline = deadlineForecast(s, mods)
  if (deadline.imminent) {
    out.push({
      id: 'deadline',
      severity: deadline.secondsLeft <= RUNWAY_WARNING_SECONDS ? 'danger' : 'caution',
      text: `👑 The Queen's deadline is in ${formatDuration(deadline.secondsLeft)}. After it her impatience climbs faster every minute.`,
    })
  }

  const vowLeft = petitionVowLeft(s)
  if (vowLeft > 0 && s.petition) {
    const owed = s.petition.target - s.reputation
    out.push({
      id: 'petition-vow',
      severity: vowLeft <= RUNWAY_WARNING_SECONDS ? 'danger' : 'caution',
      text: `🕊️ Your vow to the Queen: ${owed} more reputation within ${formatDuration(vowLeft)}, or her patience snaps.`,
    })
  }

  // The levers for a run that is slipping away live in the Orders panel.
  const levers = [petitionOpen(s) && 'a Grand Petition', retreatOffered(s) && 'a Retreat to the Citadel']
    .filter(Boolean)
    .join(' or ')
  if (s.impatience >= s.maxImpatience - 3) {
    out.push({
      id: 'impatience',
      severity: 'danger',
      text: levers
        ? `⏳ The Queen is nearly out of patience — ${levers} is open in Orders.`
        : '⏳ The Queen is nearly out of patience.',
    })
  } else if (levers) {
    out.push({
      id: 'levers',
      severity: 'caution',
      text: `👑 The Queen's patience is running low — ${levers} is open in Orders.`,
    })
  }

  return out
}

/**
 * The departure countdown, worded from what has already happened: before
 * anyone has gone the species "will start leaving"; after a departure the rest
 * hold on through a grace period, and then "another will leave".
 */
function departureText(s: RunState, sp: SpeciesId, seconds: number): string {
  const rate = despairRate(sp)
  const inGrace = s.despair[sp] < 0
  if (!inGrace && !leftThisSpell(s, sp, rate)) {
    return `🚪 ${SPECIES[sp].name} will start leaving in ${Math.ceil(seconds)}s.`
  }
  const another = `🚪 Another ${speciesSingular(sp)} will leave in ${Math.ceil(seconds)}s`
  if (!inGrace) return `${another}.`
  const grace = Math.ceil(-s.despair[sp] / rate)
  return `${another} — the rest are holding on after a departure (${grace}s of grace left).`
}

/**
 * Whether a villager of `sp` walked out within the last despair cycle (grace
 * plus the countdown), read from the timeline's departure markers. The sim
 * keeps no other record: despair restarts below zero after a departure and is
 * back above it once the grace has run out.
 */
function leftThisSpell(s: RunState, sp: SpeciesId, rate: number): boolean {
  if (rate <= 0) return false
  const events = s.timeline?.events ?? []
  const cycle = (DEPARTURE_GRACE + SECONDS_TO_LEAVE) / rate
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    // Timeline times are rounded to 0.1s; allow a tick of slack.
    if (e.k === 'left' && e.d === sp) return s.clock - e.t <= cycle + 1
  }
  return false
}

/**
 * The full-stockpile warning, naming the fix that will actually work: the
 * good filling the store, and whether a Warehouse is in reach — or blocked
 * because the very producers it needs have stopped too, in which case
 * dumping or spending the surplus is the way out.
 */
function storageAdvice(s: RunState, blocked: BuildingInstance[]): string {
  const stopped = `${blocked.length} building${blocked.length > 1 ? 's have' : ' has'} stopped`
  let top: ResourceId | null = null
  for (const [id, amount] of Object.entries(s.stock) as [ResourceId, number][]) {
    if (id === 'amber' || amount <= 0) continue
    if (!top || amount > (s.stock[top] ?? 0)) top = id
  }
  const topName = top ? (RESOURCES[top]?.name ?? top) : 'goods'
  const head = `📦 Stockpile full of ${topName} — ${stopped}.`
  const dump = `dump some ${topName} (select the hearth or a warehouse)`
  const warehouse = BUILDINGS.warehouse
  if (!warehouse || !s.unlockedBuildings.includes('warehouse')) {
    return `${head} Spend or ${dump} to make room.`
  }
  if (canAfford(s.stock, warehouse.cost)) {
    return `${head} You can afford a Warehouse now — build one, or ${dump}.`
  }
  const missing = (Object.entries(warehouse.cost) as [ResourceId, number][])
    .map(([id, amount]) => [id, Math.ceil(amount - (s.stock[id] ?? 0))] as const)
    .filter(([, short]) => short > 0)
  const need = missing.map(([id, short]) => `${short} more ${RESOURCES[id]?.name ?? id}`).join(' and ')
  const stuck = missing.some(([id]) =>
    blocked.some((b) => activeRecipe(b)?.outputs[id] !== undefined),
  )
  if (stuck) {
    return `${head} A Warehouse needs ${need}, but the buildings that make it have stopped too: ${dump} to get them working.`
  }
  return `${head} A Warehouse needs ${need}; until then, ${dump}.`
}

/** The most useful next move for a larder that will not last the Storm. */
function foodAdvice(s: RunState): string {
  const camps = Object.values(s.buildings).filter((b) => isFoodCamp(b.defId))
  if (camps.length === 0) return "Build a Foragers' Camp."
  if (!camps.some((b) => b.workers.length > 0)) return 'Assign workers to your food camps.'
  return s.unlockedBuildings.includes('cookhouse')
    ? 'Build another food camp or a Cookhouse.'
    : 'Build another food camp.'
}

/**
 * While the Queen's envoy rides, what is closing in on a collapse that would
 * lose the run before she arrives: the hearth's cold seconds, unrest building,
 * and how many more villagers the settlement can lose.
 */
function envoyWarnings(s: RunState): Warning[] {
  if (!envoyRiding(s)) return []
  const e = s.envoy
  const out: Warning[] = []
  if (s.coldHearth) {
    const left = Math.max(0, ENVOY_COLD_HEARTH_SECONDS - e.coldSeconds)
    out.push({
      id: 'envoy-hearth',
      severity: 'danger',
      text: `🐎 The hearth is cold: ${formatDuration(left)} more in all and the settlement breaks up before the envoy arrives.`,
    })
  }
  if (e.unrestSeconds > 0) {
    out.push({
      id: 'envoy-unrest',
      severity: 'danger',
      text: `🐎 Most villagers are discontented, well below their reputation threshold: ${formatDuration(
        Math.max(0, ENVOY_UNREST_SECONDS - e.unrestSeconds),
      )} more of this unrest and the settlement breaks up before the envoy arrives.`,
    })
  }
  const spare = population(s) - envoyPopulationFloor(e)
  if (spare <= 1) {
    out.push({
      id: 'envoy-population',
      severity: spare <= 0 ? 'danger' : 'caution',
      text:
        spare <= 0
          ? '🐎 One more villager lost and the settlement cannot hold until the envoy arrives.'
          : '🐎 Two more villagers lost and the settlement cannot hold until the envoy arrives.',
    })
  }
  return out
}
