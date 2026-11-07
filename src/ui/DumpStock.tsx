import { useState } from 'react'
import { RESOURCES } from '../game/content/resources'
import { DUMP_LOT } from '../game/engine/actions'
import { sortBag, storageUsed } from '../game/engine/queries'
import { useGameStore } from '../game/store'
import type { ResourceId, RunState } from '../game/types'
import { Icon } from './Icon'
import { againWord, useConfirm } from './useConfirm'

/**
 * On the hearth and warehouses: throw a chosen good out of the stockpile, a
 * lot at a time. The way out when the store is full of something nobody needs
 * and the producers of what you do need have stopped at the brim.
 */
export function DumpStock({ run }: { run: RunState }) {
  const dump = useGameStore((s) => s.dump)
  const goods = sortBag(run.stock).filter(([id, amount]) => id !== 'amber' && amount >= 1)
  const largest = [...goods].sort((a, b) => b[1] - a[1])[0]?.[0]
  const [picked, setPicked] = useState<ResourceId | ''>('')
  const choice = picked && (run.stock[picked] ?? 0) >= 1 ? picked : (largest ?? '')
  // Goods thrown out are gone: the first press arms, the second dumps.
  const confirm = useConfirm(`dump-${choice}`, () => {
    if (choice) dump(choice)
  })
  if (goods.length === 0) return null
  const used = Math.floor(storageUsed(run))
  return (
    <section className="inspector-section" data-testid="dump-stock">
      <h3>
        Stockpile {used}/{run.storageCap}
      </h3>
      <div className="btn-row">
        <label className="sr-only" htmlFor="dump-good">
          Good to dump
        </label>
        <select
          id="dump-good"
          value={choice}
          onChange={(e) => setPicked(e.target.value as ResourceId)}
        >
          {goods.map(([id, amount]) => (
            <option key={id} value={id}>
              {RESOURCES[id]?.name ?? id} ({Math.floor(amount)})
            </option>
          ))}
        </select>
        <button
          type="button"
          className={confirm.armed ? 'danger is-armed' : ''}
          disabled={!choice}
          onClick={confirm.trigger}
          title={`Throw out up to ${DUMP_LOT} to make room`}
        >
          <Icon id="noEntry" emoji="🗑" />{' '}
          {confirm.armed && choice
            ? `Dump ${DUMP_LOT} ${RESOURCES[choice]?.name ?? choice}? ${againWord()}`
            : `Dump ${DUMP_LOT}`}
        </button>
      </div>
    </section>
  )
}
