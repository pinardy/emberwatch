import { useEffect, useMemo, useState } from 'react'
import {
  DAILY_EDICT,
  betterDaily,
  dailyExpedition,
  dailyResultFor,
  dailyShareText,
  dailyStreak,
  msUntilNextDaily,
  runMinutes,
  utcDateKey,
} from '../game/content/daily'
import { EDICTS, edictLabel } from '../game/content/meta'
import { SPECIES } from '../game/content/species'
import { useGameStore, SLOTS_FULL_NOTICE } from '../game/store'
import type { DailyResult } from '../game/types'
import { RunModifierList } from './RunModifierList'
import './replay.css'
import { Icon } from './Icon'
import { IconText } from './IconText'

/**
 * Today's UTC date key, refreshed when UTC midnight passes while the page is
 * open, so the menu never offers yesterday's expedition.
 */
export function useUtcToday(): string {
  const [today, setToday] = useState(() => utcDateKey())
  useEffect(() => {
    // +1s so the timer lands safely inside the new day.
    const id = window.setTimeout(() => setToday(utcDateKey()), msUntilNextDaily() + 1000)
    return () => window.clearTimeout(id)
  }, [today])
  return today
}

/** One line of a result: "👑 Held in Y4 · 19 min · 0 lost". */
export function describeDaily(result: DailyResult): string {
  const minutes = runMinutes(result.seconds)
  return result.won
    ? `👑 Held in Y${result.years} · ${minutes} min · ${result.villagersLost} lost`
    : `🌫️ Fell in Y${result.years} · ${result.reputation} reputation · ${result.villagersLost} lost`
}

/** Copyable share text, with a fallback for browsers without clipboard access. */
export function ShareLine({ text }: { text: string }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'select'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied('copied')
    } catch {
      // No clipboard permission (or no API): leave the text selected instead.
      setCopied('select')
    }
  }
  return (
    <div className="share-line">
      <input
        readOnly
        value={text}
        aria-label="Share text"
        onFocus={(e) => e.currentTarget.select()}
        ref={(el) => {
          if (el && copied === 'select') el.select()
        }}
      />
      <button type="button" onClick={copy}>
        {copied === 'copied' ? '✓ Copied' : '📋 Copy'}
      </button>
      <span className="sr-only" role="status">
        {copied === 'copied'
          ? 'Copied to the clipboard.'
          : copied === 'select'
            ? 'Text selected — copy it by hand.'
            : ''}
      </span>
    </div>
  )
}

/** The menu's entry: today's date, the expedition at a glance, and whether it was tried. */
export function DailyMenuEntry() {
  const goToScreen = useGameStore((s) => s.goToScreen)
  const ledger = useGameStore((s) => s.meta.daily)
  const today = useUtcToday()
  const day = useMemo(() => dailyExpedition(today), [today])
  const result = dailyResultFor(ledger, today)
  const streak = dailyStreak(ledger, today)

  return (
    <button type="button" className="daily-entry" onClick={() => goToScreen('daily')}>
      <span className="daily-entry-head">
        <strong>📅 Daily expedition</strong>
        <time dateTime={today}>{today}</time>
      </span>
      <span className="daily-entry-body">
        <span aria-label={day.species.map((id) => SPECIES[id].name).join(', ')}>
          {day.species.map((id) => (
            <Icon key={id} of={SPECIES[id]} />
          ))}
        </span>
        <span>· {edictLabel(day.edict)}</span>
        <span className={result ? (result.won ? 'is-good' : '') : 'muted'}>
          · {result ? <IconText text={describeDaily(result)} /> : 'Not attempted yet'}
        </span>
        {streak > 0 && <span className="chip">🔥 {streak}-day streak</span>}
      </span>
    </button>
  )
}

