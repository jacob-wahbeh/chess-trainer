---
description: Research and write plain-English explanations for the costliest drill cards, and add them to the app
argument-hint: "[chess.com username, default draco_jaco] [how many cards, default all]"
---

Write explanations for the opening trainer's drill cards. They are shown in the drill after the user answers,
above the engine lines. Run everything from `web/` in this repo. The player is the Chess.com username `$1`, in
lower case (`draco_jaco` if none was given), called `<user>` below; `$2` is how many cards to write (all of
them if none was given). Explanations are keyed by position and move, not by player, so they're shared: a card
someone else already has an explanation for is skipped.

1. Bring the player's cards up to date, so new games and new mistakes are included:
   - For a new player (no `../data/<user>/archives/`), download their games from the repo root with
     `.venv/bin/python -m trainer --user <user> fetch`, and seed their caches by copying
     `../data/draco_jaco/web-cache.json` and `../data/draco_jaco/wikibooks-cache.json` into `../data/<user>/`
     (evaluations, master games and theory pages are facts about positions, shared by everyone).
   - Otherwise update their games with the same `fetch` command.
   - Then run `npm run cards:export -- <user>` (minutes; it reuses the cached evaluations and theory pages),
     and `npm run masters` to ship the master games it looked up with the app (`static/masters.json`).
2. Run `npm run explain:todo -- <user> $2` and read `../data/<user>/explain-todo.json`: the `principles`
   library and the `cards` to explain. With more than about 40 cards, `npm run explain:split -- <user> 4` deals
   them into four files for subagents to write in parallel (each writes its own answers file and checks it with
   `npm run explain:check -- <user> <file>`).
3. Research each card before writing:
   - Read its `theory` notes: commentary from the Wikibooks *Chess Opening Theory* pages for the position, the
     habit and the taught move. They say what the line is about and often why a move is good or bad.
   - Pick the foundational idea from `principles` that best explains the card (its `id` goes in
     `principleId`).
   - If the notes are missing or thin and a web search tool is available, look up the opening and the move
     (opening name plus moves, e.g. "Two Knights Defence 4...Nxe4 5.Bxf7+") on reputable sources (Wikibooks,
     chess.com or lichess.org articles, ChessBase, well-known opening books' descriptions). Use what they
     explain, never their moves unless the card's lines contain them.
4. Write one explanation per card, following the rules below, and save them all as a single JSON object to
   `../data/<user>/explain-answers.json`:
   `{ "<card id>": { "headline": "...", "why": "...", "principle": "...", "principleId": "...", "themes": ["..."], "sources": ["..."] } }`
5. Run `npm run explain:merge -- <user>` (or `-- <user> <file>` for each subagent's answers). It checks every
   move and piece you mention against the card's lines and theory notes, and that `principleId` exists, then
   adds the explanations that pass to `static/explanations.json`. For each rejected card, fix only what it
   reports and merge again, until nothing is rejected.
6. Report how many cards were explained, quote two of the explanations so the user can judge the style, and
   offer to commit `web/static/explanations.json` and `web/static/masters.json` (the site updates once the user
   pushes).

Rules for each explanation (the reader is a club player who keeps playing `habit.move` here in blitz and rapid):

- Use only the card's data and research. Mention moves exactly as written in `moves`, `habit.refutation`,
  `taught.line`, `threat.line`, `accepted`, `masters` or the `theory` notes, with move numbers (`3...Nf6`).
  Never calculate new variations. Name a piece's square only where it stands in the position (`fen`) or along
  those lines.
- `facts` are verified: lean on them for concrete claims and never contradict them. Don't quote evaluation
  numbers (the app shows its own live evals right above the text, and they differ slightly from the card's):
  describe the consequence in words instead ("gives back the pawn", "lets Black equalise"). Masters
  percentages are fine; win percentages never.
- `headline`: at most 12 words, the one idea to remember.
- `why`: 2–4 sentences. First why the habit fails, concretely (material, threat, tactic, or what it allows),
  then why the taught move is right:
  - `thematic`: the plan or structure it serves in this opening, as the theory describes it;
  - `punish`: what the opponent's last move gave away, and how the taught move exploits it;
  - `offbook` or `engine`: the concrete point of the move.
- `principle`: the chosen foundational principle applied to this position in one sentence, so the user can
  find the move over the board if they forget it. Not a restatement of the move.
- `themes`: 1–3 short tags such as `development`, `centre`, `king safety`, `tactics: fork`.
- `sources`: the Wikibooks page titles (`theory[].page`) and URLs you actually drew on; omit if none.
- Plain, direct sentences. No hedging, no exclamation marks.
- Refer to the opponent by side ("Black castles") or as "the opponent"/"they", never "he", "him" or "his".
- In `why`, name the taught move's follow-up as a numbered sequence ("after 4.Nc3 Bc5 5.f4") when you describe
  one: the drill plays the moves the explanation names on the board, as long as they follow on from the taught
  move and are legal.
