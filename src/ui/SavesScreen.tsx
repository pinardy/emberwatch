import { useMemo, useRef, useState } from 'react'
import {
  downloadSaveFile,
  parseSaveFile,
  readSaveFile,
  saveFileText,
  type ImportResult,
} from '../game/saveFile'
import { listSlots, loadSlot, slotMeta, type SlotId, type SlotSummary } from '../game/saveSlots'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { SlotDetails, SlotPicker } from './SaveSlots'
import { useConfirm } from './useConfirm'

/** The run a slot holds: the live one for the slot being played. */
function slotRun(id: SlotId): RunState | null {
  const { run, activeSlot } = useGameStore.getState()
  if (run && id === activeSlot) return run
  return loadSlot(id)
}

function SlotCard({
  slot,
  onCopyText,
}: {
  slot: SlotSummary
  onCopyText: (label: string, text: string) => void
}) {
  const run = useGameStore((s) => s.run)
  const activeSlot = useGameStore((s) => s.activeSlot)
  const resumeSaved = useGameStore((s) => s.resumeSaved)
  const deleteSave = useGameStore((s) => s.deleteSave)
  const saveCopy = useGameStore((s) => s.saveCopy)
  const playing = !!run && activeSlot === slot.id
  const del = useConfirm(`delete-${slot.id}`, () => deleteSave(slot.id))
  const copy = useConfirm(`copy-${slot.id}`, () => saveCopy(slot.id))
  const [error, setError] = useState<string | null>(null)

  const withRun = (fn: (run: RunState) => void) => {
    const found = slotRun(slot.id)
    if (!found) {
      setError('This slot could not be read.')
      return
    }
    setError(null)
    fn(found)
  }

  const canSaveHere = !!run && !playing

  return (
    <li className={`slot-card ${slot.meta ? '' : 'is-empty'} ${playing ? 'is-playing' : ''}`}>
      <header className="slot-head">
        <h3>{slot.label}</h3>
        {playing && <span className="slot-badge">Playing now</span>}
      </header>
      {slot.meta ? (
        // The live run is newer than its last autosave, so show that.
        <SlotDetails meta={playing && run ? slotMeta(run, Date.now()) : slot.meta} />
      ) : (
        <p className="muted slot-empty">Empty slot</p>
      )}
      {error && (
        <p className="slot-error" role="alert">
          {error}
        </p>
      )}
      <div className="slot-actions">
        {slot.meta && (
          <button type="button" className="primary" onClick={() => resumeSaved(slot.id)}>
            {playing ? '▶ Resume' : '▶ Load'}
            <span className="sr-only"> {slot.label}</span>
          </button>
        )}
        {slot.meta && (
          <button type="button" onClick={() => withRun((r) => downloadSaveFile(r))}>
            ⬇ Export<span className="sr-only"> {slot.label}</span>
          </button>
        )}
        {slot.meta && (
          <button
            type="button"
            onClick={() => withRun((r) => onCopyText(slot.label, saveFileText(r)))}
          >
            📋 Copy text<span className="sr-only"> of {slot.label}</span>
          </button>
        )}
        {canSaveHere && (
          <button
            type="button"
            className={slot.meta && copy.armed ? 'is-armed' : ''}
            onClick={slot.meta ? copy.trigger : () => saveCopy(slot.id)}
          >
            {slot.meta && copy.armed
              ? `Replace ${slot.label}? Tap again`
              : `💾 Save current run here`}
            <span className="sr-only"> ({slot.label})</span>
          </button>
        )}
        {slot.meta && (
          <button
            type="button"
            className={`danger ${del.armed ? 'is-armed' : ''}`}
            onClick={del.trigger}
          >
            {del.armed
              ? playing
                ? 'Delete the run you are playing? Tap again'
                : 'Delete for good? Tap again'
              : '🗑 Delete'}
            <span className="sr-only"> {slot.label}</span>
          </button>
        )}
      </div>
    </li>
  )
}

