// Which positions the analysis needs, and in what order.
import type { Color } from '../games/types';
import type { Tree } from '../tree/tree';
import { THEORY_MIN_GAMES, type Masters } from './score';

/** Ply distance of every node from the start position (breadth-first over the tree's edges). */
export function depths(tree: Tree, root: number): Map<number, number> {
	const depth = new Map([[root, 0]]);
	const queue = [root];
	for (let i = 0; i < queue.length; i++) {
		const node = tree.get(queue[i]);
		if (!node) continue;
		const d = depth.get(queue[i])! + 1;
		for (const edge of node.edges.values()) {
			if (!depth.has(edge.to)) {
				depth.set(edge.to, d);
				queue.push(edge.to);
			}
		}
	}
	return depth;
}

export const userToMove = (depth: number, color: Color) => (depth % 2 === 0) === (color === 'white');

/** Positions where it's the user's move, reached at least `minReach` times; most common first. */
export function decisionPoints(tree: Tree, color: Color, minReach: number, depth: Map<number, number>): number[] {
	return [...tree.entries()]
		.filter(([key, node]) => node.n >= minReach && depth.has(key) && userToMove(depth.get(key)!, color))
		.sort((a, b) => b[1].n - a[1].n)
		.map(([key]) => key);
}

/** Every position the verdicts need evaluated: each decision point, followed by the positions its moves lead to. */
export function evalQueue(tree: Tree, decisions: number[]): number[] {
	const out: number[] = [];
	const seen = new Set<number>();
	const push = (key: number) => {
		if (!seen.has(key)) {
			seen.add(key);
			out.push(key);
		}
	};
	for (const key of decisions) {
		push(key);
		const edges = [...(tree.get(key)?.edges.values() ?? [])].sort((a, b) => b.n - a.n);
		for (const edge of edges) push(edge.to);
	}
	return out;
}

/** Decision points ordered for masters lookups: shallow first, so a line can be skipped once it leaves theory. */
export function mastersOrder(decisions: number[], depth: Map<number, number>): number[] {
	return [...decisions].sort((a, b) => depth.get(a)! - depth.get(b)!);
}

/** For each decision point, the decision points one move pair earlier (user move, then the opponent's reply). */
export function decisionParents(tree: Tree, decisions: number[]): Map<number, number[]> {
	const set = new Set(decisions);
	const parents = new Map<number, number[]>();
	for (const key of decisions) {
		for (const mine of tree.get(key)?.edges.values() ?? []) {
			for (const theirs of tree.get(mine.to)?.edges.values() ?? []) {
				if (!set.has(theirs.to)) continue;
				const list = parents.get(theirs.to) ?? [];
				if (!list.includes(key)) list.push(key);
				parents.set(theirs.to, list);
			}
		}
	}
	return parents;
}

/** False when every looked-up parent already left master theory, so this lookup can be skipped. */
export function needsMasters(key: number, parents: Map<number, number[]>, masters: Map<number, Masters>): boolean {
	const known = (parents.get(key) ?? []).map((p) => masters.get(p)).filter((m) => m !== undefined);
	return known.length === 0 || known.some((m) => m.total >= THEORY_MIN_GAMES);
}
