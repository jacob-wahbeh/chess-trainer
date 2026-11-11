# Opening-idea explanations: what the pilot taught us

The pilot (Nov 2026) rewrote three drill cards with web research on the openings, the moves club players actually
play, and adversarial checks. Its full output is in `docs/pilot-whys.md` (long form) and
`data/draco_jaco/pilot-results.json`; the compressed versions shipped in `web/static/explanations.json`.
This page is the playbook for running it over every card.

## The explanation, compressed (what the app shows)

Per card (`${position key}|${habit uci}` in `explanations.json`), on top of the existing fields:

| Field | Length | Shown |
|---|---|---|
| `ideas` | 3–4 × {title (2–5 words), side you/opponent/both, text ≤ 25 words} | once the answer is shown |
| `ideas[].arrows` / `ideas[].squares` | 1–3 shapes per idea: arrows "e2e4", squares "f7" | drawn on the drill position while the idea is open |
| `habit.why` | 2 sentences: the concrete reason (material, tactic, what it allows) with moves from its refutation | on the habit's line |
| `habit.strays` | {idea title, ≤ 15 words} | on the habit's line |
| `taught.why` | 2 sentences, concrete, with moves from its line | on the taught line, once shown |
| `taught.enforces` | {idea title, ≤ 15 words} | on the taught line, once shown |
| `alternatives` | per common move {uci, label, before, after, idea}; before/after ≤ 2 sentences each | before: as soon as it's played (must not name or hint at the taught move); after: once the taught move is found or shown |
| `why` | habit.why + taught.why, kept for the checker and older code | — |

