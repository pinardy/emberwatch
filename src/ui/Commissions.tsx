import {
  COMMISSIONS,
  COMMISSION_LIST,
  commissionOffer,
  describeTerm,
  boardFor,
  judgeCommission,
  type CommissionDef,
  type TermStatus,
} from '../game/content/commissions'
import { ACHIEVEMENT_UNLOCKS, META_UPGRADES } from '../game/content/meta'
import { ACHIEVEMENTS } from '../game/content/achievements'
import { type RewardBreakdown } from '../game/engine/meta'
import { metaUpgradeArt } from '../game/content/artFamilies'
import type { MetaState, RunState } from '../game/types'
import { useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { ReputationProfileLine } from './EnvoyStatus'

/**
 * Citadel commissions in the UI: the pick on the setup screen, the card in
 * the Orders panel, the verdict on the end screen and the board in the
 * Citadel. The rules live in `content/commissions.ts`; these only read them.
 */

const MARK: Record<TermStatus['state'], string> = { met: '✓', open: '•', failed: '✗' }
const MARK_LABEL: Record<TermStatus['state'], string> = {
  met: 'met',
  open: 'in progress',
  failed: 'failed',
}

function CommissionTitle({ def }: { def: CommissionDef }) {
  return (
    <strong className="commission-name">
      <Icon id={def.art} emoji={def.icon} /> {def.name}
    </strong>
  )
}

/** The objective as plain terms (before a run, nothing is judged yet). */
function Objective({ def }: { def: CommissionDef }) {
  return (
    <ul className="commission-terms">
      <li>Hold the settlement</li>
      {def.terms.map((t, i) => (
        <li key={i}>{describeTerm(t)}</li>
      ))}
    </ul>
  )
}

/** Each term with where it stands: in the run, and judged on the end screen. */
function TermList({ terms }: { terms: TermStatus[] }) {
  return (
    <ul className="commission-terms is-judged">
      {terms.map((t) => (
        <li key={t.label} className={`term-${t.state}`}>
          <span className="term-mark" aria-label={MARK_LABEL[t.state]} role="img">
            {MARK[t.state]}
          </span>{' '}
          {t.label} <em>{t.detail}</em>
        </li>
      ))}
    </ul>
  )
}

/** The picker's key for "no commission" (its detail toggle and region). */
const NONE_KEY = 'none'

/**
 * One option of the setup screen's pick. On wide screens the slot vanishes
 * (`display: contents`) and the card shows everything, as it always has. On
 * phones (setup.css) the card is a one-line row (icon, name, the reward, and
 * "Chosen" when it is) and its full terms open from the toggle beside it,
 * like the species tiles. A tap on the row still picks it.
 */
function PickerSlot({
  slotKey,
  name,
  picked,
  open,
  onPick,
  onToggle,
  card,
  reward,
  detail,
}: {
  slotKey: string
  name: string
  picked: boolean
  open: boolean
  onPick: () => void
  onToggle: () => void
  /** The card's title and body (the phone row hides all but the title). */
  card: ReactNode
  reward: ReactNode
  /** The full terms, for the phone's detail region. */
  detail: ReactNode
}) {
  const detailId = `commission-detail-${slotKey}`
  return (
    <div className={`commission-slot ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        role="radio"
        aria-checked={picked}
        className={`commission-card ${picked ? 'is-picked' : ''}`}
        onClick={onPick}
      >
        {card}
        {/* The spaces keep the parts apart in the row's name ("The Royal
            Survey ✓ Chosen +65% supplies"); a grid draws no blank text. */}{' '}
        {picked && <em className="commission-chosen">✓ Chosen</em>}{' '}
        <em className="commission-reward">{reward}</em>
      </button>
      <button
        type="button"
        className="commission-more"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <span aria-hidden>▾</span>
        <span className="sr-only">
          Terms of {name}
          {picked ? ' (chosen)' : ''}
        </span>
      </button>
      <div
        id={detailId}
        className="commission-detail"
        role="group"
        aria-label={`Terms of ${name}`}
        hidden={!open}
      >
        {detail}
      </div>
    </div>
  )
}

/**
 * The setup screen's pick: no commission, or one of the few on the Citadel's
 * board this time. Taking none founds the standard settlement. On phones only
 * one option's terms are open at a time.
 */
export function CommissionPicker({
  meta,
  value,
  onPick,
}: {
  meta: MetaState
  value: string | null
  onPick: (id: string | null) => void
}) {
  const offer = commissionOffer(meta)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const toggle = (key: string) => setOpenKey((open) => (open === key ? null : key))
  return (
    <div className="commission-grid" role="radiogroup" aria-label="Commission">
      <PickerSlot
        slotKey={NONE_KEY}
        name="No commission"
        picked={value === null}
        open={openKey === NONE_KEY}
        onPick={() => onPick(null)}
        onToggle={() => toggle(NONE_KEY)}
        card={
          <>
            <strong className="commission-name">
              <Icon id="dove" emoji="🕊️" /> No commission
            </strong>
            <small>The standard settlement: no twist, no extra objective.</small>
          </>
        }
        reward="Base supplies"
        detail={<p>The standard settlement: no twist, no extra objective.</p>}
      />
      {offer.map((id) => {
        const def = COMMISSIONS[id]
        if (!def) return null
        return (
          <PickerSlot
            key={id}
            slotKey={id}
            name={def.name}
            picked={value === id}
            open={openKey === id}
            onPick={() => onPick(id)}
            onToggle={() => toggle(id)}
            card={
              <>
                <CommissionTitle def={def} />
                <small className="commission-patron">{def.patron}</small>
                <small>{def.twist}</small>
                <ReputationProfileLine profile={def.reputation} />
                <Objective def={def} />
              </>
            }
            reward={
              <>
                +{def.bonusPercent}% supplies{' '}
                <span className="commission-reward-tail">if met</span>
              </>
            }
            detail={
              <>
                <p className="commission-patron">{def.patron}</p>
                <p>{def.twist}</p>
                <ReputationProfileLine profile={def.reputation} />
                <Objective def={def} />
                <p className="commission-detail-reward">+{def.bonusPercent}% supplies if met</p>
              </>
            }
          />
        )
      })}
    </div>
  )
}

/** The run's commission in the Orders panel, with each term's progress. */
export function CommissionCard({ run }: { run: RunState }) {
  const verdict = judgeCommission(run)
  if (!verdict) return null
  const { def } = verdict
  return (
    <div className="order-card commission-run" aria-label={`Commission: ${def.name}`} role="group">
      <div className="row-between">
        <CommissionTitle def={def} />
        <span className="order-reward">+{def.bonusPercent}% supplies</span>
      </div>
      <small>{def.twist}</small>
      <ReputationProfileLine profile={def.reputation} />
      <TermList terms={verdict.terms} />
    </div>
  )
}

/** The end screen's verdict: met or not, and what it paid. */
export function CommissionEnd({ run, breakdown }: { run: RunState; breakdown: RewardBreakdown }) {
  const verdict = judgeCommission(run)
  if (!verdict) return null
  const { def, met } = verdict
  return (
    <section className={`end-commission ${met ? 'is-met' : 'is-unmet'}`} aria-label="Commission">
      <h3>Commission</h3>
      <div className="row-between">
        <CommissionTitle def={def} />
        <span className={met ? 'is-good' : 'muted'}>
          {met
            ? `Met: +${breakdown.commission?.bonus ?? 0} supplies`
            : 'Not met: no bonus'}
        </span>
      </div>
      <TermList terms={verdict.terms} />
    </section>
  )
}

/**
 * The Citadel's commission board: what the next settlement may take, and
 * which upgrade opens each commission still closed.
 */
export function CommissionBoard({ meta }: { meta: MetaState }) {
  const offer = commissionOffer(meta)
  const open = new Set(boardFor(meta).map((d) => d.id))
  return (
    <div className="commission-grid is-board">
      {COMMISSION_LIST.map((def) => {
        const upgrade = def.unlockedBy ? META_UPGRADES[def.unlockedBy] : undefined
        const feat = Object.entries(ACHIEVEMENT_UNLOCKS).find(([, u]) => u.commission === def.id)
        const early = feat ? ACHIEVEMENTS[feat[0]] : undefined
        const status = offer.includes(def.id) ? 'offered' : open.has(def.id) ? 'open' : 'locked'
        return (
          <div key={def.id} className={`commission-card is-${status}`}>
            <CommissionTitle def={def} />
            <small className="commission-patron">{def.patron}</small>
            <small>{def.twist}</small>
            <ReputationProfileLine profile={def.reputation} />
            <Objective def={def} />
            <em>
              {status === 'locked' && upgrade ? (
                <>
                  <Icon id="lock" emoji="🔒" /> Opened by{' '}
                  <Icon id={metaUpgradeArt(upgrade)} emoji={upgrade.icon} /> {upgrade.name}
                  {early && ` — or early, by earning ${early.icon} ${early.name}`}
                </>
              ) : status === 'offered' ? (
                `On offer next run · +${def.bonusPercent}% supplies`
              ) : (
                `On the board · +${def.bonusPercent}% supplies`
              )}
            </em>
          </div>
        )
      })}
    </div>
  )
}

