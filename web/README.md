# Openings — web app

Personal opening trainer: imports your Chess.com games, sorts the lines you play by how often you
reach them, and (next milestones) drills the first move where you leave theory. Plan and research:
[`../docs/web-app-plan.md`](../docs/web-app-plan.md).

SvelteKit 2 + Svelte 5 (static SPA), chessground/chessops, Dexie (IndexedDB), Stockfish 19 lite (WebAssembly).
Everything runs in the browser; games are stored only on the device.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm run dev:lan    # also reachable from your phone at http://<this-mac's-ip>:5173
npm test           # unit tests
npm run check      # type check
npm run build      # static site in build/
```

`static/openings.json` (from lichess-org/chess-openings, CC0) and `static/engine/` (Stockfish, GPL-3.0)
are committed; regenerate with `npm run openings` / `npm run engine`.

`npx vite-node scripts/compare-python.ts` runs the import + tree code over the Python CLI's cached
archives (`../data/<user>/archives`) and prints counts comparable to the Python research.

## Layout

- `src/lib/chess/` — position keys (Zobrist), PGN parsing, move/SAN helpers
- `src/lib/games/` — Chess.com import, game model, IndexedDB schema
- `src/lib/tree/` — position tree and opening-name grouping
- `src/lib/analysis/` — move judgement (win%, book, repertoire), costly first mistakes, and the background
  analysis job (Lichess cloud evals + local Stockfish + masters lookups)
- `src/lib/lichess/` — "Log in with Lichess" (OAuth PKCE)
- `src/lib/worker/` — data worker (owns games, storage, trees and analysis) and its client
- `src/lib/engine/` — Stockfish worker pool and UCI parsing
- `src/routes/` — Today, Lines, Explore, Mistakes (`/leaks`), Settings, Bench, Lichess login callback

`npx vite-node scripts/analyze-node.ts [user] [since] [masters-cache-dir]` runs the full analysis job in Node with
native Stockfish (`../engine/stockfish`) and live Lichess cloud evals (set `LICHESS_TOKEN` for masters lookups).
