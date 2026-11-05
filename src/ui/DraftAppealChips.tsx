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
 * On a blueprint draft card: which of this run's species want the service it
 * provides, or the wanted services its goods would supply. Icons for a glance,
 * with the species named in text for screen readers and on hover.
 */
export function DraftAppealChips({ run, defId }: { run: RunState; defId: string }) {
  const appeal = draftAppeal(run, defId)
  return (
    <>
      {appeal.serves && <NeedChip need={appeal.serves.need} species={appeal.serves.species} />}
      {appeal.supplies.map(({ need, species }) => (
        <NeedChip key={need} need={need} species={species} supplies />
      ))}
    </>
  )
}

function NeedChip({
  need,
  species,
  supplies = false,
}: {
  need: ServiceNeed
  species: SpeciesId[]
  supplies?: boolean
}) {
  const label = NEED_LABELS[need]
  const name = label?.name ?? need
  const who =
    species.length > 0 ? `wanted by ${speciesNames(species)}` : 'none of your species want it'
  const summary = `${supplies ? 'Supplies ' : ''}${name} — ${who}`
  return (
    <span
      className={`draft-need ${species.length > 0 ? 'is-wanted' : 'is-unwanted'}`}
      title={summary}
      data-testid="draft-need"
    >
      <span aria-hidden>
        <Icon id={NEED_ART[need]} emoji={label?.icon} />{' '}
      </span>
      {supplies ? `Supplies ${name}` : name}
      {species.length > 0 ? (
        <>
          {' '}
          <span aria-hidden>
            ({species.map((sp) => (
              <Icon key={sp} of={SPECIES[sp]} />
            ))})
          </span>
          <span className="sr-only">, {who}</span>
        </>
      ) : (
        <span className="draft-need-none"> · not wanted</span>
      )}
    </span>
  )
}
