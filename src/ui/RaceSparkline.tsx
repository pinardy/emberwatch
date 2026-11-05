import { COL, raceAt } from '../game/engine/timeline'
import type { RunState } from '../game/types'

/*
 * The live race sparkline in the Orders panel. It lives apart from the
 * end-of-run chart (./RunTimeline) so the game screen can show it without
 * loading the chart, which is only fetched once a run ends.
 */

export function linePath(points: [number, number][]): string {
  return points.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join('')
}

const SPARK_W = 84
const SPARK_H = 20

/** A tiny live view of the race, for the Orders panel header. */
export function RaceSparkline({ run }: { run: RunState }) {
  const tl = run.timeline
  const samples = tl?.samples ?? []
  if (!tl || samples.length < 2) return null
  const t0 = samples[0][COL.clock]
  const t1 = samples[samples.length - 1][COL.clock]
  if (t1 - t0 < 1) return null
  const fallback: [number, number] = [run.maxReputation, run.maxImpatience]
  const x = (t: number) => 1 + ((t - t0) / (t1 - t0)) * (SPARK_W - 2)
  const y = (p: number) => 2 + (1 - p) * (SPARK_H - 4)
  const race = samples.map((smp) => raceAt(tl, smp, fallback))
  const rep = linePath(samples.map((smp, i) => [x(smp[COL.clock]), y(race[i].reputation)]))
  const imp = linePath(samples.map((smp, i) => [x(smp[COL.clock]), y(race[i].impatience)]))
  const last = race[race.length - 1]
  const label = `The race so far: reputation ${Math.round(last.reputation * 100)}% of its goal, impatience ${Math.round(last.impatience * 100)}%.`
  return (
    <svg
      className="race-spark"
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <path className="tl-line is-impatience" d={imp} />
      <path className="tl-line is-reputation" d={rep} />
    </svg>
  )
}
