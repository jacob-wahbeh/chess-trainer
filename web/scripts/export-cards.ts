// Exports every drill card with engine lines, checked facts and opening theory (Wikibooks), for writing
// explanations in a Claude Code session (the /explain-cards command; bookkeeping in scripts/explanations.ts).
// Reuses cached evaluations and theory pages.
// Usage: npx vite-node scripts/export-cards.ts [user] [since YYYY-MM] [masters cache dir]
//        -> data/<user>/cards.json
import { readFileSync, writeFileSync } from 'node:fs';
import type { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseUci } from 'chessops/util';
import { findLeaks, type Leak } from '../src/lib/analysis/classify';
import { formatEval, INACCURACY, THEORY_MIN_GAMES } from '../src/lib/analysis/score';
import { continuation, formatPlies, walk, type Ply } from '../src/lib/chess/line';
import { replayUcis } from '../src/lib/chess/pgn';
import { acceptedMoves, cardWorthy, dropOf, mainMove } from '../src/lib/drill/cards';
import type { ExportCard } from '../src/lib/explain/check';
import { explainFacts, passTurn, realThreat } from '../src/lib/explain/facts';
import { buildOpeningIndex, deepestOpening } from '../src/lib/tree/openings';
import { analyse, defaultSince, root } from './harness';
import { theoryPages, wikiTitle } from './wikibooks';

/** Deeper than the app's depth 16: these lines are read closely. */
const DEPTH = 20;
/** Plies of each line the writer sees (and the checker allows). */
const LINE_PLIES = 10;

const [user = 'draco_jaco', since = defaultSince(), mastersDir] = process.argv.slice(2);
const { byColor, trees, evals, masters, evaluate, quit } = await analyse({ user, since, mastersDir });
const openings = buildOpeningIndex(JSON.parse(readFileSync(new URL('../static/openings.json', import.meta.url), 'utf8')));
const pct = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);

const leaks = (['white', 'black'] as const)
	.flatMap((c) => findLeaks(byColor[c], trees[c], c, evals, masters, 3).leaks)
	.filter(cardWorthy)
	.sort((a, b) => b.points - a.points);
console.log(`exporting ${leaks.length} cards…`);

/** The accepted answers and the one taught, with how much the opponent's last move gave away. */
function teach(leak: Leak) {
	const { pos } = replayUcis(leak.path);
	const answers = acceptedMoves(pos, leak.key, leak.uci, evals, masters);
	const prev = leak.path.length ? replayUcis(leak.path.slice(0, -1)) : undefined;
	const slip = prev ? dropOf(prev.pos, evals.get(prev.keys.at(-1)!), evals.get(leak.key)) : null;
	return { answers, prev, slip, main: mainMove(answers, masters.get(leak.key), slip !== null && slip >= INACCURACY) };
}

/** Theory pages worth reading for a card: the position (or its nearest ancestor with a page) and the moves around it. */
function theoryTitles(leak: Leak) {
	const { pos } = replayUcis(leak.path);
	const plies = walk(leak.path).plies;
	const { main } = teach(leak);
	const after = (uci: string) => wikiTitle([...plies, ...continuation(pos, [uci])]);
	const earlier = Array.from({ length: Math.min(6, plies.length) }, (_, k) => ({ k: k + 1, title: wikiTitle(plies.slice(0, plies.length - k - 1)) }));
	return { plies, here: wikiTitle(plies), habit: after(leak.uci), taught: main ? after(main.uci) : undefined, earlier };
}
const titles = new Map(leaks.map((l) => [l, theoryTitles(l)]));
const pages = await theoryPages(
	[...titles.values()].flatMap((t) => [t.here, t.habit, ...(t.taught ? [t.taught] : []), ...t.earlier.map((e) => e.title)]),
	new URL(`data/${user}/wikibooks-cache.json`, root)
);
console.log(`theory: ${[...pages.values()].filter(Boolean).length} Wikibooks pages with commentary`);

function theoryFor(leak: Leak, habit: string, taught: string | undefined): ExportCard['theory'] {
	const t = titles.get(leak)!;
	const out: ExportCard['theory'] = [];
	const add = (about: string, page: string | undefined) => {
		const text = page && pages.get(page);
		if (page && text) out.push({ about, page, text });
	};
	if (pages.get(t.here)) add('this position', t.here);
	else {
		const nearest = t.earlier.find((e) => pages.get(e.title));
		const ply: Ply | undefined = nearest && t.plies[t.plies.length - nearest.k - 1];
		if (nearest) add(ply ? `earlier in the line, after ${formatPlies([ply])}` : 'the starting position', nearest.title);
	}
	add(`after your habit ${habit}`, t.habit);
	if (taught) add(`after the taught move ${taught}`, t.taught);
	return out;
}

