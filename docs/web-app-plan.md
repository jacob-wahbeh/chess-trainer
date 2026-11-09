# Opening trainer web app — plan & design

Status: milestones 1–3 built in `web/` (import, lines, explorer, analysis, costly first mistakes, drills, PWA); milestone 4 built without an API key (computed facts in the app, explanations written in Claude Code sessions, see `web/README.md`). Priorities: **speed** and **elegant UX/UI**.

## 1. What it does

1. Imports your Chess.com games and merges them into one position tree per color, so
   the lines you actually play are sorted by how often you reach them.
2. Walks each line and finds the **first move where you go wrong**: a book deviation,
   inaccuracy, mistake, or blunder.
3. Turns each of those into a drill card (Lotus-style), tracked by streaks: three right in a row and it's known; a miss, or repeating the mistake in a game, starts it over.
4. Explains **why**: the concrete refutation, the principle behind it, and, for lines that
   start the same but need different moves (e.g. Najdorf 6.Be3 vs 6.Bg5), the deciding
   difference, so you can work it out over the board if you forget.

## 2. Research findings that shape the design

All numbers below were measured on 2026-11-08 against `draco_jaco`'s cached games, on an M3 Pro.

**How much work there is.** Your blitz and rapid games from the last 12 months (4,053) contain
2,623 positions reached at least 3 times (1,334 with you to move) in the first 30 plies. All
26,848 games together contain 15,950. That's a small workload.

**Engine: Stockfish is still the right engine.** Nothing else comes close for evaluation.
Leela needs a GPU. Maia predicts human moves rather than judging them; it's a possible later
add-on for "what would a 1500 play here". The native `engine/stockfish` (Stockfish 19,
100 MB) can't run in a browser or on an iPhone, so the web app uses the WebAssembly build:

| Build | Download | Startup | Depth 16 / position | Depth 20 / position |
|---|---|---|---|---|
| Native Stockfish 19, 1 thread | n/a | 730 ms | 211 ms | 924 ms |
| **Stockfish 19 lite, single-threaded, WebAssembly** (`stockfish.js` v19.0.1) | **1.8 MB** | **~100 ms** | **230 ms** | 1,224 ms |
| Stockfish 19 full, WebAssembly | 99 MB | slow | — | — |

