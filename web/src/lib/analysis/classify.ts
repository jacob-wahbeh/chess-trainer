import type { Color, Game } from '../games/types';
import type { Tree, TreeNode } from '../tree/tree';
import {
	BOOK_MIN_SHARE,
	DEPARTURES,
	engineLabel,
	REPERTOIRE_MIN_SHARE,
	THEORY_MIN_GAMES,
	whiteCp,
	winPercent,
	type Eval,
	type Label,
	type Masters
} from './score';

export interface Verdict {
	uci: string;
	/** Times the user played the move here. */
	count: number;
	/** Win% the move gave away (user's view); null until both positions are evaluated. */
	drop: number | null;
	/** Evaluations of the position and of the position after the move, when known. */
	before?: Eval;
	after?: Eval;
	/** Share of master games with this move; null without masters data or outside master theory. */
	share: number | null;
	label: Label | null;
}

/** Judges each move the user played at a position where it was their turn. */
export function judge(
	node: TreeNode,
	key: number,
	color: Color,
	evals: Map<number, Eval>,
	masters: Map<number, Masters>
): Verdict[] {
	const before = evals.get(key);
	const m = masters.get(key);
	const theory = m && m.total >= THEORY_MIN_GAMES ? m : undefined;
	const sign = color === 'white' ? 1 : -1;
	let visits = 0;
	for (const edge of node.edges.values()) visits += edge.n;

	return [...node.edges.values()].map((edge) => {
		const after = evals.get(edge.to);
		let drop: number | null = null;
		if (before && after) {
			drop = before.best === edge.uci ? 0 : Math.max(0, winPercent(sign * whiteCp(before)) - winPercent(sign * whiteCp(after)));
		}
		const share = theory ? (theory.moves[edge.uci] ?? 0) / theory.total : null;
		let label: Label | null = drop === null ? null : engineLabel(drop);
		if (!label && drop !== null) {
			if (share === null) label = 'ok';
			else if (share >= BOOK_MIN_SHARE) label = 'book';
			else label = edge.n / visits >= REPERTOIRE_MIN_SHARE ? 'repertoire' : 'offbook';
		}
		return { uci: edge.uci, count: edge.n, drop, share, label, before, after };
	});
}

export interface Leak {
	key: number;
	uci: string;
	color: Color;
	/** Moves from the start to the position, in the order the user actually reached it. */
	path: string[];
	label: Label;
	drop: number;
	/** Evaluations before and after the move, when known. */
	before?: Eval;
	after?: Eval;
	/** Times the move was played here. */
	count: number;
	/** Games where this was the first departure, and the first and latest of them (unix seconds). */
	first: number;
	since: number;
	last: number;
	/** Approximate game points lost to it as a first departure: first × max(drop, 1) / 100. */
	points: number;
	best?: string;
	share: number | null;
	/** Most played master moves here, with their share. */
	masters: { uci: string; share: number }[];
}

export interface LeakReport {
	leaks: Leak[];
	/** Games whose first departure fell inside the analysed tree. */
	departures: number;
	games: number;
}

/**
 * Walks each game through the user's decision points and credits its *first* departure (engine-flagged or
 * off-book and not a repertoire choice). Deeper departures in the same game wait until the first is fixed.
 */
export function findLeaks(
	games: Game[],
	tree: Tree,
	color: Color,
	evals: Map<number, Eval>,
	masters: Map<number, Masters>,
	minReach: number
): LeakReport {
	const verdicts = new Map<number, Map<string, Verdict>>();
	const leaks = new Map<string, Leak>();
	let departures = 0;

	for (const game of games) {
		for (let i = color === 'white' ? 0 : 1; i < game.ucis.length; i += 2) {
			const key = game.keys[i];
			const node = tree.get(key);
			if (!node || node.n < minReach) break;
			let byMove = verdicts.get(key);
			if (!byMove) verdicts.set(key, (byMove = new Map(judge(node, key, color, evals, masters).map((v) => [v.uci, v]))));
			const v = byMove.get(game.ucis[i]);
			if (!v?.label) break;
			if (!DEPARTURES.has(v.label)) continue;
			departures++;
			const id = `${key} ${v.uci}`;
			let leak = leaks.get(id);
			if (!leak) {
				const m = masters.get(key);
				leaks.set(
					id,
					(leak = {
						key,
						uci: v.uci,
						color,
						path: game.ucis.slice(0, i),
						label: v.label,
						drop: v.drop ?? 0,
						before: v.before,
						after: v.after,
						count: v.count,
						first: 0,
						since: game.end,
						last: game.end,
						points: 0,
						best: evals.get(key)?.best,
						share: v.share,
						masters: m?.total
							? Object.entries(m.moves)
									.sort((a, b) => b[1] - a[1])
									.slice(0, 3)
									.map(([uci, n]) => ({ uci, share: n / m.total }))
							: []
					})
				);
			}
			leak.first++;
			leak.since = Math.min(leak.since, game.end);
			leak.last = Math.max(leak.last, game.end);
			break;
		}
	}

	for (const leak of leaks.values()) leak.points = (leak.first * Math.max(leak.drop, 1)) / 100;
	return { leaks: [...leaks.values()].sort((a, b) => b.points - a.points), departures, games: games.length };
}
