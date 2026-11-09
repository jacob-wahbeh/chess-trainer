import { addResult, emptyStats, type Game, type Stats } from '../games/types';

export interface Edge extends Stats {
	uci: string;
	/** Key of the position the move leads to. */
	to: number;
}

export interface TreeNode extends Stats {
	edges: Map<string, Edge>;
	/** One game that reached the position, and at which ply: enough to rebuild its FEN. */
	ref: { game: Game; ply: number };
}

/** Position key -> how often the user's games reached it and what was played next. */
export type Tree = Map<number, TreeNode>;

export function buildTree(games: Iterable<Game>): Tree {
	const tree: Tree = new Map();
	for (const game of games) {
		const seen = new Set<number>();
		for (let i = 0; i < game.keys.length; i++) {
			const key = game.keys[i];
			// A repetition adds nothing new to the opening tree and would double-count the game.
			if (seen.has(key)) break;
			seen.add(key);
			let node = tree.get(key);
			if (!node) tree.set(key, (node = { ...emptyStats(), edges: new Map(), ref: { game, ply: i } }));
			addResult(node, game.result);
			if (i < game.ucis.length) {
				const uci = game.ucis[i];
				let edge = node.edges.get(uci);
				if (!edge) node.edges.set(uci, (edge = { ...emptyStats(), uci, to: game.keys[i + 1] }));
				addResult(edge, game.result);
			}
		}
	}
	return tree;
}

export interface NodeView extends Stats {
	/** Moves played from this position, most common first. */
	moves: Edge[];
}

export function nodeView(tree: Tree, key: number): NodeView | null {
	const node = tree.get(key);
	if (!node) return null;
	const { n, w, d, l } = node;
	return { n, w, d, l, moves: [...node.edges.values()].sort((a, b) => b.n - a.n) };
}

/** The continuation seen most often from `key`: follows the most common move while it has >= minGames. */
export function mainLine(tree: Tree, key: number, maxPlies = 16, minGames = 3): string[] {
	const line: string[] = [];
	const seen = new Set([key]);
	let node = tree.get(key);
	while (node && line.length < maxPlies) {
		let best: Edge | undefined;
		for (const edge of node.edges.values()) if (!best || edge.n > best.n) best = edge;
		if (!best || best.n < minGames || seen.has(best.to)) break;
		line.push(best.uci);
		seen.add(best.to);
		node = tree.get(best.to);
	}
	return line;
}
