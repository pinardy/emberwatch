# Emberwatch

A roguelite city builder in the style of [Against the Storm](https://store.steampowered.com/app/1336490/Against_the_Storm/), built as an offline-capable Progressive Web App with React + TypeScript.

You are a viceroy sent into a rain-soaked forest. Raise a settlement, keep three species of villager from walking out on you, and earn the Queen's favour before her patience runs out. Every run is a new map, a new draft of buildings, and a new set of perks.

```bash
npm install
npm run dev        # play at the printed localhost URL
npm test           # 319 tests: simulation, forecasts, Citadel, balance harness, UI
npm run build      # typecheck + production build + service worker
npm run preview    # serve the built PWA (installable, works offline)
npm run test:e2e   # real-browser smoke test (Playwright + Chromium)
```

## The loop

| System | What it does |
| --- | --- |
| **Seasons** | Drizzle → Clearance → Storm, ~7 minutes a year. Farms fail in the Storm, gathering halves, and the hearth burns wood. |
| **Glades** | The world is a continuous forest partitioned into fogged glades. Assign villagers to clear those bordering your territory for resources; dangerous and forbidden glades force a decision when opened. |
| **Threats** | The greedy option in a glade event can unleash a timed menace that strikes on a repeating countdown — stealing stock, raising hostility, fraying the Queen's patience — until you pay it off. Other options grant run-long pacts instead. |
| **Lingering conditions** | Some glade choices leave an aftermath tied to the build loop — flooded paths slow construction until you lay planks, a spirit wants incense before its deadline, a blight saps resolve until a new service hall stands. The bar above the threats tracks each one's progress. |
| **Resolve** | Each species has a resolve score driven by housing, food variety, satisfied service needs, and hostility (hunger ramps in over about a meal). Above its threshold, a species earns **reputation**; at −5 or below it despairs, and after 70 s one villager leaves, then the rest hold on 30 s longer before the next follows — the warning strip counts it down. Every species also bends one rule — lizards shrug off a cold hearth, idle beavers build faster, harpies clear glades from the air — and most villagers arrive with a personal quirk. |
| **Warmth** | Housing within the hearth's warmth radius is safe; homes beyond it chill their residents during the Storm unless a **brazier** stands near them — a small fire bowl (a starting blueprint) that warms homes in its own radius but burns wood every Storm second, and goes cold when the woodpile runs dry. |
| **Upgrades** | Twenty buildings can be raised one or two tiers — a shelter into a reinforced shelter (insulated against the Storm) and then a snug lodge (comfort), a tavern into a taproom and an alehouse, a mill into a joinery. First tiers cost mostly planks and bricks, second tiers parts, tools or copper bars, so the deeper chains pay off late. An upgrade is a construction job for idle builders (rushable with amber); the building keeps working at its old tier until it lands. Upgrades take no new ground and no new worker — the answer when the hearth's warm ring is full. |
| **Placement** | Ground matters: fertile glades speed farms, rocky ones masons and miners (and break ploughs), marsh yields rich clay but slows construction, forest speeds gatherers. Buildings have several adjacency partners each, and every service venue reaches more villagers with homes around it (+10% capacity per home, up to three) and its supplier next door. The placement ghost and the Inspector spell all of it out. |
| **Roads** | Lay roads point to point (click or tap each bend; Esc, right-click or Done ends one) for a pace of wood each, over cleared ground and around crags and deposits. A workplace joined by road to the hearth or a warehouse works up to 15% faster — the full amount for a road as straight as the crow flies, less for a winding one. A settlement without roads works exactly as before. The placement ghost and the Inspector say what a spot or a building earns. |
| **Caravans** | Once a Trading Post stands, caravans call on a cycle with rotating lots to buy — and pay double for one good they want that visit. Amber also rerolls drafts, rushes construction, and soothes the Queen. |
| **Reputation** | Fills from completed orders, glade events, reclaimed land, and high resolve — which only pays in full for species whose service needs are met. Fill it and you win. |
| **Decrees & charter** | Every few minutes the Queen issues a timed decree: meet it before the countdown ends for extra reputation and amber, or miss it and her patience frays. At 10 reputation she grants a one-time charter — a run-shaping perk, more patience, or a guaranteed blueprint. |
| **Impatience** | The Queen's patience. Grows over time, when villagers leave, and sharply once hostility is high. From Year 5 her deadline has passed and it climbs steeper every day, so every run ends by ~40 minutes. Fill it and you lose. |
| **Hostility** | Rises with time, population and cleared glades. Drags resolve down for everyone. |
| **Drafts** | The run opens on a blueprint draft, and reputation milestones alternate blueprints and cornerstones. You can never unlock everything, so which needs you *can* satisfy is the run's central decision. |
| **Citadel** | Won or lost, each settlement sends supplies home — itemised by reputation, land, orders and years, so a strong loss still pays. Spend them on an 18-upgrade tree in four branches (Provisions, Charters, Knowledge, Crown) with prerequisites; most upgrades widen options rather than add power: extra draft options, a free reroll, a starting cornerstone draft, extra glade-event choices, and Citadel-locked cornerstones admitted to the draft pool. The ledger shows your last ten runs. |
| **Queen's Edicts** | A seven-rung difficulty ladder chosen on the setup screen. Each edict stacks on the ones below (faster impatience, a leaner stockpile, a restless forest, bitter storms, a shorter leash, thinner ranks, a stricter victory) and pays +25% supplies per rung. Winning under your hardest edict unlocks the next. |
| **Lay of the land** | Every map draws one or two of twelve run modifiers from its seed — Rich Veins, Fertile Floodplain, Long Storms, Wandering Traders, Ill Omens and more. Some reshape map generation (deposit counts, glade themes, the odds of dangerous glades, their loot); others are run-long effects folded in like a pact. Most are trade-offs. A typed seed previews them on the setup screen; they are listed in the Orders panel, on the end screen and in the Citadel ledger. |
| **Run timeline** | The end screen charts how the run unfolded: reputation against impatience over time, with Storms shaded and villager losses, threats, cornerstones and missed decrees marked, plus resolve per species against its threshold and population. A one-line summary says why the run was won or lost, and a table carries every number. The Orders panel shows the live race as a sparkline. |

Idle villagers are your builders and your clearing crews, so every worker you assign is a builder you gave up. That tension is deliberate — the top bar always shows the idle count.

The game plays RTS-style in continuous space: there is no grid. Buildings are placed anywhere on cleared ground with a live ghost cursor, camps must stand within reach of the deposits they work, and warmth and adjacency are real distances. The settlement renders as a 3D scene — low-poly buildings, a wild instanced forest over uncleared glades, season-driven light and rain — with a 2D vector map available from the top-bar toggle (and used automatically where WebGL is missing).

## Architecture

```
src/
  game/
    types.ts            # the whole domain model; RunState is plain & serialisable
    content/            # data-only definitions: resources, buildings, species,
                        # terrain, cornerstones, glade events, orders, meta upgrades
    engine/             # pure simulation — no React, no DOM
      balance.ts        #   every tunable number, in one place
      rng.ts            #   counter-based RNG: a value is f(seed, cursor)
      geometry.ts       #   plain 2D maths: distances, point-in-polygon
      mapgen.ts         #   continuous world: Voronoi glades, scattered
                        #   deposits & obstacles
      tick.ts           #   one fixed step of the world
      production.ts     #   construction, recipes, deposits, terrain yields
      adjacency.ts      #   neighbourhood bonuses (speed & service capacity)
      placement.ts      #   the placement-ghost hint shared by both maps
      roads.ts          #   road rules, and the derived (never saved) road
                        #   graph behind the work bonus, cached per run
      society.ts        #   food, resolve, reputation, impatience, departures
      events.ts         #   glade clearing, drafts, threats, orders, newcomers
      structure.ts      #   mid-run beats: timed decrees, the charter,
                        #   lingering glade conditions
      traits.ts         #   species quirks & villager quirks as multipliers
      trade.ts          #   caravan visits, offers, buying and selling
      actions.ts        #   player commands, each returning a reason on failure
      diagnostics.ts    #   "what is quietly going wrong" for the warning strip
      timeline.ts       #   bounded run history & key moments for the end-screen
                        #   chart; never touches the RNG
    store.ts            # zustand store + the game loop's entry point
  ui/                   # React components; read the sim, never contain rules
                        # (audio.ts synthesises all cues & rain — no assets)
    MapView.tsx         #   picks the map renderer: 3D by default, 2D fallback
    MapView2D.tsx       #   SVG vector map of the same world (no-WebGL, tests)
    villagerRoutes.ts   #   walking villagers for both maps: routes derived
                        #   from assignments, homes and roads, played back
                        #   against the clock (presentation only)
    map3d/              #   three.js scene via react-three-fiber: glade
                        #   polygons, instanced forest, procedural buildings,
                        #   ghost placement cursor, season lighting & rain —
                        #   all lazy-loaded
```

Two rules keep this maintainable:

1. **The engine never imports React.** `RunState` is a plain object mutated by pure functions, which is why the balance harness below can play thousands of simulated minutes in a couple of seconds.
2. **Content is data, not code.** Buildings declare recipes, cornerstones declare effects, orders declare goals. Adding a service building automatically feeds into the blueprint draft logic — nothing has a switch over building ids.

### Determinism

All run randomness is `f(seed, cursor)` with the cursor stored inside `RunState`. A save file therefore resumes to the exact same future, and a seed replays the same map — both covered by tests. Enter any word or number as a seed on the setup screen.

## Testing

`npm test` runs sixteen test files:

- **`engine.test.ts`** — the simulation: RNG determinism, world geometry, map generation invariants, placement rules, production, season cycling, starvation, glade clearing, orders, win/loss, and a save/load round trip.
- **`playtest.test.ts`** — a **balance harness**. A heuristic bot plays whole runs end to end: it builds a food and wood economy, houses everyone, drafts and staffs service chains (moving workers off camps whose output is piling up), joins its workplaces to the hearth by road when it has wood to spare, and clears glades. It plays 24 seeds for each of three species trios, plus an *economy-only* control bot that never builds services, and asserts that every run reaches a verdict before 40 minutes, that early collapses are rare, that a competent-but-not-great player wins most maps but not all, that the economy-only bot essentially never wins, and that the trios stay within a band of each other. It prints a per-trio summary including where the winning reputation came from:

  ```
  human/fox/harpy      won 19/24 lost 5 stall 0 early-collapse 0 · avg win 23.4min · longest 32.0min · rep in wins: orders 8.5 glades 2.0 events 3.2 resolve 6.6
  ```

  `PLAYTEST_SEEDS=8 PLAYTEST_VERBOSE=1 npx vitest run playtest --reporter=verbose --silent=false` runs a quicker sweep and adds a per-seed diagnosis (resolve vs threshold, unmet needs, service chains, drafts); `PLAYTEST_SEED=<n>` replays one seed across the trios.

  This harness is what the numbers in `balance.ts` were tuned against, and it caught several real design faults during development — most notably that service buildings were originally locked behind reputation, which required the resolve that services provide.
- **`App.test.tsx`** — UI smoke tests that mount the real app in jsdom and click the path a player takes: menu → setup → blueprint draft → placing a building → switching panels → winning.
- **`forecast.test.ts`** — the HUD's forward-looking numbers (Storm countdown, wood and food runways, meter rates, building status), checked against what a real tick applies.
- **`citadel.test.ts`** — meta progression: save migration, upgrade prerequisites, Queen's Edicts, locked cornerstones, draft sizes and the reward breakdown.
- **`upgrades.test.ts`** and **`UpgradeSection.test.tsx`** — building upgrades: every tier effect (housing, comfort, insulation, storage, service capacity, slots, speed, reach, warmth, recipes and ratios), the upgrade construction flow with builders and rush, decree counting, save/load mid-upgrade and old saves; and the Inspector's upgrade block.
- **`runModifiers.test.ts`** — the map-modifier pool: content invariants, seed-deterministic draws, mapgen hooks changing deposit counts exactly as declared, effects folding into the modifiers (seasons, caravans, decrees, braziers, terrain, adjacency), and saves and history. The balance harness also forces each modifier in turn on a smaller seed set and checks it stays winnable but not trivial.
- **`timeline.test.ts`** and **`RunTimeline.test.tsx`** — the run timeline: sampling cadence, the size bound and downsampling, recorded events, save/load and old saves, the outcome sentence, and the end-screen chart's keyboard readout, views and table.
- **`onboarding.test.ts`** and **`Onboarding.test.tsx`** — the opening: the first-steps checklist, the first royal decree, and how the blueprint draft presents its options.
- **`saves.test.ts`** and **`SavesScreen.test.tsx`** — save slots: the slot index and its repair, migration of the single save, overwrite protection, full storage, the export/import round trip, and rejecting malformed and hostile files (prototype keys, mangled fields) without throwing.
- **`mapShared.test.ts`** and **`MapView2D.test.tsx`** — the shared map helpers and the 2D renderer: glade kinds, building badges, warmth, roads and villagers, and that static geometry is not rebuilt on every tick.
- **`roads.test.ts`** — the road graph and its bonus (directness, junctions, warehouse hubs), the rules for laying roads, the cache that keeps the per-tick cost a lookup, and old saves without roads.
- **`villagerRoutes.test.ts`** — the walking villagers' routes: a pure function of the run, following roads where they run and walking straight where they do not.

## PWA

`vite-plugin-pwa` generates the manifest and a Workbox service worker precaching the whole app shell, so after one load the game runs fully offline — there is no server component. Runs autosave to `localStorage` every 8 seconds, on tab hide, and on page unload; the game pauses itself when the tab is backgrounded rather than fast-forwarding on return.

**Save slots.** There are four run slots — Autosave plus Slots 1–3 — listed on the menu's *Saved settlements* screen with their species, edict, season, reputation, impatience, modifiers, seed and when they were last played. Each run autosaves to its own slot; *Continue* resumes the most recently played one. A new settlement takes a free slot and only replaces a run when the player picks that slot and confirms. The Autosave slot keeps the original `emberwatch.run.v1` key, so a save from before slots simply appears there; a small index (`emberwatch.slots.v1`) holds the metadata and is rebuilt from the slots whenever it disagrees with them (`src/game/saveSlots.ts`). A save that no longer fits in storage leaves the previous one intact and says so once.

**Export and import.** Any slot exports as a versioned JSON file (`{ format: "emberwatch-run", version, exportedAt, meta, run }`) or as text to copy, for phones. Imports are untrusted: parsed with `JSON.parse` only, with `__proto__`/`constructor`/`prototype` keys stripped, shape-checked field by field, migrated through the same defaults as a local save, and ticked once on a copy before anything is written (`src/game/saveFile.ts`).

**Speeds.** Pause and 1×–5× (keys Space and 1–5). The loop's per-frame budget scales with speed, so 5× keeps real time even at a couple of frames a second, while one stalled frame can still only advance the world a few seconds.

Icons are generated at build time by `scripts/generate-icons.mjs`, which writes real PNGs using only `node:zlib` — no binary assets in the repo and no image dependencies.

## CI & deployment

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

1. **Checks** (all events): `npm ci` → typecheck → `npx vitest run` → `npm run build` → the Playwright smoke test against that build. A newer push to the same PR cancels the run it supersedes. If the smoke test fails, its HTML report and traces are uploaded as a run artifact (`playwright-report-*`); open a trace with `npx playwright show-trace <trace.zip>`.
2. **Deploy** (pushes to `main` only, after the checks pass): rebuilds with `BASE_PATH=/roguelite-game/`, runs the smoke test again against that exact build served under the sub-path, then publishes `dist/` with `actions/upload-pages-artifact` + `actions/deploy-pages` to the `github-pages` environment. It can also be re-run by hand (Actions → CI → Run workflow on `main`).

The site is served at **https://pinardy.github.io/roguelite-game/**.

### The smoke test

`e2e/smoke.spec.ts` drives a production build in real Chromium — the things the jsdom tests cannot see, since they call the store directly:

- menu → New settlement → Set out → answer the opening draft → the game;
- the in-game clock advances in real time at 1× (measured on the 2D map against the frame time the page actually received, so a sim that never ticks at 60 fps fails while a slow machine does not), and the autosave persists it;
- the 3D map mounts a WebGL canvas (headless Chromium uses SwiftShader) and the 2D map's SVG renders;
- the manifest, its icons and the service worker resolve under the base path, and the app boots offline;
- a 390×844 touch phone reaches the game without horizontal overflow;
- no page errors, console errors or failed requests along the way.

```bash
npx playwright install chromium        # once; CI uses --with-deps
npm run test:e2e                       # builds, serves on :4319, runs (~30 s)
BASE_PATH=/roguelite-game/ npm run test:e2e   # same, under the Pages sub-path
E2E_SKIP_BUILD=1 npm run test:e2e      # reuse an existing dist/
```

`BASE_PATH` sets Vite's `base`. Unset, it stays relative (`./`), so `npm run dev`, `vitest` and `npm run preview` behave as before; the manifest's `start_url`/`scope` and icon paths are relative to it, and the service worker registers at the base with the base as its scope. The app has no router, so no SPA 404 fallback is needed.

### One-time setup for the repository owner

- **Settings → Pages → Build and deployment → Source: "GitHub Actions".** Until this is set, the deploy job fails at the deploy step.
- GitHub Pages on a **private** repository requires a paid plan (GitHub Pro, Team or Enterprise). On the free plan the repository must be public for the site to publish.
- Optional: in Settings → Branches, require the "Typecheck, tests, build, browser smoke test" check before merging to `main`.

### Dependency audit

`npm audit` reports only four low-severity entries, all one advisory: [deepmerge prototype poisoning](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). No patched deepmerge exists. It reaches the project only through `vite-plugin-pwa → workbox-build → @rollup/plugin-node-resolve`, which runs at build time and merges configuration this repository writes, so no untrusted input reaches it.

`package.json` overrides workbox-build's `glob` to 14.x, which clears the glob and minimatch advisories. workbox-build calls only `globSync` with `cwd`, `follow` and `ignore`, which glob 14 still supports. The generated service worker precaches the same files. Remove the override once workbox-build depends on a patched glob itself.

npm 10 crashes ("Cannot read properties of null (reading 'edgesOut')") when it re-resolves this dependency tree, for example in `npm audit fix` or `npm update`. It trips on vitest's optional peer dependencies. Update dependencies with npm 11 (`npx npm@11 update <pkg>`); `npm ci` on npm 10, as CI uses, installs the resulting lockfile normally.

## Known scope limits

- Art is emoji throughout; there are no sprites. Audio is synthesised in WebAudio (season stings, event cues, a rain loop that follows the season) — no recorded assets.
- Meta progression is an upgrade tree and a difficulty ladder, with no world map campaign. Edicts were sanity-checked against the balance bot (it wins less often as the ladder climbs) but are not asserted by the harness.
- ~30 buildings, 34 glade events, 40+ cornerstones and 12 map modifiers — enough for the loop to have real decisions, well short of Against the Storm's catalogue.
- Buildings have circular footprints and free placement. Roads are straight stretches with no traffic; villagers walk them for show, while the simulation stays assignment-based.
