export const meta = {
  name: 'opening-ideas',
  description: 'Research one opening family on the web and write checked opening-idea explanations for its drill cards',
  whenToUse: 'After `npx vite-node scripts/ideas.ts prep <family>` (in web/); args: { family, slug, batches } from data/ideas/<slug>/input.json',
  phases: [
    { title: 'Research', detail: 'one researcher for the family ideas, one per writer batch for these exact lines' },
    { title: 'Write', detail: 'one writer per batch, self-checked with scripts/ideas.ts check' },
    { title: 'Spot-check', detail: 'one agent checks a sample of claims against their sources' },
  ],
}

// args: { family: 'Scandinavian', slug: 'scandinavian', batches: [{ name, ids: [card ids] }] }
const { family, slug, batches } = args
const REPO = '/Users/jwahbeh/chess-trainer'
const DIR = `${REPO}/data/ideas/${slug}`
const INPUT = `${DIR}/input.json`
const PY = `${REPO}/.venv/bin/python`
const STOCKFISH = `${REPO}/engine/stockfish`
const PLAYBOOK = `${REPO}/docs/opening-ideas-pipeline.md`

const CONTEXT = `Context: an opening trainer drills club players (rated 1000-1800) on positions from their own games. Each card is one position where the player habitually plays a worse move (the "habit") and the app teaches a better one (the "taught" move). The ${family} family's cards are in ${INPUT} (JSON). Its "cards" array has, per card: card (id, color = the player's side, opening, moves, fen, habit with its refutation line, taught with its line and reason, accepted moves, masters move shares, threat, facts = machine-checked statements, theory = Wikibooks commentary), players, alternatives (other moves club players or masters commonly play there, graded by Stockfish: label sound / slightly worse / inaccuracy / mistake / blunder, with its line), and current (what the app shows today). "variations" groups card ids by variation and "batches" lists the writer batches. Use node or python to read only the cards you need.`

const SEARCH = `Search with mcp__meta_websearch__external_web_search3pai (load it with ToolSearch "select:mcp__meta_websearch__external_web_search3pai"; the built-in WebSearch is disabled) and read pages with WebFetch (ToolSearch "select:WebFetch"). Sources that worked before: Google Books previews of opening books (Watson, Davies, Lakdawala, Emms and others), publisher excerpts (New in Chess, Quality Chess, Everyman PDFs), articles and lessons by titled players (chess.com, lichess, ChessBase, New in Chess), Chessable course pages, ChessBase reviews. Wikibooks and Wikipedia are fine as background but don't count as individual sources. Forum answers are low credibility. Cite only pages you actually opened, with what they are (e.g. "chess.com article by GM X", "Google Books preview of Y by Z, p. 41"). Paraphrase; never copy more than a short phrase. Read at most about 25 pages; stop when the ideas are covered.`

const SOURCE = { type: 'object', properties: {
  url: { type: 'string' }, title: { type: 'string' },
  what: { type: 'string', description: 'who wrote it / what it is, e.g. "Google Books preview of Davies, Play the Scandinavian, p. 12"' },
  credibility: { type: 'string', enum: ['high', 'medium', 'low'] },
}, required: ['url', 'title', 'what', 'credibility'] }

const IDEAS_SCHEMA = { type: 'object', properties: {
  ideas: { type: 'array', items: { type: 'object', properties: {
    title: { type: 'string', description: '2-5 words' },
    side: { type: 'string', enum: ['white', 'black', 'both'] },
    explanation: { type: 'string', description: '1-3 sentences in your own words' },
    where: { type: 'string', description: 'which variations or structures it applies to (ideas often hold only in some lines)' },
    squares: { type: 'string', description: 'key squares, pieces or pawn moves, for drawing it on a board' },
    sources: { type: 'array', items: { type: 'string' }, description: 'URLs that state it' },
  }, required: ['title', 'side', 'explanation', 'where', 'squares', 'sources'] } },
  clubMistakes: { type: 'array', items: { type: 'string' }, description: 'typical club-level mistakes in this family, with sources' },
  sources: { type: 'array', items: SOURCE },
  gaps: { type: 'string' },
}, required: ['ideas', 'clubMistakes', 'sources', 'gaps'] }

const LINES_SCHEMA = { type: 'object', properties: {
  moveNotes: { type: 'array', items: { type: 'object', properties: {
    card: { type: 'string', description: 'card id' },
    move: { type: 'string', description: 'SAN with number, e.g. "4.d4" or "5...Bf5"' },
    note: { type: 'string', description: 'what sources say about this move in this position: purpose, what it allows, why strong players do or do not play it, transpositions. "no source found" if none.' },
    sources: { type: 'array', items: { type: 'string' } },
  }, required: ['card', 'move', 'note', 'sources'] } },
  sources: { type: 'array', items: SOURCE },
  gaps: { type: 'string' },
}, required: ['moveNotes', 'sources', 'gaps'] }

const ideasPrompt = `${CONTEXT}

You are a chess opening researcher for the ${family} family as a whole (all its cards and variations; skim "variations" and the cards' moves first so you know which lines matter). Find the 4-8 main strategic ideas for BOTH sides across these lines: pawn structures, central control, piece placement, typical plans and targets, and the typical mistakes club players make. Say where each idea applies: the pilot's checker caught an idea stated for the whole opening that was only true in some lines.

${SEARCH} Find at least 3 individual sources (books, titled players' articles or courses).

Also save your result as JSON to ${DIR}/research-ideas.json. Return the structured result.`

const linesPrompt = (b, i) => `${CONTEXT}

You are a chess opening researcher for writer batch ${i + 1} (${b.name}): cards ${b.ids.join(', ')}. For each card, find what sources say about these moves in its exact position: the habit, the taught move, and every move in its "alternatives". Search for the exact move sequences and the variation names. Note transpositions. Cards in the same variation share most of their sources, so research each variation once.

${SEARCH}

Also save your result as JSON to ${DIR}/research-lines-${i + 1}.json. Return the structured result.`

