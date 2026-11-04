import { useEffect, useState } from 'react'
import { idleVillagers } from '../game/engine/queries'
import { useRun } from '../game/store'
import type { RunState } from '../game/types'

/**
 * Contextual first-time tips. Each fires once, when its condition first holds,
 * and stays until dismissed. Seen ids persist in localStorage so veterans are
 * never nagged twice.
 */
interface Tip {
  id: string
  title: string
  text: string
  when: (run: RunState) => boolean
}

const TIPS: Tip[] = [
  {
    id: 'welcome',
    title: 'Welcome, Viceroy',
    text: 'Fill the crown meter to win before the hourglass fills and the Queen recalls you. Resolve above each species’ threshold is what earns reputation.',
    when: (run) => run.clock < 30,
  },
  {
    id: 'first-draft',
    title: 'Drafting a blueprint',
    text: 'You can never unlock everything — pick buildings that satisfy the services your species actually want. The draft can be rerolled for amber.',
    when: (run) => run.pendingChoices[0]?.kind === 'blueprint',
  },
  {
    id: 'idle-builders',
    title: 'Idle hands build',
    text: 'Idle villagers are your construction crew and your glade clearers. The 💤 count in the top bar is your build speed.',
    when: (run) => run.clock > 45 && idleVillagers(run).length >= 3,
  },
  {
    id: 'first-glade',
    title: 'Push into the forest',
    text: 'Select a fogged glade next to your territory and assign clearers. Dangerous and forbidden glades hide richer loot — and a decision.',
    when: (run) => run.clock > 90 && run.stats.gladesCleared === 0,
  },
  {
    id: 'first-storm',
    title: 'The Blightstorm',
    text: 'Farms stop, gathering halves, and the hearth burns wood fast. Stockpile food and fuel during Clearance, and keep homes near the hearth’s warmth — or raise a brazier beside distant ones.',
    when: (run) => run.season.season === 'storm' && run.season.year === 1,
  },
  {
    id: 'low-resolve',
    title: 'Somebody is miserable',
    text: 'A species below zero resolve will start leaving, and each departure feeds the Queen’s impatience. Check housing, food variety, and their service needs.',
    when: (run) => Object.values(run.resolve).some((r) => r < 0),
  },
  {
    id: 'first-threat',
    title: 'A threat is loose',
    text: 'It will strike again and again until you pay it off from the red banner. Weigh the appeasement cost against what each strike is costing you.',
    when: (run) => run.threats.length > 0,
  },
  {
    id: 'first-caravan',
    title: 'A caravan is in town',
    text: 'It leaves soon. Check the Trade tab — it pays double for one good this visit, and its stock rotates every caravan.',
    when: (run) => run.caravan.here,
  },
]

const TIPS_KEY = 'emberwatch.tips.v1'

function loadSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(TIPS_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function saveSeen(seen: string[]): void {
  try {
    localStorage.setItem(TIPS_KEY, JSON.stringify(seen))
  } catch {
    /* private mode — tips just repeat */
  }
}

export function TipsCoach() {
  const run = useRun()
  const [seen, setSeen] = useState<string[]>(loadSeen)
  const [active, setActive] = useState<Tip | null>(null)

  useEffect(() => {
    if (!run || active) return
    const next = TIPS.find((tip) => !seen.includes(tip.id) && tip.when(run))
    if (next) setActive(next)
  }, [run, seen, active])

  if (!run || !active) return null

  const dismiss = () => {
    const next = [...seen, active.id]
    setSeen(next)
    saveSeen(next)
    setActive(null)
  }

  return (
    <div className="tip-coach" role="note">
      <div className="tip-body">
        <strong>💡 {active.title}</strong>
        <p>{active.text}</p>
      </div>
      <button type="button" onClick={dismiss}>
        Got it
      </button>
    </div>
  )
}
