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

`static/openings.json` (from lichess-org/chess-openings, CC0), `static/engine/` (Stockfish, GPL-3.0) and
`static/icons/` are committed; regenerate with `npm run openings` / `npm run engine` / `node scripts/build-icons.mjs`.

The service worker (`src/service-worker.ts`) is only registered in production builds (`npm run build && npm run preview`),
and browsers only allow it on https:// or localhost.

`npx vite-node scripts/compare-python.ts` runs the import + tree code over the Python CLI's cached
archives (`../data/<user>/archives`) and prints counts comparable to the Python research.

## Layout

- `src/lib/chess/` — position keys (Zobrist), PGN parsing, move/SAN helpers
- `src/lib/games/` — Chess.com import, game model, IndexedDB schema
- `src/lib/tree/` — position tree and opening-name grouping
- `src/lib/analysis/` — move judgement (win%, book, repertoire), costly first mistakes, and the background
  analysis job (Lichess cloud evals + local Stockfish + masters lookups)
- `src/lib/lichess/` — "Log in with Lichess" (OAuth PKCE)
- `src/lib/drill/` — drill cards: FSRS scheduling, sessions, accepted answers, thematic answers, auto-grading
- `src/lib/explain/` — checked facts for every card (material, threats, forks, principles) and the guardrail
  for written explanations
- `src/lib/worker/` — data worker (owns games, storage, trees, analysis and cards) and its client
- `src/lib/engine/` — Stockfish worker pool and UCI parsing
- `src/routes/` — Today, Drill, Lines, Explore, Mistakes (`/leaks`), Settings, Bench, Lichess login callback

`npx vite-node scripts/analyze-node.ts [user] [since] [masters-cache-dir]` runs the full analysis job in Node with
native Stockfish (`../engine/stockfish`) and live Lichess cloud evals (`LICHESS_TOKEN` from the env or `../.env`
enables masters lookups). Evaluations are cached in `../data/<user>/web-cache.json`, so reruns only analyse
what's new.

## Explanations

Every drill card shows facts computed in the app from the engine lines (what the habit loses and how, the
opponent's threat, what the taught move does). The costliest cards also get a written explanation (headline,
why, principle), written ahead of time in a Claude Code session and shipped in `static/explanations.json`:

1. `npm run cards:export` writes every card with its engine lines and facts to `../data/<user>/cards.json`.
2. `/explain-cards [count]` in Claude Code (`../.claude/commands/explain-cards.md`) writes explanations for the
   costliest unexplained cards, using `npm run explain:todo` and `npm run explain:merge`.
3. `explain:merge` only accepts an explanation if every move it mentions occurs at that move number in the
   card's lines and every "piece on square" exists; anything else is reported back to be rewritten.

Redeploy afterwards so the app picks up the new file. Note that the file is public on the hosted site.