*Agreement with deep evaluations.* Both builds were run at depth 16 on 40 of your positions and
compared with Lichess's cached evaluations, which have a median depth of 34:
- Typical eval gap: 0.7 win-percentage points for lite vs 0.8 for native.
- Gaps of 5 points or more (enough to flip a move's label): 2/40 for both builds.
- Same best move as Lichess: 32/40 for lite vs 34/40 for native.

So the small build labels moves as well as the native one, and the 99 MB build isn't worth
the download.

**Lichess's cached evaluations (cloud-eval) cover your openings.** 60 of 60 sampled positions
(spread from your most to least common) were already cached, at depth 20–75 with a median of
33. The endpoint is free, needs no token, and allows browser requests. It's deeper than
anything you'd compute locally, and costs no CPU.

**APIs reachable straight from a browser** (checked: all allow cross-origin requests from any site):
- The Chess.com public API.
- Lichess game export.
- Lichess cloud-eval.

The Lichess opening explorer, both the masters and Lichess-games databases, now returns
**401 without a token**. A free personal token or a Lichess login (OAuth, no app
registration needed) unlocks it. This is why Chessreps runs its own copy.

**Data size.** Your full history is 85 MB of JSON; the last 12 months is 14 MB. Default
imports to the last 12 months and load older games on request.

## 3. Architecture

```
┌──────────────────── Browser (PWA: desktop + iPhone home screen) ─────────────────────┐
│  UI thread (Svelte 5)          ← only renders; never parses games or runs the engine │
│     │  Comlink RPC                                                                   │
│  Data worker        import → parse (chessops) → position tree → classify → cards     │
│     │                                                                                │
│  Eval scheduler ── 1. IndexedDB cache ─ 2. Lichess cloud-eval (one request at a time)│
│                └── 3. Stockfish 19 lite worker pool (N = cores − 1; 2 on iPhone)     │
│  IndexedDB (Dexie): games · positions · evals · streak cards · explanations          │
│  Service worker: app shell + engine .wasm cached → instant, offline                  │
└──────────────────────────────────────────────────────────────────────────────────────┘
          │ (only for explanations + sync)
┌─────────▼──────────────┐
│ Cloudflare Worker      │  holds the Claude API key · POST /explain · progress sync (D1/KV)
└────────────────────────┘
```

Why this layout is fast:
- The UI thread does nothing heavy.
- Every evaluation is computed once and cached forever, since a position's eval never changes.
- Later syncs only process new games.
- Cloud-eval and the local engine pool work the priority queue from opposite ends, so the most
  common lines are analyzed first and the long tail fills in behind them.

Rough estimate for full local analysis of 2,623 positions on the M3 Pro: 2,623 × 0.23 s ÷ 8
workers ≈ 75 s. This is extrapolated from per-position timings, not measured end to end, and
the cloud cache removes most of the work anyway. iPhone speed has not been measured yet
(see milestone 0).

## 4. Analysis pipeline

**Import.** Fetch Chess.com monthly archives one at a time (the API asks for serial
requests). Past months never change, so download them once; re-fetch only the current
month. Store per game:
- id, date, time class, your color, result, opponent rating;
- the first 30 plies as compact moves.

The full PGN is never needed; the game links back to chess.com.

**Position tree.** Key each position by its board state without move counters, so
transpositions merge. Each node stores:
- how many of your games reached it, and your results there;
- your moves, the opponent's replies, and the date it was last seen.

Filters (time class, period, color) just recount, so they're fast and run in the worker.

**Evaluate.** The target set is nodes reached at least k times (default 3), plus the
positions right after your moves. Ask cloud-eval for 3 candidate lines; if your move is one
of them, its eval comes for free. Otherwise use the next position's eval, falling back to
local Stockfish at depth 18.

**Theory check (needs a Lichess login).** A move is **book if masters play it in at least 1% of
games at a position that has at least 20 master games.** Opening names come from
`lichess-org/chess-openings` (CC0, bundled, works offline).

*Calibration, measured 2026-11-08 on 20,625 of your moves in 1,348 common positions.* How
often each group gets engine-flagged (loses at least 5 win%):

| How often masters play your move | Engine-flagged |
|---|---|
| ≥10% | 1% |
| 3–10% | 7% |
| 1–3% | 9% |
| under 1% | 23% |
| never | 68% |

So 1% is where "rare" starts to mean "bad". Any higher threshold mostly flags moves the engine
considers fine: at a 3% cutoff, 74% of off-book flags are engine-fine.

**Repertoire choices.** Some moves are off-book but deliberate, like your Smith-Morra (2.d4,
294 games) or the Scandinavian. A move counts as a repertoire choice when:
- it's off-book,
- the engine rates it playable (loses less than 5 win%), and
- you play it at least 70% of the times you reach that position.

These are not drilled as mistakes. The app suggests "this is my repertoire", and theory checks
continue inside that system. Your games contain 25 such positions (634 moves).

Offbeat systems have little master coverage: 18% of your moves are in positions with fewer
than 20 master games. There, fall back to the Lichess-games explorer filtered to 2200+ ratings,
or let the engine decide alone.

**Explorer rate limit.** The explorer allows about **30 lookups a minute** and returns
"rate limited" (HTTP 429) beyond that.
- A first lookup of the 1,348-position tree took ~45 minutes, even with skipping deeper
  positions of lines that already left theory (331 skipped).
- So lookups run as a background job, most common positions first, cached forever and synced
  between devices. The app stays usable meanwhile.
- The engine side is fast by comparison: native Stockfish evaluated all 3,782 positions in
  93 s on 11 cores.

**Label your moves.** These are the same formulas as `trainer/engine.py`, taken from Lichess:
win% = 50 + 50·(2/(1+e^(−0.00368208·cp)) − 1), measured from your side.

| Label | Rule |
|---|---|
| Book | In the masters DB and the engine is OK with it |
| Off-theory | Not book, but loses less than 5 win% |
| Inaccuracy / Mistake / Blunder | Loses at least 5 / 10 / 15 win% |

**Cards.** A card is created at a position where it's your move and you've played a
non-book or losing move.
- **Accepted answers:** every move that is book (or one of the engine's top moves) and
  within ~2 win% of the best. Your repertoire move is shown first.
- **First mistake first:** cards deeper in a line stay locked until the earlier card on the
  same path has graduated, because the first deviation is the one that matters.
- **Priority ("leak"):** the sum over your bad moves of times played × win% lost. Shown as
  "this spot has cost you ≈ 4.2 points over 38 games". This ranking puts the most expensive
  habits on top.
- **Habits vs one-offs:** keep **habits** (played 5+ times) apart from **one-off blunders**
  (fewer than 5 times, big loss). In the 2026-11-08 sample, 3-game tactical blunders in deep
  Fried Liver and Paris Defense lines ranked next to 20+-game habits.
- **Where cards come from:** in 35% of your games (1,422 of 4,053), the first departure
  happens inside your common lines, at a median of move 4 (middle half: moves 3–6). So the top
  cards are shallow, frequent positions where drilling pays off quickly.

**Compare cards (the Najdorf requirement).**
1. Find candidate pairs (A, B): same opening family, a shared move prefix of at least ~6
   plies or only a few pieces different, and no accepted answer in common.
2. Cross-test: play A's answer in B (and B's in A). If it loses at least 5 win%, keep the
   engine's refutation. That refutation *is* the deciding difference.
3. Example: against 6.Be2 or 6.Be3, ...e5 is fine. Against 6.Bg5, ...e5?! allows Bxf6, which
   removes the knight guarding d5, and then Nd5. Rule: "...e5 only when White can't
   quickly take over d5."

**Pawn-structure groups.** Hash the pawn positions only, so positions that share a structure
share their principles. That's how strong players reason: plans follow from the structure.

## 5. Explanations ("why")

Explanations are generated once per (position, move) and cached forever: in IndexedDB on the
device and in Worker KV so other devices reuse them.

- **Input to the model:**
  - the position and the moves leading to it, plus the opening name;
  - the engine's best line and its refutation of your move, as evals plus moves;
  - the opponent's threat, found by letting them move twice;
  - pawn-structure tags;
  - for compare cards, the cross-test results.
- **Output (structured JSON):** `headline` (12 words or fewer), `why` (2–4 sentences),
  `principle` (one reusable rule), `refutation` (the punishing line in words), `themes[]`.
- **Guardrail:** AI models are bad at calculating chess themselves, so the model only narrates
  engine-checked facts. Every move it mentions is checked against the lines it was given;
  if any check fails, regenerate.
- **Model and cost:** Anthropic's default recommendation is `claude-opus-5-5` ($4 / $20 per
  1M input/output tokens).
  - At ~2K input and ~400 output tokens plus some thinking, that's roughly $0.02–0.03 per
    explanation, or a few dollars for a few hundred cards.
  - Pre-generating in bulk through the Message Batches API halves that.
  - `claude-sonnet-5-5` (half price) and `claude-haiku-5-5` (much cheaper) are options. Try
    about 20 cards on each before choosing.
