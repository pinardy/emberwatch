import type { ReactNode } from 'react'
import {
  DECREE_DECLINE_IMPATIENCE,
  ENVOY_COLD_HEARTH_SECONDS,
  HEARTH_STORM_REACH_FLOOR,
  RESOLVE_EXPECTATION_CROWD_FROM,
  SPARED_GLADE_RECLAIM_HOSTILITY,
} from '../game/engine/balance'
import { REFINED_FROM_POPULATION, REFINED_FROM_YEAR } from '../game/engine/refinedNeeds'

/**
 * The menu's "How to play": the current game in short headed sections, each
 * a few one-line points, so it can be skimmed on a phone. The numbers it
 * quotes come from `balance.ts`, so a retune does not leave it out of date.
 */
export function HowToPlay() {
  return (
    <details className="how-to" data-testid="how-to-play">
      <summary>How to play</summary>
      <div className="how-to-parts">
        <Part title="The goal">
          <li>
            Fill <strong>👑 Reputation</strong> before the Queen’s <strong>⏳ Impatience</strong> fills
            and she recalls you. By Year 5 her deadline has passed and impatience climbs fast.
          </li>
          <li>
            Full reputation sends <strong>the Queen’s envoy</strong>: she arrives as the next Storm
            ends. Impatience no longer matters, but in that Storm the forest makes its{' '}
            <strong>last stand</strong> — certain blights, a dread, a smaller warm ring.
          </li>
          <li>
            Hold until she arrives: the run is lost if a quarter of the villagers are lost, the
            hearth stands cold {ENVOY_COLD_HEARTH_SECONDS} s, or most villagers stay discontented.
            Reputation earned meanwhile is Glory.
          </li>
          <li>
            Every run opens on <strong>the Founding</strong>: blueprint drafts, a cornerstone and a
            first writ, picked in any order while the clock waits.
          </li>
        </Part>

        <Part title="The race">
          <li>
            Reputation comes from orders, decrees, glade events, reclaimed land, and species whose
            resolve sits above their threshold — in full only when buildings you raised serve
            their needs.
          </li>
          <li>
            Some lands and commissions change <strong>what the Queen values</strong> — reclaimed
            land ×2 on the Wild Frontier, contentment on the Pilgrim Road, caravan trade at Amber
            Springs. The land’s card and the Founding say so.
          </li>
          <li>
            Impatience grows with the calendar, each villager who leaves and high hostility — and
            whenever <strong>reputation stalls</strong>: a minute after your last point it climbs,
            faster the longer you wait. Your next point resets it.
          </li>
          <li>
            Near the end of her patience, once a run, the <strong>Grand Petition</strong> (Orders)
            buys some back for amber — on a vow of reputation within minutes, and a broken vow
            costs more than it bought.
          </li>
          <li>
            When a run is lost in all but name, <strong>Retreat to the Citadel</strong> (Orders)
            ends it at once and sends home what it has earned.
          </li>
          <li>
            From Year 2, <strong>the Queen’s court</strong> in the Orders panel lists all three
            levers — soothing her with amber, the petition and the retreat — and when each opens.
          </li>
          <li>
            <strong>Style achievements</strong> reward how you win — few glades, no Architect, a
            kept vow — and each opens a cornerstone, an upgrade or a commission in the Citadel.
          </li>
        </Part>

        <Part title="Needs and expectations">
          <li>
            Camps must sit near the deposit they work. Cooked food goes further and variety lifts
            resolve.
          </li>
          <li>
            Each species wants services; a service counts once it is staffed, supplied and reaches
            most of your people. You can never draft everything — choose whose needs you serve.
          </li>
          <li>
            From Year 2 settlers <strong>expect more</strong>: a served species loses resolve each
            year, and faster past {RESOLVE_EXPECTATION_CROWD_FROM} villagers. Keep adding. A
            species below zero starts to leave.
          </li>
          <li>
            From Year {REFINED_FROM_YEAR} (or {REFINED_FROM_POPULATION} villagers) each species also
            hopes for a <strong>refined</strong> form of one need: spiced ale, scented baths, blueprint
            folios. Meeting it adds resolve and eases those expectations; missing it costs
            nothing.
          </li>
        </Part>

        <Part title="Glades and the forest">
          <li>
            Idle villagers clear fogged glades beside your land for loot and ground. Some hide a
            decision — the chips under a plate say what is at stake.
          </li>
          <li>
            Every glade reclaimed makes <strong>hostility</strong> grow faster for good, and
            hostility drags everyone’s resolve down. A border glade{' '}
            <strong>left to the forest</strong> (from the Inspector) calms it while it stands;
            breaking that truce costs {SPARED_GLADE_RECLAIM_HOSTILITY}.
          </li>
        </Part>

        <Part title="The lie of the land">
          <li>
            Every map has a <strong>layout</strong>, named at setup: rings round the hearth, a{' '}
            <strong>river vale</strong> crossed only at fords, a <strong>long ridge</strong> with
            passes along its spine, or old <strong>ruins</strong> to salvage stone and bricks from.
          </li>
          <li>
            Some maps hold <strong>the Cinderwood</strong>: homes on its ash stay warm in every
            Storm, but farms barely grow and work slows in the Storm rain. Deadfall gives quick
            wood, fireweed herbs and fibre.
          </li>
        </Part>

        <Part title="The Storm">
          <li>
            Each year ends in the Storm: farms stop, gathering halves and the hearth burns wood.
            Stock food and wood in the Clearance.
          </li>
          <li>
            The hearth’s warm ring shrinks to {Math.round(HEARTH_STORM_REACH_FLOOR * 100)}% through
            the Storm. Homes beyond every fire go <strong>cold</strong>, and the cold kills — a
            brazier or an insulated shelter keeps them warm.
          </li>
          <li>
            From Year 2 the forest forecasts a <strong>blight</strong> each Clearance. Make the
            goods it names before the Storm breaks and it is turned aside.
          </li>
          <li>
            <strong>The Long Night</strong> pulls the warm ring in to half for a Storm: stack the
            wood to turn it aside, or light braziers among the outer homes.
          </li>
        </Part>

        <Part title="Orders, decrees and commissions">
          <li>
            Three standing <strong>orders</strong> pay reputation. When one is met, choose its
            replacement in the Orders panel — the clock keeps running.
          </li>
          <li>
            The herald brings two timed <strong>decrees</strong>: meet one for a reward and a
            streak, miss it and her patience frays — or beg off both for +
            {DECREE_DECLINE_IMPATIENCE} impatience.
          </li>
          <li>
            While reputation stands still, small <strong>errands</strong> turn up (a chip on the
            map, a card in Orders): carry goods, staff a workplace, sell to the caravan. Each pays
            a little reputation or amber; ignore one and it lapses, no harm done.
          </li>
          <li>
            A <strong>commission</strong>, chosen before the run, adds an objective judged at the
            end. Its card sits in the Orders panel.
          </li>
        </Part>

        <Part title="Trade and amber">
          <li>
            Raise a Trading Post and caravans call: sell for <strong>amber</strong>, buy what you
            lack, and get double for the one good each visit wants.
          </li>
          <li>
            Amber buys rare blueprints and cornerstones, shipments to order, one trade agreement a
            run, rerolls, rushed building and a calmer Queen. Spend it.
          </li>
          <li>
            No caravans? Select the hearth: <strong>the Queen's Architect</strong> sells plans for a
            service your settlers want, dearer with each set. A milestone draft can also be redrawn
            toward a named service.
          </li>
        </Part>
      </div>
      <p className="muted how-to-keys">
        <strong>Keys:</strong> Space pauses · 1–5 set speed · B build · P people · O orders · T
        trade · L log · WASD/arrows pan · Q/E rotate · H homes · right-click or Esc cancels
        placement and closes tips. On touch screens, drag to pan, pinch to zoom and tap ✓ to
        place. Progress saves automatically and the game works offline once loaded.
      </p>
    </details>
  )
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="how-to-part" aria-label={title}>
      <h2>{title}</h2>
      <ul>{children}</ul>
    </section>
  )
}