const WRITE_RESULT = { type: 'object', properties: {
  file: { type: 'string' },
  passed: { type: 'number' }, failed: { type: 'number' },
  unresolved: { type: 'string', description: 'cards still failing and why; claims you dropped for lack of a source' },
}, required: ['file', 'passed', 'failed', 'unresolved'] }

const writePrompt = (b, i, ideas, lines) => `${CONTEXT}

You write the app's explanations for writer batch ${i + 1} (${b.name}): cards ${b.ids.join(', ')}.

Research on the family's ideas (JSON): ${JSON.stringify(ideas)}
Research on these lines (JSON): ${JSON.stringify(lines)}

Read ${PLAYBOOK} first: the "explanation, compressed" table and "Drawing an idea" are the format, "What the checkers caught" lists mistakes to avoid. web/static/explanations.json has three finished examples: 4886445385944472|c2c3, 6104332673881535|d7d6, 15856967415293|f3g5.

For every card write one JSON entry keyed by card id:
{ headline (at most 12 words), why (habit.why + " " + taught.why), principle (one sentence: the principle applied here), principleId (an id from web/src/lib/explain/principles.ts), themes (optional, 1-3 short tags), sources ("Title | URL" strings, only sources you used for this card, individual sources first), ideas: 3-4 x { title, side: "you" | "opponent" | "both" (from the player's side: card.color), text (at most 25 words), arrows (["e2e4"]), squares (["f7"]) }, habit: { why (2 sentences, concrete: what it loses or allows, with moves from its refutation), strays: { idea (an idea title), text (at most 15 words) } }, taught: { why (2 sentences with moves from its line), enforces: { idea, text } }, alternatives: one per entry in the card's alternatives: { uci (as given), label (as given), before, after, idea } }.
Omit taught when card.taught is null.

Rules:
- Ideas come from the research and must hold in this card's line. Cards in the same variation should share idea titles and wording where they fit; adjust to each position. No claim the research doesn't support: drop it instead.
- Concrete first (what is lost, which tactic, what it allows), then the idea.
- Every move you mention must be in the card's moves, its lines, an alternative's line or the theory text, written with its number: "3.dxe5", "3...Nxe5", or runs like "4.Nc3 Bc5 5.f4". Moves only talked about ("White can't play Nc3") are fine.
- An alternative's "before" shows right after it's played, while the player may still be looking for the taught move: it must not name or hint at the taught move. sound: why it's good, and that there's a stronger move. Worse labels: why it fails. "after" shows once the taught move is known: why the taught move is better, or what differs in the plans. Where masters' practice and the engine disagree, say so plainly.
- Shapes go on the card's drill position (card.fen), 1-3 per idea, in the idea's side colour; arrows start on a piece or show a plan move; check them with python-chess (${PY}).
- Plain, direct sentences for club players. Address the player as "you"; the opponent by side ("Black") or "they", never he/him/his. No evaluation numbers; masters' percentages are fine.

Write the entries to ${DIR}/drafts-${i + 1}.json, then from ${REPO}/web run: npx vite-node scripts/ideas.ts check ${family} ${DIR}/drafts-${i + 1}.json
Fix every problem it prints (and the advice where it makes sense) and run it again, until every card passes or a problem truly can't be fixed (then say why). Check concrete board claims you're unsure of with python-chess and Stockfish (${STOCKFISH}, depth 16 at most). Return the result.`

const SPOT = { type: 'object', properties: {
  checked: { type: 'number' },
  issues: { type: 'array', items: { type: 'object', properties: {
    card: { type: 'string' }, field: { type: 'string' },
    problem: { type: 'string' }, evidence: { type: 'string' }, fixed: { type: 'boolean' },
  }, required: ['card', 'field', 'problem', 'evidence', 'fixed'] } },
  verdict: { type: 'string' },
}, required: ['checked', 'issues', 'verdict'] }

const spotPrompt = (files) => `${CONTEXT}

Writers produced explanations in ${files.join(', ')}. You are an adversarial sourcing checker. Pick about 10 strategic claims across the files (opening ideas, what a side "aims for", what masters prefer, why a move is or isn't played), favouring the boldest. For each, open its cited source with WebFetch (ToolSearch "select:WebFetch") and confirm it supports the claim. Flag claims a source doesn't support or contradicts, sources that don't back anything written, and text copied beyond a short phrase. Fix what you flag in the file (reword to what the source says, or drop the claim), then from ${REPO}/web run npx vite-node scripts/ideas.ts check ${family} <file> on every file you changed and make sure it still passes. Be quick: at most about 15 page reads. Return what you checked and found.`

phase('Research')
const ideasJob = agent(ideasPrompt, { label: `research:ideas`, phase: 'Research', schema: IDEAS_SCHEMA })
const written = await pipeline(
  batches,
  (b, _, i) => agent(linesPrompt(b, i), { label: `research:lines-${i + 1}`, phase: 'Research', schema: LINES_SCHEMA }),
  async (lines, b, i) => agent(writePrompt(b, i, await ideasJob, lines), { label: `write:${i + 1}`, phase: 'Write', schema: WRITE_RESULT }),
)
const done = written.filter(Boolean)
log(`written: ${done.map((w) => `${w.file} ${w.passed} passed, ${w.failed} failed`).join('; ')}`)

phase('Spot-check')
const spot = await agent(spotPrompt(done.map((w) => w.file)), { label: 'spot-check', phase: 'Spot-check', schema: SPOT, effort: 'medium' })
return { written: done, spot }