- **The key never ships in the app.** A tiny Cloudflare Worker (free tier) holds it as a
  secret and exposes `/explain`, protected by a private app token you paste into Settings
  once.

## 6. UX/UI design

Principles:
- The board is the hero.
- One primary action per screen.
- Only show numbers that change what you do next.
- Motion explains things: moves animate and the refutation is drawn with arrows.
- Interactions respond instantly.

**Screens**

1. **Today:** one big button, "12 to review · ~4 min". Below it, the top 3 leaks with board
   thumbnails, and a small streak indicator. Opening the app to drilling takes one tap.
2. **Lines (the core idea):** a White | Black toggle, then your lines sorted by games played.
   Each row shows the opening name, a thin frequency bar, your score, and a leak badge
   ("goes wrong at move 7"). Tapping a line opens the **line explorer**:
   - the board beside a collapsible move tree;
   - each move shows how often you play it, your score, and a colored dot for its label;
   - filter chips for time control and period.

   This also fixes the top complaints about both apps: no overview of learned lines, and no
   browsable list of sub-variations.
3. **Drill:**
   - The moves leading to the position auto-play quickly (~120 ms each, tap to skip), which
     fixes a top Lotus complaint. Then you move.
   - *Correct:* a soft highlight plus a one-line idea, then auto-advance.
   - *Wrong:* your move stays on the board, the engine's punishing reply animates with an
     arrow, and a bottom sheet slides up with the headline, the principle, and an optional
     "more".
   - Grading is automatic, so there are no rating buttons: wrong = Again, right on retry =
     Hard, right = Good, fast and right = Easy.
4. **Compare:** two boards (stacked on phone, side by side on desktop) with the differing
   squares outlined, and the rule in one sentence. "Test me" mixes both positions together,
   because drilling similar positions side by side builds the ability to tell them apart.
