import { scoutedEvent } from '../game/engine/citadel'
import type { RunState } from '../game/types'
import './replay.css'
import { gladeEventArt } from '../game/content/artFamilies'
import { Icon } from './Icon'

/**
 * The Scouts' Report (a Citadel upgrade): names what waits in a glade of the
 * first ring before anyone clears it. Renders nothing without the upgrade or
 * outside the first ring.
 */
export function ScoutReport({ run, gladeId }: { run: RunState; gladeId: string }) {
  const report = scoutedEvent(run, gladeId)
  if (report === undefined) return null
  return (
    <p className="scout-report">
      <Icon id="magnifier" emoji="🔍" /> <strong>Scouts' report:</strong>{' '}
      {report === null ? (
        'nothing waiting here but trees.'
      ) : (
        <>
          <Icon id={gladeEventArt(report)} emoji={report.icon} /> {report.name}: {report.description}
        </>
      )}
    </p>
  )
}
