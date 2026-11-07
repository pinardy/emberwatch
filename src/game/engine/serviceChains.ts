import { BLUEPRINT_POOL, BUILDINGS, BUILDING_LIST } from '../content/buildings'
import { SPECIES } from '../content/species'
import type { BuildingDef, ResourceId, RunState, ServiceNeed, SpeciesId } from '../types'

/**
 * Service chains: need → venue → the goods it hands out → their producers,
 * read from the building data. The draft, the charter's warrant, the
 * Architect and the caravan's rare plans all ask it what a settlement's
 * residents are still missing.
 */

/**
 * Buildings that would move the settlement toward satisfying a service its
 * residents actually want — either the venue itself or, once that is unlocked,
 * something that produces the goods it hands out.
 *
 * Derived from the building data rather than a hand-written table, so adding a
 * service or a recipe automatically feeds into the draft.
 */
export function relevantBlueprints(s: RunState): string[] {
  const present = [...new Set(Object.values(s.villagers).map((v) => v.species))]

  // How many residents care about each need — a venue that serves two species
  // is worth more than one that serves a single villager.
  const demand = serviceDemand(present)

  const ordered = [...demand.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([need]) => need)

  const missingVenue: string[] = []
  const missingSupply: string[] = []

  for (const need of ordered) {
    const venues = BUILDING_LIST.filter((b) => b.service?.need === need)
    const unlockedVenue = venues.find((v) => s.unlockedBuildings.includes(v.id))
    if (!unlockedVenue) {
      for (const v of venues) missingVenue.push(v.id)
      continue
    }
    // Venue is available; make sure something can supply the goods it hands out.
    for (const good of serviceGoods(unlockedVenue.id)) {
      const producers = producersOf(good)
      if (producers.some((p) => s.unlockedBuildings.includes(p.id))) continue
      for (const p of producers) missingSupply.push(p.id)
    }
  }

  /*
   * Finishing a chain beats starting another. A venue with nothing to hand out
   * is a wasted villager, so an unlocked-but-unsupplied service is the most
   * valuable thing the next draft can fix.
   */
  return [...missingSupply, ...missingVenue].filter(
    (id) => !s.unlockedBuildings.includes(id) && BLUEPRINT_POOL.includes(id),
  )
}

/**
 * The next locked blueprint of `need`'s chain: its venue while none is
 * unlocked, then a workshop for a good that venue hands out and nothing here
 * makes yet. `null` once the chain is whole (or nothing of it can be drafted).
 * Ordered the way the draft ranks pieces, so the same chain always asks for
 * the same next piece.
 */
export function chainPieceFor(s: RunState, need: ServiceNeed): string | null {
  const drafted = (id: string) => s.unlockedBuildings.includes(id)
  const venues = BUILDING_LIST.filter((b) => b.service?.need === need)
  const venue = venues.find((v) => drafted(v.id))
  if (!venue) return venues.find((v) => BLUEPRINT_POOL.includes(v.id))?.id ?? null
  for (const good of serviceGoods(venue.id)) {
    const producers = producersOf(good)
    if (producers.some((p) => drafted(p.id))) continue
    const piece = producers.find((p) => BLUEPRINT_POOL.includes(p.id))
    if (piece) return piece.id
  }
  return null
}

/** Which of these species want each service need, in need order of first appearance. */
export function serviceDemand(species: SpeciesId[]): Map<ServiceNeed, SpeciesId[]> {
  const demand = new Map<ServiceNeed, SpeciesId[]>()
  for (const sp of species) {
    for (const need of SPECIES[sp].needs) {
      demand.set(need, [...(demand.get(need) ?? []), sp])
    }
  }
  return demand
}

/** The goods a service venue hands out (its first recipe's inputs). */
function serviceGoods(venueId: string): ResourceId[] {
  return Object.keys(BUILDINGS[venueId]?.recipes[0]?.inputs ?? {}) as ResourceId[]
}

/** Buildings with a recipe that yields `good`. */
function producersOf(good: ResourceId): BuildingDef[] {
  return BUILDING_LIST.filter((b) =>
    b.recipes.some((r) => ((r.outputs as Record<string, number>)[good] ?? 0) > 0),
  )
}

export interface DraftAppeal {
  /** The need this building serves as a venue, and who in this run wants it. */
  serves?: { need: ServiceNeed; species: SpeciesId[] }
  /** Wanted needs whose venues hand out goods this building produces. */
  supplies: { need: ServiceNeed; species: SpeciesId[] }[]
}

/**
 * Why a blueprint matters to *this* settlement: which of its species want the
 * service it provides, and which wanted services it would supply. Uses the
 * same need → venue → goods → producer chain as `relevantBlueprints`, over the
 * species drawn for the run (residents and those still to arrive).
 */
export function draftAppeal(s: RunState, defId: string): DraftAppeal {
  const def = BUILDINGS[defId]
  const species = [...new Set([...s.speciesPool, ...Object.values(s.villagers).map((v) => v.species)])]
  const demand = serviceDemand(species)
  const appeal: DraftAppeal = { supplies: [] }
  if (!def) return appeal

  if (def.service) {
    appeal.serves = { need: def.service.need, species: demand.get(def.service.need) ?? [] }
  }
  for (const [need, wanting] of demand) {
    const venues = BUILDING_LIST.filter((b) => b.service?.need === need)
    const supplied = venues.some((v) =>
      serviceGoods(v.id).some((good) => producersOf(good).some((p) => p.id === defId)),
    )
    if (supplied) appeal.supplies.push({ need, species: wanting })
  }
  return appeal
}