5. **Principles:** for each opening, its rules, each linked to the cards that teach it.
6. **Settings:** Chess.com username, Lichess connection, game filters, minimum times reached,
   engine depth, sync.

**Visual language**
- Dark-first, with an equally polished light mode. Neutral grays and one accent color.
- Label colors follow chess convention but muted: inaccuracy amber, mistake orange,
  blunder red, book a quiet blue.
- The system font stack (SF Pro on Apple), so no web font has to download. Tabular numbers
  for stats.
- Motion is 150–200 ms, transform/opacity only (stays at 60fps), and respects
  reduced-motion settings.

**Platform details**
- *iPhone:*
  - controls sit at the bottom within thumb reach; safe-area insets are respected;
  - the board doesn't scroll or zoom when touched; there's no double-tap zoom;
  - full-screen standalone mode; Web Push reminders when drills are due (iOS 16.4+).
- *Desktop:*
  - board on the left, panel on the right;
  - keyboard: ←/→ step through moves, space = next, F = flip board, 1–4 = override the
    automatic grade.

## 7. Performance budget

| What | Target |
|---|---|
| App shell download | ≤ ~100 KB gzipped JS. Engine `.wasm` is lazy-loaded only when analysis runs |
| Repeat launch → interactive | Instant: service worker shell plus a precomputed "Today" snapshot in IndexedDB |
| Drill transitions | 60fps; the next card is preloaded while you're on the current one |
| First import (12 months) | Lines screen usable as soon as the first months are parsed; evals stream in, most common first |
| Later syncs | Only new games and new positions |

## 8. Stack (versions checked 2026-11-08)

| Piece | Choice | License |
|---|---|---|
| App | SvelteKit 2 + Svelte 5, static adapter (SPA), Kit's built-in service worker. Kit 3 needs Node ≥ 22.17 and this Mac has 22.14; switch after a Node upgrade | MIT |
| Board | `chessground` 9 (the Lichess board: fast, smooth, touch-friendly) | GPL-3.0 |
| Rules / PGN / FEN | `chessops` 0.15 | GPL-3.0 |
| Engine | Stockfish 19 lite, single-threaded (`stockfish.js` v19.0.1) | GPL-3.0 |
| Storage | `dexie` 4 (IndexedDB) | Apache-2.0 |
| Opening names | `lichess-org/chess-openings` | CC0 |
| Hosting | Cloudflare Pages (static) + one Cloudflare Worker (explanations + sync) | free tiers |

Several pieces are GPL-3.0. That doesn't matter for personal use, but if the app is ever
published, publish its source under the GPL too.

The multi-threaded engine is a later option for one deep "analysis board" evaluation. It
needs two extra security headers (COOP/COEP) on the host. For batches, a pool of
single-threaded engines is faster and needs no headers.

## 9. The existing Python code

`trainer/` already fetches Chess.com archives (one month at a time, cached, backs off when
rate-limited) and labels moves with the same Lichess formulas. Keep it as the **reference
implementation**: run both on the same games and diff the labels to test the TypeScript
port. The native Stockfish binary isn't part of the web app.

## 10. Milestones

0. **Spike (~1 day).** On a real iPhone, measure:
   - the WebAssembly engine's speed with 2 workers;
   - parsing 12 months of games in a worker;
   - how the chessground board feels on the phone.
1. **Import + position tree + Lines explorer.** Useful on its own, even without the engine.
2. **Evals + labels + leak ranking.**
3. **Drills + spaced repetition + installable/offline PWA.**
4. **Explanations** (Worker proxy, caching, guardrail).
5. **Compare cards + principles.**
6. **Sync between devices.**

## 11. Open decisions

- ~~Connect Lichess for the masters "book" check?~~ **Decided: yes.** Account `draco_jaco`
  was created 2026-11-08. The explorer lives at `explorer.lichess.org` and accepts any valid
  token; the API spec lists no required scopes. The app will use "Log in with Lichess"
  (OAuth); a personal token in `.env` is only for testing until then.
- **Default game set:** blitz + rapid from the last 12 months? (15K of your games are bullet.)
- **Explanation model:** Opus 5.5 (default) vs Sonnet 5.5 / Haiku 5.5 for cost.
- **Sync:** Cloudflare D1/KV via the Worker, vs manual export/import.
