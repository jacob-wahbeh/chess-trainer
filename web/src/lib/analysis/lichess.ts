// Lichess endpoints used for analysis. Both are meant to be called one request at a time; on HTTP 429
// Lichess asks clients to wait a full minute (https://lichess.org/api#section/Introduction/Rate-limiting).

export class RateLimited extends Error {
	constructor(readonly waitMs = 60_000) {
		super('Lichess rate limit reached');
	}
}

export class AuthError extends Error {
	constructor() {
		super('Lichess login expired or missing');
	}
}

export interface CloudPv {
	moves: string[];
	/** White's point of view. */
	cp?: number;
	mate?: number;
}

export interface CloudEval {
	depth: number;
	pvs: CloudPv[];
}

/** Cached evaluation of a position, or null when Lichess has none. */
export async function cloudEval(fen: string, multiPv = 5): Promise<CloudEval | null> {
	const res = await fetch(`https://lichess.org/api/cloud-eval?${new URLSearchParams({ fen, multiPv: String(multiPv) })}`);
	if (res.status === 404) return null;
	if (res.status === 429) throw new RateLimited();
	if (!res.ok) throw new Error(`Lichess cloud eval: HTTP ${res.status}`);
	const data = (await res.json()) as { depth: number; pvs: { moves: string; cp?: number; mate?: number }[] };
	return { depth: data.depth, pvs: data.pvs.map((p) => ({ moves: p.moves.split(' '), cp: p.cp, mate: p.mate })) };
}

export interface ExplorerMove {
	uci: string;
	games: number;
}

/** Masters-database move statistics for a position (needs any valid Lichess token). */
export async function mastersExplorer(fen: string, token: string): Promise<{ total: number; moves: ExplorerMove[] }> {
	const res = await fetch(`https://explorer.lichess.org/masters?${new URLSearchParams({ fen, moves: '30', topGames: '0' })}`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (res.status === 401 || res.status === 403) throw new AuthError();
	if (res.status === 429) throw new RateLimited();
	if (!res.ok) throw new Error(`Lichess explorer: HTTP ${res.status}`);
	const data = (await res.json()) as {
		white: number;
		draws: number;
		black: number;
		moves: { uci: string; white: number; draws: number; black: number }[];
	};
	return {
		total: data.white + data.draws + data.black,
		moves: data.moves.map((m) => ({ uci: m.uci, games: m.white + m.draws + m.black }))
	};
}