function formatCountdown(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Today's expedition in full, the best result and its share line, and past dailies. */
export function DailyScreen() {
  const ledger = useGameStore((s) => s.meta.daily)
  const startDaily = useGameStore((s) => s.startDaily)
  const goToScreen = useGameStore((s) => s.goToScreen)
  const notice = useGameStore((s) => s.notice)
  const today = useUtcToday()
  const day = useMemo(() => dailyExpedition(today), [today])
  const result = dailyResultFor(ledger, today)
  const streak = dailyStreak(ledger, today)
  const edicts = EDICTS.filter((e) => e.level <= DAILY_EDICT)
  const past = ledger.results.filter((r) => r.date !== today)

  return (
    <div className="screen daily-screen">
      <div className="menu-card wide">
        <header className="row-between">
          <h2>📅 Daily expedition</h2>
          <time className="chip big" dateTime={today}>
            {today} UTC
          </time>
        </header>
        {notice === SLOTS_FULL_NOTICE ? (
          // Refused, not banked: say so as a warning and offer the way out.
          <div className="is-bad daily-notice daily-notice-blocked" role="alert">
            <p>{notice}</p>
            <button type="button" onClick={() => goToScreen('saves')}>
              Manage saves
            </button>
          </div>
        ) : (
          notice && (
            <p className="is-good daily-notice" role="status">
              {notice}
            </p>
          )
        )}
        <p className="muted">
          One map a day, the same for everyone: the date picks the seed, the settlers and the land.
          It is played under {edictLabel(DAILY_EDICT)} with none of your Citadel upgrades, so every
          viceroy faces the same challenge. A new expedition is posted at 00:00 UTC — in{' '}
          {formatCountdown(msUntilNextDaily())}.
        </p>

        <div className="citadel-stats">
          <span className="chip">🔥 {streak}-day streak</span>
          <span className="chip">🏆 Best streak {ledger.bestStreak}</span>
          <span className="chip">📜 {ledger.results.length} days played</span>
        </div>

        <section className="setup-section">
          <h3>Today's settlers</h3>
          <div className="chip-row">
            {day.species.map((id) => (
              <span key={id} className="chip">
                <Icon of={SPECIES[id]} /> {SPECIES[id].name}
              </span>
            ))}
          </div>
          <h3 className="daily-subhead">The land</h3>
          <RunModifierList ids={day.modifiers} />
          <h3 className="daily-subhead">Terms: {edictLabel(DAILY_EDICT)}</h3>
          <ul className="daily-edicts">
            {edicts.map((e) => (
              <li key={e.level}>
                {e.icon} <strong>{e.name}</strong> — {e.description}
              </li>
            ))}
          </ul>
          <p className="muted">
            Seed <code>{day.seed}</code>
          </p>
        </section>

        <section className="setup-section" aria-label="Today's result">
          <h3>Today's best</h3>
          {result ? (
            <>
              <p className={result.won ? 'is-good' : ''}>
                <IconText text={describeDaily(result)} />
                <span className="muted">
                  {' '}
                  · {result.attempts} attempt{result.attempts === 1 ? '' : 's'}
                </span>
              </p>
              <ShareLine text={dailyShareText(result, streak)} />
            </>
          ) : (
            <p className="muted">
              Not attempted yet. Finish a run — won or lost — to post a result.
            </p>
          )}
        </section>

        {past.length > 0 && (
          <section className="setup-section">
            <h3>Past expeditions</h3>
            <div className="history-scroll">
              <table className="history-table daily-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Result</th>
                    <th>Years</th>
                    <th>Time</th>
                    <th>Lost</th>
                    <th>Reputation</th>
                    <th>Tries</th>
                  </tr>
                </thead>
                <tbody>
                  {past.map((r) => (
                    <tr key={r.date}>
                      <td>
                        <time dateTime={r.date}>{r.date}</time>
                      </td>
                      <td className={r.won ? 'is-good' : 'is-bad'}>
                        {r.won ? (
                          <>
                            <Icon id="reputation" emoji="👑" /> Held
                          </>
                        ) : (
                          '🌫️ Lost'
                        )}
                      </td>
                      <td>{r.years}</td>
                      <td>{runMinutes(r.seconds)} min</td>
                      <td>{r.villagersLost}</td>
                      <td>{r.reputation}</td>
                      <td>{r.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <footer className="modal-foot">
          <button type="button" onClick={() => goToScreen('menu')}>
            Back to menu
          </button>
          <button type="button" className="primary" onClick={() => startDaily()}>
            {result ? 'Try again' : 'Set out'} on {today}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** Whether `result` would replace `best` as the day's entry (for the end screen). */
export function isNewDailyBest(result: DailyResult, best: DailyResult | undefined): boolean {
  return !best || betterDaily(result, best)
}
