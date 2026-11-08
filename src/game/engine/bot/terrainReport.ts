import type { BotReport } from './play'

/*
 * The harness's view of the map's layouts and biomes: win rates per layout and
 * per biome over any set of runs. Kept apart from `harness.ts` so the terrain
 * sweep and the main sweep's breakdown share it without touching that file's
 * report lines.
 */

/** `river 7/9 (78%)`-style counts per value of `key`, most common first. */
export function winsBy(reports: BotReport[], key: (r: BotReport) => string): string {
  const groups = new Map<string, BotReport[]>()
  for (const r of reports) groups.set(key(r), [...(groups.get(key(r)) ?? []), r])
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k, rs]) => {
      const won = rs.filter((r) => r.phase === 'won').length
      return `${k} ${won}/${rs.length} (${Math.round((won / rs.length) * 100)}%)`
    })
    .join(' · ')
}

/** One line: wins by layout, then by biome. */
export function summariseTerrain(label: string, reports: BotReport[]): string {
  return (
    `${label.padEnd(20)} by layout: ${winsBy(reports, (r) => r.layout)}` +
    `\n${''.padEnd(20)} by biome: ${winsBy(reports, (r) => r.biome)}`
  )
}
