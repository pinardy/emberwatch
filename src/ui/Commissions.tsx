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

/**
 * The setup screen's pick: no commission, or one of the few on the Citadel's
 * board this time. Taking none founds the standard settlement.
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
  return (
    <div className="commission-grid" role="radiogroup" aria-label="Commission">
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        className={`commission-card ${value === null ? 'is-picked' : ''}`}
        onClick={() => onPick(null)}
      >
        <strong className="commission-name">
          <Icon id="dove" emoji="🕊️" /> No commission
        </strong>
        <small>The standard settlement: no twist, no extra objective.</small>
        <em>Base supplies</em>
      </button>
      {offer.map((id) => {
        const def = COMMISSIONS[id]
        if (!def) return null
        const picked = value === id
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={picked}
            className={`commission-card ${picked ? 'is-picked' : ''}`}
            onClick={() => onPick(id)}
          >
            <CommissionTitle def={def} />
            <small className="commission-patron">{def.patron}</small>
            <small>{def.twist}</small>
            <ReputationProfileLine profile={def.reputation} />
            <Objective def={def} />
            <em>+{def.bonusPercent}% supplies if met</em>
          </button>
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