The long pilot texts were 600–900 words per card: far too long for a phone. Compress hard; drop meta talk ("the
app accepts…", "the engine's label only means…") and evaluation numbers.

### Drawing an idea

The shapes go on the drill position (before the move), in the idea's side colour. What worked for the pilot:
- arrows for the move or plan that carries the idea out (b1c3 for "Keep c3 for your knight", d7d5 for a break);
- squares for the target or the key square (e4, f7, c3), or the pieces it's about (b1, c1 for development);
- an arrow can show a move that isn't legal yet when the idea is about that (the pinned c3xd4 in the Evans);
- no shapes for moves that the idea text doesn't mention; at most 3 per idea.

Check every arrow starts on the right piece with python-chess; `checkExplanation` checks the format and that
every `strays` / `enforces` / alternative `idea` names an existing title.

## Lean pipeline (since 2026-11-10)

Per opening family, across every player (cards shared by players count once):
1. `npx vite-node scripts/alternatives.ts <user> family:<Family>` (or `1000` for every card): club and master
   alternatives, cards in parallel on all engines, merged into `data/<user>/alternatives.json`.
2. `npx vite-node scripts/ideas.ts prep <Family>` -> `data/ideas/<slug>/input.json` with writer batches (≤ 12 cards,
   whole variations together).
3. The `opening-ideas` workflow (`.claude/workflows/opening-ideas.js`, args `{ family, slug, batches }`): one
   researcher for the family's ideas (≥ 3 individual sources), one researcher per batch for the exact lines, one
   writer per batch who runs `ideas.ts check` on its drafts until they pass, one spot-checker for ~10 claims.
4. Review a few cards, then `npx vite-node scripts/ideas.ts merge <Family> data/ideas/<slug>/drafts-<n>.json`.

`ideas.ts check` runs `checkExplanation` with the alternatives (moves in every text, `before` leaks, labels, every
alternative covered, lengths, arrows on pieces), opens every source URL, and prints link advice for unnumbered
piece moves.

## Pipeline (the pilot's)

1. **Club and master alternatives** — `npx vite-node scripts/alternatives.ts <user> <ids | top N>` →
   `data/<user>/alternatives.json`. Lichess *amateur* explorer (`explorer.lichess.org/lichess`, ratings
   1000–1800, blitz+rapid; needs the `.env` token, cached in `amateur-cache.json`) for moves with ≥ 5 % of club
   games (max 4), plus master moves ≥ 5 %; minus habit and taught. Stockfish depth 20 grades each the way the
   drill judges: `sound` if ≤ 3 win% lost, or a ≥ 10 % master move short of an inaccuracy; else `slightly worse`
   (3–5), `inaccuracy`, `mistake`, `blunder`. Fast (a few seconds per card).
2. **Research, once per opening variation** (139 across the three players; 37 families), not per card — cards
   in the same variation share it. Two lenses worked well: *ideas* (3–6 strategic ideas for both sides, typical
   club mistakes) and *this line* (what sources say about the habit, the taught move and each alternative, incl.
   transpositions).
3. **Write** per card from: card data (lines, facts, theory), alternatives, research, `principles.ts`.
4. **Check** — one combined adversarial checker per card was enough: python-chess + Stockfish
   (`.venv/bin/python`, `engine/stockfish`) for legality and board claims, leaks in `before` texts, and ideas
   backed by the research.
5. **Fix**, then merge.

## What the checkers caught (so writers can avoid it)

- Overgeneralising an idea beyond the lines where it holds (Kennedy: "Black frees the game with ...d5" — true
  only against slow set-ups; in the 3.d5 structure Black breaks with ...f5).
- Overreach past the sources ("main line" for a move the source didn't call that; inventing a GM's reason).
- Wrong piece named in a development claim (c1-bishop vs a1-rook).
- A `before` text that hinted at the taught move.
- Board claims were otherwise solid: replaying every line with python-chess found no illegal moves.

## Sources that worked

Wikibooks Chess Opening Theory pages (cite BCO/MCO/NCO), Wikipedia opening articles, Google Books previews of
opening books (Watson, Davies, Lakdawala, Emms), publisher PDF excerpts (New in Chess, Quality Chess: Sveshnikov,
Marin), ChessBase reviews, chess.com articles by GMs, Chessable/course pages. Books are rarely readable in full:
cite the page that was actually opened. Forum answers are low credibility. Paraphrase; never copy beyond a phrase.
Search: `mcp__meta_websearch__external_web_search3pai` (the built-in WebSearch is disabled) + `WebFetch`.

## Cost and speed

Pilot: 3 cards, 15 agents, ~1.4M tokens, ~42 min. The six researchers were most of it (30–66 page reads each);
the sourcing checker that re-opened every URL was the slowest stage and was replaced mid-run by one quick
combined checker (time-boxed, depth ≤ 16, no browsing) without losing anything that mattered.

For the full run:
- One researcher per variation with both lenses in one brief, capped at ~25 page reads; research families once
  and variations as deltas.
- Batch several cards of the same variation into one writer.
- Keep the quick combined checker; spot-check sources on a sample instead of every URL.
- Run variations in parallel (pipeline, no barriers); expect ~1,000 agents and tens of millions of tokens for
  all 405 cards — run it per player or per family so each batch can be reviewed.

## Gotchas

- App card ids are `user|color|key|habit` (`?card=` links), export ids are `key|habit`.
- `principles.ts` has 23 principles; parse it properly (a naive regex found 16).
- Castling is `e1h1` / `e8h8` in the app's UCI (chessops), not `e1g1`.
- Each localhost port has its own storage: a new port needs a fresh import.

## Status and next steps (2026-11-10)

**Shipped:** the compressed format for three draco_jaco cards (Kennedy 3.c3, Alapin 2...d6, Evans 7.Ng5), shown
in the drill: main ideas, "Strays from" / "Carries out" tags, and before/after whys for other common moves. The
three cards' ideas have arrows and squares (2026-11-10).

**Next (content):**
1. Extend `checkExplanation` (`web/src/lib/explain/check.ts`) further — moves in `alternatives` texts against
   `alternatives.json` lines, `before` texts never naming the taught move (idea shapes and titles are checked).
2. Run the pipeline in batches (per player or opening family), lean setup above; confirm scope first.
3. Add to the research output a family-level ideas file (for an Openings page); have the writer add arrows and
   squares per idea (see "Drawing an idea").

**Built in the phone Why sheet (2026-11-10, see docs/mobile-ux/fix-plan.md, batch W):**
- an Ideas tab (chip);
- the line's idea as a pill;
- coloured side dots;
- "Sources (n)";
- moves in any text linked to the board;
- the step note hidden on move 1 when written text covers it;
- ideas collapsed to titles, with the related one open.

**Content hooks the UI already reads:**
- `ideas[].arrows` ("e2e4") and `ideas[].squares` ("f7") draw an open idea on the drill position;
- `themes` shows as tags in the Ideas view;
- new opening-level sections belong in that view, not under each line.

**UI ideas from reviewing the pilot on a phone** (the original list; see above for what's built):
1. Tabs in the Why sheet — [This move] [Opening ideas] — instead of appending the ideas under every line.
2. The line's idea as a pill above its text (✓ Make the knight pay / ✗ Strays from: …) instead of a trailing
   sentence that repeats the paragraph; tapping it opens that idea.
3. Ideas drawn on the board: tapping an idea highlights its squares and arrows (needs content item 3).
4. Ideas expanded the first time an opening is seen, collapsed to title chips after that.
5. Coloured dots (you / opponent / both) instead of the You/Both/Black pills.
6. One consistent header: the card headline pinned for every line, or a one-line headline per alternative.
7. An Openings page (under Lines): each opening's ideas, your cards in it, and how often you stray from each.
8. Polish: hide the computed step note on move 1 when written text covers it; clearer "Engine line" toggle;
   sources behind a "Sources (n)" tap instead of a truncated footer.
