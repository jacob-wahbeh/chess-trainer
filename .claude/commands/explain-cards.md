---
description: Research and write plain-English explanations for the costliest drill cards, and add them to the app
argument-hint: "[how many cards, default 20]"
---

Write explanations for the opening trainer's drill cards. They are shown in the drill after the user answers,
above the engine lines. Run everything from `web/` in this repo; the user is `draco_jaco`.

1. If `../data/draco_jaco/cards.json` is missing or more than a week old, run `npm run cards:export` (a few
   minutes; it reuses cached evaluations and theory pages).
2. Run `npm run explain:todo -- draco_jaco $ARGUMENTS` and read `../data/draco_jaco/explain-todo.json`: the
   `principles` library and the `cards` to explain.
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
   `../data/draco_jaco/explain-answers.json`:
   `{ "<card id>": { "headline": "...", "why": "...", "principle": "...", "principleId": "...", "themes": ["..."], "sources": ["..."] } }`
5. Run `npm run explain:merge`. It checks every move and piece you mention against the card's lines and theory
   notes, and that `principleId` exists, then adds the explanations that pass to `static/explanations.json`.
   For each rejected card, fix only what it reports and merge again, until nothing is rejected.
6. Report how many cards were explained, and quote two of the explanations so the user can judge the style.

Rules for each explanation (the reader is a club player who keeps playing `habit.move` here in blitz and rapid):

- Use only the card's data and research. Mention moves exactly as written in `moves`, `habit.refutation`,
  `taught.line`, `threat.line`, `accepted`, `masters` or the `theory` notes, with move numbers (`3...Nf6`).
  Never calculate new variations. Name a piece's square only where it stands in the position (`fen`) or along
  those lines.
- `facts` are verified: lean on them for concrete claims and never contradict them. When you give an
  evaluation, use the card's eval strings (`eval`, `habit.evalAfter`, `taught.evalAfter`), which read like an
  eval bar from White's side (+0.45, −1.21); never win percentages.
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