async function lineAfter(pos: Chess, uci: string) {
	const next = pos.clone();
	next.play(parseUci(uci)!);
	const result = await evaluate(makeFen(next.toSetup()), DEPTH);
	return { plies: continuation(pos, [uci, ...result.pv]).slice(0, LINE_PLIES) };
}

async function exportCard(leak: Leak): Promise<ExportCard> {
	const { pos, keys } = replayUcis(leak.path);
	const { answers, prev, slip, main } = teach(leak);
	const m = masters.get(leak.key);
	const theory = m && m.total >= THEORY_MIN_GAMES ? m : undefined;
	const [good, bad] = await Promise.all([main ? lineAfter(pos, main.uci) : null, lineAfter(pos, leak.uci)]);

	// What the opponent would do with a free move: a threat when it wins material (see realThreat).
	const passed = passTurn(pos);
	const threatLine = passed ? continuation(passed, (await evaluate(makeFen(passed.toSetup()), DEPTH)).pv).slice(0, LINE_PLIES) : [];
	const threatens = passed && realThreat(passed, threatLine);
	const numbered = (uci: string) => formatPlies(continuation(pos, [uci]));
	const topMasters = theory
		? Object.entries(theory.moves)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5)
		: [];
	const others = answers.filter((a) => a.uci !== main?.uci);

	const taughtAnswer = answers.find((a) => a.uci === main?.uci);
	return {
		id: `${leak.key}|${leak.uci}`,
		color: leak.color,
		opening: deepestOpening(keys, openings)?.name,
		moves: formatPlies(walk(leak.path).plies),
		fen: makeFen(pos.toSetup()),
		eval: formatEval(evals.get(leak.key)),
		habit: {
			move: numbered(leak.uci),
			label: leak.label,
			evalAfter: formatEval(leak.after),
			winChanceLost: Math.round(leak.drop * 10) / 10,
			firstMistakeInGames: leak.first,
			refutation: formatPlies(bad.plies)
		},
		taught:
			main && good
				? { move: numbered(main.uci), reason: main.why, line: formatPlies(good.plies), evalAfter: formatEval(taughtAnswer?.eval), mastersShare: pct(taughtAnswer?.share ?? null) }
				: null,
		accepted: others.map((a) => ({ move: numbered(a.uci), mastersShare: pct(a.share), winChanceLost: a.drop === null ? null : Math.round(a.drop * 10) / 10 })),
		opponentLastMove: leak.path.length
			? {
					move: formatPlies(walk(leak.path).plies.slice(-1)),
					evalBefore: formatEval(prev ? evals.get(prev.keys.at(-1)!) : undefined),
					winChanceLost: slip === null ? null : Math.round(slip * 10) / 10
				}
			: null,
		threat: threatens ? { move: formatPlies(threatLine.slice(0, 1)), line: formatPlies(threatLine) } : null,
		masters: theory ? { games: theory.total, moves: topMasters.map(([uci, n]) => ({ move: numbered(uci), share: pct(n / theory.total)! })) } : null,
		facts: explainFacts({ pos, path: leak.path, wrong: leak.uci, wrongLine: bad.plies, main: main?.uci, mainLine: good?.plies, threat: threatLine }).map((f) => f.text),
		theory: theoryFor(leak, numbered(leak.uci), main ? numbered(main.uci) : undefined),
		check: {
			path: leak.path,
			lines: [(good?.plies ?? []).map((p) => p.uci), bad.plies.map((p) => p.uci), ...others.map((a) => [a.uci]), ...topMasters.map(([uci]) => [uci])],
			threat: threatLine.map((p) => p.uci)
		}
	};
}

const cards = await Promise.all(leaks.map(exportCard));
quit();
const out = new URL(`data/${user}/cards.json`, root);
writeFileSync(out, JSON.stringify({ user, since, generated: new Date().toISOString(), cards }, null, '\t'));
console.log(`wrote ${cards.length} cards to ${out.pathname}`);