/** Import a save from a file or pasted text into a slot of the player's choosing. */
function ImportPanel({ slots }: { slots: SlotSummary[] }) {
  const importRun = useGameStore((s) => s.importRun)
  const activeSlot = useGameStore((s) => s.activeSlot)
  const fileInput = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [target, setTarget] = useState<SlotId | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const accept = (next: ImportResult) => {
    setResult(next)
    setDone(null)
    setTarget(slots.find((s) => !s.meta)?.id ?? null)
  }

  const targetSlot = slots.find((s) => s.id === target)
  const replacing = !!targetSlot?.meta
  const commit = () => {
    if (!result?.ok || !target) return
    const error = importRun(result.run, target)
    if (error) {
      setDone(null)
      setResult({ ok: false, error })
      return
    }
    setDone(`Imported into ${targetSlot?.label}.`)
    setResult(null)
    setPasteText('')
    setPasteOpen(false)
  }
  const confirm = useConfirm(`import-${target}`, commit)

  return (
    <section className="setup-section import-panel" aria-label="Import a save">
      <h3>Import a save</h3>
      <p className="muted">
        Load a run exported from this or another device. Files are checked before anything
        is written.
      </p>
      <div className="slot-actions">
        <button type="button" onClick={() => fileInput.current?.click()}>
          📂 Choose a file…
        </button>
        <button
          type="button"
          aria-expanded={pasteOpen}
          onClick={() => setPasteOpen((open) => !open)}
        >
          📋 Paste save text
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json,text/plain"
          className="sr-only"
          tabIndex={-1}
          aria-label="Save file to import"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) accept(await readSaveFile(file))
          }}
        />
      </div>
      {pasteOpen && (
        <div className="paste-box">
          <textarea
            aria-label="Save text to import"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder='{"format":"emberwatch-run", …}'
            rows={4}
            spellCheck={false}
          />
          <button type="button" onClick={() => accept(parseSaveFile(pasteText))}>
            Check this save
          </button>
        </div>
      )}
      {done && (
        <p className="slot-ok" role="status">
          {done}
        </p>
      )}
      {result && !result.ok && (
        <p className="slot-error" role="alert">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <div className="import-preview">
          <SlotDetails meta={slotMeta(result.run, 0)} compact />
          <SlotPicker
            slots={slots}
            value={target}
            onChange={setTarget}
            name="import-slot"
            label="Import into"
            activeSlot={activeSlot}
          />
          <button
            type="button"
            className={replacing && confirm.armed ? 'primary is-armed' : 'primary'}
            disabled={!target}
            onClick={replacing ? confirm.trigger : commit}
          >
            {!target
              ? 'Choose a slot'
              : replacing && confirm.armed
                ? `Replace ${targetSlot?.label}? Tap again`
                : replacing
                  ? `Import, replacing ${targetSlot?.label}`
                  : `Import into ${targetSlot?.label}`}
          </button>
        </div>
      )}
    </section>
  )
}

/** The load screen: every slot with its metadata, plus import and export. */
export function SavesScreen() {
  const goToScreen = useGameStore((s) => s.goToScreen)
  const version = useGameStore((s) => s.version)
  const notice = useGameStore((s) => s.notice)
  const slots = useMemo(
    () => listSlots(),
    // Slots change with every save, delete and import, all of which bump it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, notice],
  )
  const [textOut, setTextOut] = useState<{ label: string; text: string; copied: boolean } | null>(
    null,
  )

  const copyText = (label: string, text: string) => {
    setTextOut({ label, text, copied: false })
    navigator.clipboard
      ?.writeText(text)
      .then(() => setTextOut({ label, text, copied: true }))
      .catch(() => {
        /* the text box below is the fallback */
      })
  }

  return (
    <div className="screen saves-screen">
      <div className="menu-card wide">
        <h2>Saved settlements</h2>
        <p className="muted">
          Every settlement saves itself to its slot as you play. Export a run to keep it
          safe or move it to another device.
        </p>
        {notice && (
          <p className="slot-ok" role="status">
            {notice}
          </p>
        )}
        <ul className="slot-list" aria-label="Save slots">
          {slots.map((slot) => (
            <SlotCard key={slot.id} slot={slot} onCopyText={copyText} />
          ))}
        </ul>

        {textOut && (
          <section className="setup-section text-out" aria-label="Save as text">
            <h3>{textOut.label} as text</h3>
            <p className="muted" role="status">
              {textOut.copied
                ? 'Copied to the clipboard. Paste it into “Paste save text” on the other device.'
                : 'Select all of the text below and copy it, then paste it on the other device.'}
            </p>
            <textarea
              readOnly
              aria-label="Save text"
              value={textOut.text}
              rows={4}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" onClick={() => setTextOut(null)}>
              Done
            </button>
          </section>
        )}

        <ImportPanel slots={slots} />

        <footer className="modal-foot setup-foot">
          <button type="button" onClick={() => goToScreen('menu')}>
            Back
          </button>
        </footer>
      </div>
    </div>
  )
}
