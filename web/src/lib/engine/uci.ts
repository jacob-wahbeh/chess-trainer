// UCI output parsing, shared by the browser engine pool and dev scripts.

export interface EvalResult {
	depth: number;
	/** Centipawns from the side to move's point of view. */
	cp?: number;
	/** Moves to mate from the side to move's point of view (negative: getting mated). */
	mate?: number;
	pv: string[];
	nodes: number;
	ms: number;
}

/** Parses a UCI "info" line; returns null for lines without a final (non-bound) score. */
export function parseInfo(line: string): Omit<EvalResult, 'ms'> | null {
	if (!line.startsWith('info ') || line.includes('bound') || !line.includes(' pv ')) return null;
	const depth = /\bdepth (\d+)/.exec(line);
	const score = /\bscore (cp|mate) (-?\d+)/.exec(line);
	if (!depth || !score) return null;
	const nodes = /\bnodes (\d+)/.exec(line);
	const pv = line.slice(line.indexOf(' pv ') + 4).trim().split(/\s+/);
	return {
		depth: Number(depth[1]),
		...(score[1] === 'cp' ? { cp: Number(score[2]) } : { mate: Number(score[2]) }),
		pv,
		nodes: nodes ? Number(nodes[1]) : 0
	};
}
