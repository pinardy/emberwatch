import { NEED_ART } from '../game/content/art'
import { NEED_LABELS, SPECIES } from '../game/content/species'
import { draftAppeal } from '../game/engine/events'
import type { RunState, ServiceNeed, SpeciesId } from '../game/types'
import { Icon } from './Icon'
import './draft-appeal.css'

/** "Humans and Beavers", "Humans, Beavers and Foxes". */
export function speciesNames(species: SpeciesId[]): string {
  const names = species.map((sp) => SPECIES[sp].name)
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * On a blueprint draft card: what the building does for services — the need
 * it serves as a venue, or the needs whose goods it supplies. It deliberately
 * does not say who wants it: which needs to chase is the draft's decision, and
 * the People panel already shows each species' unmet needs.
 */
export function DraftAppealChips({ run, defId }: { run: RunState; defId: string }) {
  const appeal = draftAppeal(run, defId)
  return (
    <>
      {appeal.serves && <NeedChip need={appeal.serves.need} />}
      {appeal.supplies.map(({ need }) => (
        <NeedChip key={need} need={need} supplies />
      ))}
    </>
  )
}

function NeedChip({ need, supplies = false }: { need: ServiceNeed; supplies?: boolean }) {
  const label = NEED_LABELS[need]
  const name = label?.name ?? need
  const summary = supplies
    ? `Makes the goods a ${name} service hands out`
    : `A ${name} service — check the People panel for who needs it`
  return (
    <span className="draft-need" title={summary} data-testid="draft-need">
      <span aria-hidden>
        <Icon id={NEED_ART[need]} emoji={label?.icon} />{' '}
      </span>
      {supplies ? `Supplies ${name}` : `Serves ${name}`}
    </span>
  )
}
