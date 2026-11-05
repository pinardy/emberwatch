import { useMemo } from 'react'
import { dailyResultFor, dailyShareText } from '../game/content/daily'
import { settleRun } from '../game/progression'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { ShareLine, describeDaily, isNewDailyBest } from './DailyScreen'
import './replay.css'
import { IconText } from './IconText'
import { achievementArt } from '../game/content/art'
import { Icon } from './Icon'

/**
 * The end screen's extras: achievements this run earns and, for a daily
 * expedition, the result with its share line. It previews the very settlement
 * `finishRun` will bank, so nothing promised here can differ.
 */
export function EndExtras({ run }: { run: RunState }) {
  const meta = useGameStore((s) => s.meta)
  const settled = useMemo(() => settleRun(meta, run), [meta, run])
  const best = run.daily ? dailyResultFor(meta.daily, run.daily) : undefined

  return (
    <>
      {settled.achievements.length > 0 && (
        <section className="end-achievements" aria-label="Achievements earned">
          <h3>Achievements earned</h3>
          <ul>
            {settled.achievements.map((a) => (
              <li key={a.id}>
                <span aria-hidden>
                  <Icon id={achievementArt(a)} emoji={a.icon} />
                </span>{' '}
                <strong>{a.name}</strong>{' '}
                <small className="muted">{a.description}</small>
                {a.reward?.supplies ? <em className="is-good"> +{a.reward.supplies} 📦</em> : null}
                {a.reward?.title ? <em className="is-good"> Title: “{a.reward.title}”</em> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
      {settled.daily && (
        <section className="end-daily" aria-label="Daily expedition">
          <h3>📅 Daily expedition {settled.daily.date}</h3>
          <p className={settled.daily.won ? 'is-good' : ''}>
            <IconText text={describeDaily(settled.daily)} />
            {isNewDailyBest(settled.daily, best)
              ? best
                ? ' — a new best for the day.'
                : ''
              : ` — your best today stands: ${describeDaily(best!)}.`}
          </p>
          <ShareLine text={dailyShareText(settled.daily, settled.streak)} />
        </section>
      )}
    </>
  )
}
