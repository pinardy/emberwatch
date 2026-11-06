import { Fragment } from 'react'
import { RESOURCES } from '../game/content/resources'
import type { ResourceBag, ResourceId } from '../game/types'
import { Icon } from './Icon'

/**
 * Each resource in a bag as its drawn icon and amount, one span apiece (given
 * `className`). `title` names each on hover; `label` announces the icons, for
 * places where no name is written beside them.
 */
export function BagIcons({
  bag,
  className,
  title = false,
  label = false,
}: {
  bag: ResourceBag
  className?: string
  title?: boolean
  label?: boolean
}) {
  return (
    <>
      {(Object.entries(bag) as [ResourceId, number][]).map(([id, amount]) => {
        const def = RESOURCES[id]
        // The space between items shows inline and is dropped in a flex row.
        return (
          <Fragment key={id}>
            <span className={className} title={title ? def?.name : undefined}>
              <Icon of={def} label={label ? def?.name : undefined} />
              {amount}
            </span>{' '}
          </Fragment>
        )
      })}
    </>
  )
}
