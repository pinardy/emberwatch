# Emberwatch

A roguelite city builder, built as an offline-capable Progressive Web App with React + TypeScript.

You are a viceroy sent into a rain-soaked forest. Raise a settlement, keep three species of villager from walking out on you, and earn the Queen's favour before her patience runs out. Every run is a new map, a new draft of buildings, and a new set of perks.

```bash
npm install
npm run dev        # play at the printed localhost URL
npm test           # 64 tests: simulation, balance harness, UI
npm run build      # typecheck + production build + service worker
npm run preview    # serve the built PWA (installable, works offline)
```

## The loop

| System | What it does |
| --- | --- |
| **Seasons** | Drizzle → Clearance → Storm, ~7 minutes a year. Farms fail in the Storm, gathering halves, and the hearth burns wood. |
| **Glades** | The map is a hex field of fogged glades. Assign villagers to clear those bordering your territory for resources; dangerous and forbidden glades force a decision when opened. |
| **Threats** | The greedy option in a glade event can unleash a timed menace that strikes on a repeating countdown — stealing stock, raising hostility, fraying the Queen's patience — until you pay it off. Other options grant run-long pacts instead. |
| **Resolve** | Each species has a resolve score driven by housing, food variety, satisfied service needs, and hostility. Above its threshold, a species earns **reputation**. Every species also bends one rule — lizards shrug off a cold hearth, idle beavers build faster, harpies clear glades from the air — and most villagers arrive with a personal quirk. |
| **Warmth** | Housing within the hearth's warmth radius is safe; homes beyond it chill their residents during the Storm. A few production buildings also work faster placed beside their supplier. |
| **Caravans** | Once a Trading Post stands, caravans call on a cycle with rotating lots to buy — and pay double for one good they want that visit. Amber also rerolls drafts, rushes construction, and soothes the Queen. |
| **Reputation** | Fills from high resolve, completed orders, and reclaimed land. Fill it and you win. |
| **Impatience** | The Queen's patience. Grows over time, when villagers leave, and sharply once hostility is high. Fill it and you lose. |
| **Hostility** | Rises with time, population and cleared glades. Drags resolve down for everyone. |
| **Drafts** | The run opens on a blueprint draft, and reputation milestones alternate blueprints and cornerstones. You can never unlock everything, so which needs you *can* satisfy is the run's central decision. |
| **Citadel** | Won or lost, each settlement sends supplies home. Spend them on species charters and provisions that carry into future runs. |

Idle villagers are your builders and your clearing crews, so every worker you assign is a builder you gave up. That tension is deliberate — the top bar always shows the idle count.

## Architecture

```
src/
  game/
    types.ts            # the whole domain model; RunState is plain & serialisable
    content/            # data-only definitions: resources, buildings, species,
                        # cornerstones, glade events, orders, meta upgrades
    engine/             # pure simulation — no React, no DOM
      balance.ts        #   every tunable number, in one place
      rng.ts            #   counter-based RNG: a value is f(seed, cursor)
      mapgen.ts         #   hex map + Voronoi glade partitioning
      tick.ts           #   one fixed step of the world
      production.ts     #   construction, recipes, deposits, adjacency
      society.ts        #   food, resolve, reputation, impatience, departures
      events.ts         #   glade clearing, drafts, threats, orders, newcomers
      traits.ts         #   species quirks & villager quirks as multipliers
      trade.ts          #   caravan visits, offers, buying and selling
      actions.ts        #   player commands, each returning a reason on failure
      diagnostics.ts    #   "what is quietly going wrong" for the warning strip
    store.ts            # zustand store + the game loop's entry point
  ui/                   # React components; read the sim, never contain rules
                        # (audio.ts synthesises all cues & rain — no assets)
```

Two rules keep this maintainable:

1. **The engine never imports React.** `RunState` is a plain object mutated by pure functions, which is why the balance harness below can play thousands of simulated minutes in a couple of seconds.
2. **Content is data, not code.** Buildings declare recipes, cornerstones declare effects, orders declare goals. Adding a service building automatically feeds into the blueprint draft logic — nothing has a switch over building ids.

### Determinism

All run randomness is `f(seed, cursor)` with the cursor stored inside `RunState`. A save file therefore resumes to the exact same future, and a seed replays the same map — both covered by tests. Enter any word or number as a seed on the setup screen.

## Testing

`npm test` runs three suites:

- **`engine.test.ts`** — the simulation: RNG determinism, hex geometry, map generation invariants, placement rules, production, season cycling, starvation, glade clearing, orders, win/loss, and a save/load round trip.
- **`playtest.test.ts`** — a **balance harness**. A heuristic bot plays whole runs end to end: it builds a food and wood economy, houses everyone, drafts and staffs service chains, and clears glades. It asserts every run reaches a verdict, that a competent-but-not-great player wins some maps and loses others, and that wins take a real settlement rather than a lucky opening. It prints a per-seed diagnosis, which is the fastest way to see what a balance change did:

  ```
  seed 8080: won · Y3 15min · rep 20 imp 2 · pop 16 · glades 13 · host 46 · human=27/18 ...
  ```

  This harness is what the numbers in `balance.ts` were tuned against, and it caught several real design faults during development — most notably that service buildings were originally locked behind reputation, which required the resolve that services provide.
- **`App.test.tsx`** — UI smoke tests that mount the real app in jsdom and click the path a player takes: menu → setup → blueprint draft → placing a building → switching panels → winning.

## PWA

`vite-plugin-pwa` generates the manifest and a Workbox service worker precaching the whole app shell, so after one load the game runs fully offline — there is no server component. Runs autosave to `localStorage` every 8 seconds, on tab hide, and on page unload; the game pauses itself when the tab is backgrounded rather than fast-forwarding on return.

Icons are generated at build time by `scripts/generate-icons.mjs`, which writes real PNGs using only `node:zlib` — no binary assets in the repo and no image dependencies.

## Known scope limits

- Art is emoji throughout; there are no sprites. Audio is synthesised in WebAudio (season stings, event cues, a rain loop that follows the season) — no recorded assets.
- Meta progression is intentionally small: five Citadel upgrades, no world map campaign.
- ~30 buildings, 25 glade events, and 30+ cornerstones — enough for the loop to have real decisions, a small catalogue for the genre.
- Buildings occupy a single hex; there are no multi-tile footprints or road networks, though hearth warmth and adjacency bonuses make placement matter.
