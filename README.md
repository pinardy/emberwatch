# Emberwatch

A roguelite city builder in the style of [Against the Storm](https://store.steampowered.com/app/1336490/Against_the_Storm/), built as an offline-capable Progressive Web App with React + TypeScript.

You are a viceroy sent into a rain-soaked forest. Raise a settlement, keep three species of villager from walking out on you, and earn the Queen's favour before her patience runs out. Every run is a new map, a new draft of buildings, and a new set of perks.

```bash
npm install
npm run dev        # play at the printed localhost URL
npm test           # 767 tests: simulation, roads, sound, forecasts, Citadel, balance harness, UI
npm run build      # typecheck + production build + service worker
npm run preview    # serve the built PWA (installable, works offline)
npm run test:e2e   # real-browser smoke test (Playwright + Chromium)
```

## The loop

| System | What it does |
| --- | --- |
| **Seasons** | Drizzle → Clearance → Storm, ~7 minutes a year. Farms fail in the Storm, gathering halves, and the hearth burns wood. |
| **Glades** | The world is a continuous forest partitioned into fogged glades. Assign villagers to clear those bordering your territory for resources; dangerous and forbidden glades force a decision when opened. Each plate says what its waiting event could lead to (lives, a threat, a lingering task, reputation, a pact) without naming it, as chips of their own colour under the plate (labelled on the 2D map, explained on hover and in the Inspector), so clearing order is a choice. On the 3D map a glade list stands in for the canvas plates for the keyboard: Tab to it, arrow keys to move, Enter to pick. Clearing is a choice too: every glade reclaimed makes hostility grow 4% faster for the rest of the run, while a border glade **left to the forest** (from the Inspector) stays wild and calms hostility for as long as it stands — breaking that truce later costs 5 hostility. |
| **Threats** | The greedy option in a glade event can unleash a timed menace that strikes on a repeating countdown — stealing stock, raising hostility, fraying the Queen's patience — until you pay it off. Each strike makes the next a quarter worse and the price of peace a fifth higher, and from the third on it takes a villager too. The event card spells out the strike, its interval and the price before you choose. Other options grant run-long pacts instead. |
| **Lingering conditions** | Some glade choices leave an aftermath tied to the build loop — flooded paths slow construction until you lay planks, a spirit wants incense before its deadline, a blight saps resolve until a new service hall stands. The bar above the threats tracks each one's progress. |
| **Resolve** | Each species has a resolve score driven by housing, food variety, satisfied service needs, hostility and **rising expectations** — from Year 2 a served species takes 3 resolve a year (and a quarter per villager past 15) for granted, in proportion to the share of its needs met, so resolve does not plateau far above the threshold (hunger ramps in over about a meal). The People panel's *Why?* breakdown lists every term. Above its threshold, a species earns **reputation**; at −5 or below it despairs, and after 70 s one villager leaves, then the rest hold on 30 s longer before the next follows — the warning strip counts it down. Every species also bends one rule — lizards shrug off a cold hearth and spar among themselves (Brawling counts three-quarters met without an Arena), idle beavers build faster, harpies clear glades from the air and teach one another (Education counts three-quarters met without a Guild House) — and most villagers arrive with a personal quirk. |
| **Warmth** | Housing within the hearth's warmth radius is safe; homes beyond it chill their residents during the Storm unless a **brazier** stands near them — a small fire bowl (a starting blueprint) that warms homes in its own radius but burns wood every Storm second, and goes cold when the woodpile runs dry. Through the Storm the hearth's reach pulls in, step by step, to 70% by its end; villagers take the warm beds first, but once those are full the ones sleeping cold build up exposure and the cold takes a life (lizards excepted). The warning strip names the homes at risk from Clearance on, and both maps draw the shrinking ring. |
| **Upgrades** | Twenty buildings can be raised one or two tiers — a shelter into a reinforced shelter (insulated against the Storm) and then a snug lodge (comfort), a tavern into a taproom and an alehouse, a mill into a joinery. First tiers cost mostly planks and bricks, second tiers parts, tools or copper bars, so the deeper chains pay off late. An upgrade is a construction job for idle builders (rushable with amber); the building keeps working at its old tier until it lands. Upgrades take no new ground and no new worker — the answer when the hearth's warm ring is full. |
| **Placement** | Ground matters: fertile glades speed farms, rocky ones masons and miners (and break ploughs), marsh yields rich clay but slows construction, forest speeds gatherers. Buildings have several adjacency partners each, and every service venue reaches more villagers with homes around it (+10% capacity per home, up to three) and its supplier next door. The placement ghost and the Inspector spell all of it out. |
| **Roads** | Lay roads point to point (click or tap each bend; Esc, right-click or Done ends one) for a pace of wood each, over cleared ground and around crags and deposits. A workplace joined by road to the hearth or a warehouse works up to 15% faster — the full amount for a road as straight as the crow flies, less for a winding one. A settlement without roads works exactly as before. The placement ghost and the Inspector say what a spot or a building earns. |
| **Caravans** | Once a Trading Post stands, caravans call on a cycle with rotating lots to buy — and pay double for one good they want that visit. Amber is what they trade in, and it buys more than goods: from its second visit each caravan carries one **rare item** — a blueprint toward a service your settlers want, or a cornerstone once none is left — at a price that climbs with every one bought; a **commission** pays now for 12 of any good, delivered with the next caravan (a bridge until a service's workshop stands); and one **trade agreement** per run bends every later caravan — the Provisioners' Guild adds a lot of a service good you cannot make, River Barges call more often and stay longer, the Factors' Compact pays half again for what you sell. Amber also rerolls drafts, rushes construction, and soothes the Queen. |
| **Reputation** | Fills from completed orders, decrees, glade events, reclaimed land, and high resolve — which only pays in full for species whose service needs are met by services you built (a species' own knack, like the harpies' teaching, lifts resolve but not reputation). Fill it and you win. Within a point of victory, milestones no longer interrupt with a draft. |
| **Orders** | Three standing orders. Each is drawn only from goals the settlement has a whole chain of blueprints for, that are within reach of where it stands, and that are not already mostly met — so none completes the moment it is chosen and none clogs a slot all run; when nothing fits, the Queen asks for a counting goal ("produce 40 more Stone") sized from what the settlement makes. When an order is met, the empty slot is refilled by a choice of two (cards show goal, reward and current progress), and once a year you may ask for a different pair for half a point of impatience. The run opens on the **founding writ**: one of three small Year-1 goals (claim two glades, welcome ten settlers, staff four camps) worth the first point of reputation. **Citadel shipments** ask for tools, parts or copper bars, handed over when met, so the deeper industry has a route to reputation too. |
| **Decrees & charter** | Every few minutes the Queen's herald offers a choice of two timed decrees (one for goods, one for building or clearing, when both suit the settlement), or you may beg off both for half a point of impatience. Production decrees are only asked of goods with a staffed producer, and are sized from what those producers turn out over the time allowed. Meet one in time for its reward — reputation for service goods, a full larder, a glade or a new hall; patience restored for staples — and decrees met in a row pay a growing purse of amber. Miss one and her patience frays, more with each further miss until you meet one again. At 10 reputation she grants a one-time charter — a run-shaping perk, more patience, or a guaranteed blueprint. |
| **Impatience** | The Queen's patience. Grows with the calendar, when villagers leave, while **reputation stands still** (after a minute without a new point, a rate that climbs to ~0.5 a minute; the next point resets it — the meter's note and tooltip say so), and sharply once hostility is high. From Year 2 it also grows while species sit below their reputation threshold — in proportion to how many villagers are stalling, and not at all while everyone is earning. From Year 5 her deadline has passed and it climbs steeper every day, so every run ends by ~40 minutes. Fill it and you lose. |
| **Hostility** | Rises with time, population and cleared glades (each one for good), and falls while glades left to the forest stand. Drags resolve down for everyone, gently at first and three times as hard past 15, so the late game squeezes settlements that leave needs unserved. A firekeeper at the hearth can burn herbs as an offering to calm it. |
| **Storm blights** | From Year 2, each Clearance the forest's hostility picks a blight for the coming Storm from the bands it has unlocked — leaking roofs, rotting stores, flooded workshops, a fever, a beast that becomes a threat, a killing frost — and the conditions bar names it with a countdown and the goods that turn it aside (make that many more planks, clay, bricks, herbs or stone before the Storm breaks; half as much again each year). Unprepared, it strikes when the Storm breaks; lasting damage lifts when the Storm passes. |
| **Drafts** | The run opens on a blueprint draft and a founding cornerstone pick (from the commons), and reputation milestones (every odd point) alternate blueprints and cornerstones. Milestone blueprint drafts also offer a cornerstone, so finishing a chain competes with a run-long perk. Nothing is guaranteed and cards say what a building does, not who wants it — except that after a draft with nothing toward a wanted service, the next one carries a piece of it. You can never unlock everything, so which needs you *can* satisfy is the run's central decision. |
| **Stockpile** | One shared cap, raised by warehouses. Food has a larder reserve a quarter past the cap, so a store full of wood never stops the foragers; everything else waits at the brim. The warning names the good filling the store and whether a Warehouse is in reach, and the hearth or a warehouse can dump a chosen good to make room. |
| **Citadel** | Won or lost, each settlement sends supplies home — itemised by reputation, land, orders and years, so a strong loss still pays. Spend them on a 25-upgrade tree in four branches (Provisions, Charters, Knowledge, Crown) with prerequisites; most upgrades widen options rather than add power: extra draft options, a free reroll, a starting cornerstone draft, extra glade-event choices, Citadel-locked cornerstones and lands admitted to the pools, a re-roll or a chosen modifier for the land at setup, a scouts' report on the first ring of glades, a spare charter perk, and a sapphire hearth flame. Six upgrades also open a new commission (below), so the tree changes which runs are on offer. The ledger shows your last ten runs and the commission each was sent out on. |
| **Commissions** | Before a run the setup screen offers *no commission* (the default: the standard settlement) or up to three from the Citadel's board. Each changes what the run is about: a twist applied at the founding and an objective judged at the end. *Hold the Frontier* starts the forest restless but loots 40% more and asks for 12 glades with hostility back under 30; *Light Wagons* packs a quarter less but builds faster and asks you to lose no one; *The Royal Survey* clears faster under a hastier Queen and wants the settlement held by Year 3. Six more are opened by Citadel upgrades — *Found a Trade Town* (Merchant Charter: the Trading Post from the start, caravans more often, double supplies for a standing post and four caravans), *The Queen's Favourite* (a rare cornerstone at the founding, a hastier Queen, end calm), *Open Gates*, *Storm Watch*, *Royal Works* and *The Deep Works* (a Rich Veins land, copper bars) — and an opened commission is always in the next offer. Hold the settlement and meet every term for +50% to +100% supplies (multiplied by the edict). The Orders panel shows each term's live progress, the end screen the verdict and the bonus, and the Citadel the board, what opens each commission and the ledger's results. |
| **Queen's Edicts** | A seven-rung difficulty ladder chosen on the setup screen. Each edict stacks on the ones below (faster impatience, a leaner stockpile, a restless forest, bitter storms, a shorter leash, thinner ranks, a stricter victory) and pays +25% supplies per rung. Winning under your hardest edict unlocks the next. |
| **Lay of the land** | Every map draws one or two of twelve run modifiers from its seed — Rich Veins, Fertile Floodplain, Long Storms, Wandering Traders, Ill Omens and more. Some reshape map generation (deposit counts, glade themes, the odds of dangerous glades, their loot); others are run-long effects folded in like a pact. Most are trade-offs. A typed seed previews them on the setup screen; they are listed in the Orders panel, on the end screen and in the Citadel ledger. Three more lands (Amber Springs, Pilgrim Road, Wild Frontier) are drawn only once a Citadel upgrade admits them. |
| **Daily expedition** | One map a day for everyone, derived from the UTC date alone (no server): the seed, a species trio from all five and the land, played under Edict II with no Citadel upgrades. The menu shows today's expedition and whether you have tried it; the daily page keeps your best result per day, a streak of consecutive days, past dailies, and a share line to copy ("Emberwatch Daily 2026-11-05 — won in Y4, 19 min, 0 lost"). A daily win pays supplies but climbs no edict rung. |
| **Achievements** | 25 local achievements across early, mid and late play — first win, wins under Edicts I/IV/VII, no villager lost, fast wins, a hearth never gone cold, 6 and 12 glades, decrees, every service hall, tier-2 upgrades, Long Storms, every species and trio, daily streaks. Judged from the end-of-run state plus three in-run counters, shown on the end screen and in an Achievements view; a few pay a few supplies or a title worn on the menu. |
| **Run timeline** | The end screen charts how the run unfolded: reputation against impatience over time, with Storms shaded and villager losses, threats, cornerstones and missed decrees marked, plus resolve per species against its threshold and population. A one-line summary says why the run was won or lost, and a table carries every number. The Orders panel shows the live race as a sparkline. |

Idle villagers are your builders and your clearing crews, so every worker you assign is a builder you gave up. That tension is deliberate — the top bar always shows the idle count.

The game plays RTS-style in continuous space: there is no grid. Buildings are placed anywhere on cleared ground with a live ghost cursor, camps must stand within reach of the deposits they work, and warmth and adjacency are real distances. The settlement renders as a 3D scene — low-poly buildings shaped by category (terracotta cottages whose windows glow when someone lives there, canvas camps beside what they gather, brick workshops with chimneys, teal-roofed halls, barns and a market stall), a fire-pit hearth with a flickering flame, villagers tinted by species, a mixed instanced forest over uncleared glades and wooded hills around the valley, season-driven light and rain that keep the Storm readable — drawn in about fifty draw calls whatever the settlement's size (instanced models, one atlas for every icon, label and glade plate), with a 2D vector map available from the top-bar toggle (and used automatically where WebGL is missing). On the 2D map every building stands on a plate shaped and tinted by its district (homes, camps, farms, workshops, services, storage, fires), so a grown settlement reads as quarters; crags and mires carry an icon and say on hover that they can never be cleared; the Storm darkens the ground and drives rain and lightning across the map.

## Architecture

```
src/
  art/                  # the icon set, as SVG path data on a 24×24 grid — no
                        # image files. Base icons (resources, buildings,
                        # species, needs, meters, seasons, deposits, glades,
                        # motifs) plus family frames composed as
                        # `frame/motif` ids (cornerstones, events, threats,
                        # pacts, conditions, lands, charters, Citadel,
                        # edicts, achievements). core.ts is the small eager
                        # set the menu draws; the rest loads with the screens
  game/
    types.ts            # the whole domain model; RunState is plain & serialisable
    content/            # data-only definitions: resources, buildings, species,
                        # terrain, cornerstones, glade events, orders, meta upgrades,
                        # Citadel commissions
    engine/             # pure simulation — no React, no DOM
      balance.ts        #   every tunable number, in one place
      rng.ts            #   counter-based RNG: a value is f(seed, cursor)
      geometry.ts       #   plain 2D maths: distances, point-in-polygon
      mapgen.ts         #   continuous world: glades, terrain, lookups
      worldgen.ts       #   generating one: Voronoi glades, scattered deposits
                        #   & obstacles (loaded only to create a run)
      tick.ts           #   one fixed step of the world
      runCache.ts       #   adjacency & settlement counts remembered across
                        #   ticks, so a tick costs what changed
      production.ts     #   construction, recipes, deposits, terrain yields
      adjacency.ts      #   neighbourhood bonuses (speed & service capacity)
      placement.ts      #   the placement-ghost hint shared by both maps
      roads.ts          #   road rules, and the derived (never saved) road
                        #   graph behind the work bonus, cached per run
      society.ts        #   food, resolve, reputation, impatience, departures
      events.ts         #   glade clearing, drafts, threats, newcomers
      orders.ts         #   the Queen's orders: fitting draws, choices of
                        #   two, the founding writ, counting orders
      structure.ts      #   mid-run beats: timed decrees (sized from live
                        #   output, offered in pairs), the charter,
                        #   lingering glade conditions
      traits.ts         #   species quirks & villager quirks as multipliers
      trade.ts          #   caravan visits, offers, buying and selling, rare
                        #   items, commissions, trade agreements
      actions.ts        #   player commands, each returning a reason on failure
      diagnostics.ts    #   "what is quietly going wrong" for the warning strip
      timeline.ts       #   bounded run history & key moments for the end-screen
                        #   chart; never touches the RNG
    store.ts            # zustand store + the game loop's entry point; its
                        # subscription hooks (see the comment there) keep a
                        # sim step from re-rendering the whole HUD
    frameDerived.ts     # the HUD's (and maps') settlement-wide numbers, once per sim step
  ui/                   # React components; read the sim, never contain rules
                        # (audio.ts synthesises all cues & rain through a
                        # volume mixer; music.ts is the generative score,
                        # loaded on demand — no assets)
    lazyScreens.tsx     #   setup, Citadel, game and end-of-run screens as
                        #   lazy chunks, preloaded once the menu is idle
    MapView.tsx         #   picks the map renderer: 3D by default, 2D fallback
    MapView2D.tsx       #   SVG vector map of the same world (no-WebGL, tests): camera,
                        #   pointer, build ghost; MapLayers2D/MapBuildings2D hold the
                        #   keyed, memoised layers and the villager + weather canvas
    villagerRoutes.ts   #   walking villagers for both maps: routes derived
                        #   from assignments, homes and roads, played back
                        #   against the clock (presentation only)
    map3d/              #   three.js scene via react-three-fiber: vertex-
                        #   coloured ground, instanced forest, buildings and
                        #   props as instanced parts, icons/plates batched in
                        #   a canvas atlas, ghost placement cursor, season
                        #   lighting & shader rain — all lazy-loaded
```

Two rules keep this maintainable:

1. **The engine never imports React.** `RunState` is a plain object mutated by pure functions, which is why the balance harness below can play thousands of simulated minutes in a couple of seconds.
2. **Content is data, not code.** Buildings declare recipes, cornerstones declare effects, orders declare goals. Adding a service building automatically feeds into the blueprint draft logic — nothing has a switch over building ids.

### Determinism

All run randomness is `f(seed, cursor)` with the cursor stored inside `RunState`. A save file therefore resumes to the exact same future, and a seed replays the same map — both covered by tests. Enter any word or number as a seed on the setup screen.

## Testing

`npm test` runs forty-six test files:

- **`engine.test.ts`** — the simulation: RNG determinism, world geometry, map generation invariants, placement rules, production, season cycling, starvation, glade clearing, orders, win/loss, and a save/load round trip.
- **`playtest.test.ts`** — a **balance harness**. A heuristic bot plays whole runs end to end: it builds a food and wood economy, houses everyone, drafts and staffs service chains (moving workers off camps whose output is piling up), joins its workplaces to the hearth by road when it has wood to spare, clears glades — for land, deposits and any open glade order, then, once ten are reclaimed and hostility passes 25, leaves its border glades to the forest — takes the more promising of each pair of orders, and answers the decree it is most likely to meet (staffing that decree's producers first) or begs off when neither looks likely. It also plays the pressure systems the way a careful player would: it finishes chains before starting new ones in a draft and takes a strong cornerstone over an idle blueprint, staffs the makers of whatever the coming Storm blight asks for, sets a firekeeper at the hearth once hostility bites, dumps surplus when a full store has stopped production and no warehouse is affordable, and takes a greedy event option only when it pays reputation and its threat can be paid off at once (or its task is nearly met). Each verbose run line ends with why a lost run was lost (whichever source fed the Queen's impatience most: the deadline, reputation standing still, species below threshold, villagers lost, decrees and events, or the calendar), the impatience by each of those sources, resolve over threshold per species, blights struck and turned aside, firekeeper minutes and impatience from stalling. It drafts a Trading Post when a draft has nothing for its chains and uses the caravans sensibly — a rare blueprint toward a wanted service first, an agreement once the purse allows, a commission for a drafted venue whose workshop is not, surplus sold down to target — and each run line and a summary per group report amber earned (and from where), spent by sink, and how many runs saw caravans. It plays 24 seeds for each of four species trios, plus an *economy-only* control bot that never builds services, and asserts that every run reaches a verdict before 40 minutes, that early collapses are rare, that a competent-but-not-great player wins most maps but not all, that the economy-only bot essentially never wins, and that the trios stay within a band of each other. It prints a per-trio summary including where the winning reputation came from:

  ```
  human/fox/harpy      won 21/24 lost 3 stall 0 early-collapse 0 · avg win 18.4min · longest 35.8min · rep in wins: orders 7.8 decrees 1.7 glades 2.0 events 3.7 resolve 5.0 · … · first rep 1.9min (median) · last-3min share in wins 25%
  ```

  The last two figures are the shape of the climb: the median minute the first point of reputation lands, and how much of a winning run's reputation arrived in its final three minutes (a cascade of instantly-met orders used to put over a third there). Verbose runs also print each run's reputation minute by minute and its decrees met.

  `PLAYTEST_SEEDS=8 PLAYTEST_VERBOSE=1 npx vitest run playtest --reporter=verbose --silent=false` runs a quicker sweep and adds a per-seed diagnosis (resolve vs threshold, unmet needs, service chains, drafts); `PLAYTEST_SEED=<n>` replays one seed across the trios.

  This harness is what the numbers in `balance.ts` were tuned against, and it caught several real design faults during development — most notably that service buildings were originally locked behind reputation, which required the resolve that services provide.
- **`trade.test.ts`** and **`TradePanel.test.tsx`** — the caravan's amber levers: rare items (none on the first visit, a wanted blueprint from the second, a cornerstone once no blueprint is wanted, never one a queued draft offers, dearer with each bought, discounted by trade cornerstones), commissions (paid up front, delivered on arrival, overflow held as a paid lot), each trade agreement's effect, once-per-run signing, older saves; and the Trade panel buying, commissioning and signing through the store.
- **`orders.test.ts`** — the Queen's orders and decrees: no order is offered already met or mostly met, even to a mature settlement; only goals with a whole blueprint chain (and a deposit to work) are offered; far-off goals wait; the counting fallback is sized from live output; the choice of two, the yearly swap and its price; the founding writ; decrees sized from staffed producers' output, offered in pairs and begged off; decree streaks; no milestone draft within a point of victory; and old saves without the new fields.
- **`App.test.tsx`** — UI smoke tests that mount the real app in jsdom and click the path a player takes: menu → setup → blueprint draft → placing a building → switching panels → winning.
- **`HudDock.test.tsx`** — the HUD over the map: the overlay dock's regions (warnings and notices on top, the tip or the inspector bottom-left, decree and threats bottom-centre, toasts bottom-right), the side panel folding to a bottom sheet, the resource bar's grouping by purpose, its rolling stock trends (rising, falling, about to run dry), the empty goods holding a building up and the "All stock" drawer, and the meters' rate line and short labels.
- **`forecast.test.ts`** — the HUD's forward-looking numbers (Storm countdown, wood and food runways, meter rates, building status), checked against what a real tick applies.
- **`citadel.test.ts`** — meta progression: save migration, upgrade prerequisites, Queen's Edicts, locked cornerstones, draft sizes and the reward breakdown.
- **`commissions.test.ts`** and **`Commissions.test.tsx`** — Citadel commissions: content invariants, which upgrade opens each, the rotating offer (a newly opened one always shown), that no commission founds exactly the standard run, every twist (hostility, stock, blueprints, a royal cornerstone that leaves the run's RNG alone, a promised land), judging each kind of term live and at the end, the supply bonus under edicts, the ledger, old runs and Citadel saves; and in the UI the setup pick, the Orders-panel card, the end-screen verdict, the ledger and the Citadel board. The balance harness also forces each commission on a smaller seed set, like the land modifiers.
- **`upgrades.test.ts`** and **`UpgradeSection.test.tsx`** — building upgrades: every tier effect (housing, comfort, insulation, storage, service capacity, slots, speed, reach, warmth, recipes and ratios), the upgrade construction flow with builders and rush, decree counting, save/load mid-upgrade and old saves; and the Inspector's upgrade block.
- **`runModifiers.test.ts`** — the map-modifier pool: content invariants, seed-deterministic draws, mapgen hooks changing deposit counts exactly as declared, effects folding into the modifiers (seasons, caravans, decrees, braziers, terrain, adjacency), and saves and history. The balance harness also forces each modifier in turn on a smaller seed set and checks it stays winnable but not trivial; it does the same for each Citadel commission (`PLAYTEST_COMMISSION_SEEDS`, 6 by default) and prints how often the bot meets each objective without aiming for it.
- **`timeline.test.ts`** and **`RunTimeline.test.tsx`** — the run timeline: sampling cadence, the size bound and downsampling, recorded events, save/load and old saves, the outcome sentence, and the end-screen chart's keyboard readout, views and table.
- **`onboarding.test.ts`** and **`Onboarding.test.tsx`** — the opening: the first-steps checklist (including a scripted newcomer who does only what it says and must still be standing after the first Storm on every harness trio), the first royal decree, and how the blueprint draft presents its options.
- **`tension.test.ts`** and **`GladeTruce.test.tsx`** — mid-run tension: stagnation impatience (grace, ramp, cap, reset on any reputation point, older saves start the count on load, named apart from the calendar), rising expectations scaled by needs met, glades left to the forest (crew recalled, clearing blocked, hostility calmed until it falls, the costly truce-breaking, permanent growth per cleared glade), and the Storm's shrinking hearth reach (steps to the floor, edge homes cold late, chill as its own term, frost losses, lizards spared, braziers, the Clearance warning); the UI test drives the Inspector's glade section through sparing and the two-step truce-breaking.
- **`pressure.test.ts`** — mid-run pressure: impatience relief borrowing from whole points, the Queen's stalling term, Storm blights (bands, forecast, turning one aside, striking, passing with the Storm, yearly growth), the hearth's offerings, glade stakes, escalating threats, the draft's pity rule and mixed drafts, the opening cornerstone and odd milestones, the larder reserve, dumping goods, the full-stockpile advice, and older saves.
- **`balanceTuning.test.ts`** — the rules the harness was last tuned with: the late-game hostility squeeze, escalating decree misses, and the harpies' Education and lizards' Brawling floors.
- **`saves.test.ts`** and **`SavesScreen.test.tsx`** — save slots: the slot index and its repair, migration of the single save, overwrite protection, full storage, the export/import round trip, and rejecting malformed and hostile files (prototype keys, mangled fields) without throwing.
- **`mapShared.test.ts`** and **`MapView2D.test.tsx`** — the shared map helpers and the 2D renderer: glade kinds, district plates, building badges, obstacles, the Storm's ground wash, warmth, roads and villagers, that static geometry is not rebuilt on every tick, and that the map layers' building views re-derive at once after a command but only on the HUD clock while the sim ticks.
- **`runCache.test.ts`** and **`frameDerived.test.ts`** — the performance layer: the cached adjacency and settlement counts answer exactly what the plain queries do, before and after hand edits and engine changes mid-tick and through a played run; the HUD's shared per-step numbers equal the engine functions they stand for, and every building's status for a step is looked up in one run-cache scope (a scope per lookup made a pass over the settlement quadratic); the HUD clock throttles sim steps but not commands, pauses or season turns; the idle-time autosave.
- **`roads.test.ts`** — the road graph and its bonus (directness, junctions, warehouse hubs), the rules for laying roads, the cache that keeps the per-tick cost a lookup, and old saves without roads.
- **`villagerRoutes.test.ts`** — the walking villagers' routes: a pure function of the run, following roads where they run and walking straight where they do not.
- **`audio.test.ts`**, **`music.test.ts`** and **`SoundSettings.test.tsx`** — sound, against a small fake `AudioContext` (`src/test/fakeAudio.ts`): no context before a user gesture, each volume bus wired into the master at its saved level, mute, ducking, older settings migrating to the default levels, and the sliders in both settings panels. For the score: seasonal palettes, a seeded composer that stays in key and does not loop, look-ahead scheduling, the crossfade on a change of season, and holding while paused or hidden.
- **`LazyScreens.test.tsx`** — the lazily loaded screens from cold: each shows its loading state, then renders, and all are preloaded in idle time (the game screen at once when there is a save to continue). The other UI tests preload them first (`src/test/setup-ui.ts`) and click straight through.
- **`icons.test.ts`**, **`Icon.test.tsx`** and **`sprites.test.tsx`** — the icon set: every resource, building, species, need, meter, season, deposit, glade kind and terrain, and every cornerstone, glade event, threat, pact, condition, land, charter, Citadel upgrade, edict, achievement, trait, tab and status badge has drawn art (anything still on its emoji fallback must be listed on purpose), framed families stay distinct, the menu draws only from the eager core, the `<Icon>` component's accessibility and fallback, the text-to-icon swap for sim messages, and that the 3D map rasterises each icon once.
- **`parts.test.tsx`** — the 3D map's draw-call budget: every building in every state, and every deposit and obstacle, draws from a small fixed set of instanced meshes that does not grow with the number of buildings; the sprite atlas paints a tile once, shares it and evicts only unused tiles; smoke sits on the rotated chimney; the model key holds still while only work and stock change.
- **`GladeList.test.tsx`** — the 3D map's glade list for the keyboard: one button per fogged glade with one Tab stop, arrows / Home / End move without panning the camera, Enter (or a click) picks the glade and glides the camera there.
- **`PerfReadout.test.tsx`** — the opt-in performance readout: off by default and for older settings, the Settings toggle saves it, nothing mounts (not even a frame callback) while it is off, and on it shows fps, frame time and the 3D draw calls.

## PWA

`vite-plugin-pwa` generates the manifest and a Workbox service worker precaching the whole app shell, so after one load the game runs fully offline — there is no server component. Runs autosave to `localStorage` every 8 seconds (written when the browser is next idle, so the write never lands inside a frame), and at once on tab hide and page unload; the game pauses itself when the tab is backgrounded rather than fast-forwarding on return.

Only the menu ships in the startup chunks (about 220 kB minified, 72 kB gzipped, plus React). The setup, Citadel, saves, achievements and game screens, the end-of-run summary with its timeline chart, the map generator (only needed to create a run), the 3D map (three.js) and the music engine are separate chunks: the screens and the map generator are preloaded in idle time once the menu is up (the game screen right after the first paint when there is a save to continue) and then render without a loading state, the 3D map loads when it is shown, and the music engine loads only when music is audible. The service worker precaches every chunk.

**Save slots.** There are four run slots — Autosave plus Slots 1–3 — listed on the menu's *Saved settlements* screen with their species, edict, season, reputation, impatience, modifiers, seed and when they were last played. Each run autosaves to its own slot; *Continue* resumes the most recently played one. A new settlement takes a free slot and only replaces a run when the player picks that slot and confirms. The Autosave slot keeps the original `emberwatch.run.v1` key, so a save from before slots simply appears there; a small index (`emberwatch.slots.v1`) holds the metadata and is rebuilt from the slots whenever it disagrees with them (`src/game/saveSlots.ts`). A save that no longer fits in storage leaves the previous one intact and says so once.

**Export and import.** Any slot exports as a versioned JSON file (`{ format: "emberwatch-run", version, exportedAt, meta, run }`) or as text to copy, for phones. Imports are untrusted: parsed with `JSON.parse` only, with `__proto__`/`constructor`/`prototype` keys stripped, shape-checked field by field, migrated through the same defaults as a local save, and ticked once on a copy before anything is written (`src/game/saveFile.ts`).

**Performance readout.** Settings → *Show performance* (off by default, saved with the settings) puts fps, mean and worst frame time and, on the 3D map, the renderer's draw calls in the map's corner, for checking the game on real hardware. Off, nothing of it is mounted.

**Speeds.** Pause and 1×–5× (keys Space and 1–5). The loop's per-frame budget scales with speed, so 5× keeps real time even at a couple of frames a second, while one stalled frame can still only advance the world a few seconds.

Icons are generated at build time by `scripts/generate-icons.mjs`, which writes real PNGs using only `node:zlib` — no binary assets in the repo and no image dependencies.

## CI & deployment

`.github/workflows/ci.yml` runs on every pull request and every push to `main`: `npm ci` → typecheck → `npx vitest run` → `npm run build` → the Playwright smoke test against that build. A newer push to the same PR cancels the run it supersedes. If the smoke test fails, its HTML report and traces are uploaded as a run artifact (`playwright-report-*`); open a trace with `npx playwright show-trace <trace.zip>`.

The repository is private, so the game is not on GitHub Pages. It is hosted as a private claude.ai Artifact, which its owner can share from the page's Share menu: **https://claude.ai/artifact/M78ydYF34bBJ7X2Ku1BctL**.

`npm run build:artifact` builds and then writes `dist-artifact/` (`scripts/artifact-page.mjs`): `emberwatch.html` holds the built page without its document wrapper (the Artifact host supplies that), alongside `assets/`, `icons/` and `favicon.svg`. Republishing that page to the same artifact URL updates the game in place. The Artifact host does not run service workers, so offline play and installing as an app only apply to builds served elsewhere; saves still persist in the browser's local storage for that page.

### The smoke test

`e2e/smoke.spec.ts` drives a production build in real Chromium — the things the jsdom tests cannot see, since they call the store directly:

- menu → New settlement → Set out → answer the opening draft → the game;
- the in-game clock advances in real time at 1× (measured on the 2D map against the frame time the page actually received, so a sim that never ticks at 60 fps fails while a slow machine does not), and the autosave persists it;
- the 3D map mounts a WebGL canvas (headless Chromium uses SwiftShader) and the 2D map's SVG renders;
- the manifest, its icons and the service worker resolve under the base path, and the app boots offline;
- the longest warning wraps inside the dock's top region at 1280, 1440 and 1920 px and on a phone, clear of the side panel;
- the keyboard reaches the 3D glade plates through the glade list (focus shows it, arrows move, Enter opens the glade in the Inspector);
- a 390×844 touch phone reaches the game without horizontal overflow;
- no page errors, console errors or failed requests along the way.

```bash
npx playwright install chromium        # once; CI uses --with-deps
npm run test:e2e                       # builds, serves on :4319, runs (~30 s)
BASE_PATH=/sub/path/ npm run test:e2e         # same, served under a sub-path
E2E_SKIP_BUILD=1 npm run test:e2e      # reuse an existing dist/
```

`BASE_PATH` sets Vite's `base`. Unset, it stays relative (`./`), so `npm run dev`, `vitest` and `npm run preview` behave as before; the manifest's `start_url`/`scope` and icon paths are relative to it, and the service worker registers at the base with the base as its scope. The app has no router, so no SPA 404 fallback is needed.

### Optional setup for the repository owner

- In Settings → Branches, require the "Typecheck, tests, build, browser smoke test" check before merging to `main`.

### Dependency audit

`npm audit` reports only four low-severity entries, all one advisory: [deepmerge prototype poisoning](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). No patched deepmerge exists. It reaches the project only through `vite-plugin-pwa → workbox-build → @rollup/plugin-node-resolve`, which runs at build time and merges configuration this repository writes, so no untrusted input reaches it.

`package.json` overrides workbox-build's `glob` to 14.x, which clears the glob and minimatch advisories. workbox-build calls only `globSync` with `cwd`, `follow` and `ignore`, which glob 14 still supports. The generated service worker precaches the same files. Remove the override once workbox-build depends on a patched glob itself.

npm 10 crashes ("Cannot read properties of null (reading 'edgesOut')") when it re-resolves this dependency tree, for example in `npm audit fix` or `npm update`. It trips on vitest's optional peer dependencies. Update dependencies with npm 11 (`npx npm@11 update <pkg>`); `npm ci` on npm 10, as CI uses, installs the resulting lockfile normally.

## Known scope limits

- Art is emoji throughout; there are no sprites. Audio is synthesised in WebAudio (season stings, event cues, a rain loop that follows the season, and a generative ambient score) — no recorded assets. Master, music, effects and rain each have a volume slider. The score is on at a low level (30%) by default: pads and sparse motifs in D dorian for the Drizzle, G lydian for the Clearance and a lower A aeolian with a drone for the Storm, darkened while a threat is loose or the Queen's impatience passes 70%, crossfaded at each change of season, ducked under event cues and held while paused or hidden. It schedules notes on the audio clock about once a second, with no per-frame work.
- Meta progression is an upgrade tree, a difficulty ladder and a board of commissions, with no world map campaign. Edicts were sanity-checked against the balance bot (it wins less often as the ladder climbs) but are not asserted by the harness.
- ~30 buildings, 34 glade events, 40+ cornerstones and 12 map modifiers — enough for the loop to have real decisions, well short of Against the Storm's catalogue.
- Buildings have circular footprints and free placement. Roads are straight stretches with no traffic; villagers walk them for show, while the simulation stays assignment-based.
