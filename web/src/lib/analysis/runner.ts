// The background analysis job. Three lanes share the work:
//  - cloud: Lichess's cached evaluations, one request at a time, most common positions first. Each answer
//    carries up to 5 candidate moves, which also evaluates the positions those moves lead to.
//  - local: Stockfish engines (run by the UI thread) take cloud misses and the least common positions.
//  - masters: book statistics at ~30 lookups/minute, shallow first, skipping lines that already left theory.
import { normalizeMove, type Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { makeUci, parseUci } from 'chessops/util';
import { positionKey } from '../chess/zobrist';
import type { EvalResult } from '../engine/uci';
import type { Color } from '../games/types';
import type { Tree } from '../tree/tree';
import { AuthError, cloudEval, mastersExplorer, RateLimited, type CloudEval } from './lichess';
import { decisionParents, decisionPoints, depths, evalQueue, needsMasters } from './plan';
import type { Eval, Masters } from './score';

export interface AnalysisOptions {
	minReach: number;
	depth: number;
	/** Local engines to keep busy. */
	engines: number;
	/** Lichess token; without one the book check is skipped. */
	token?: string;
}

export interface AnalysisHost {
	evaluate(fen: string, depth: number): Promise<EvalResult>;
	progress(p: AnalysisProgress): void;
}

export interface AnalysisProgress {
	running: boolean;
	evals: { done: number; total: number; cloud: number; local: number };
	/** null without a Lichess token. */
	masters: { done: number; total: number; skipped: number; waiting: boolean } | null;
	authError: boolean;
	error: string;
}

export interface AnalysisContext {
	trees: Record<Color, Tree>;
	/** Key of the starting position. */
	root: number;
	evals: Map<number, Eval>;
	masters: Map<number, Masters>;
	position(key: number): Chess | undefined;
	saveEvals(entries: [number, Eval][]): Promise<void>;
	saveMasters(key: number, masters: Masters, skipped: boolean): Promise<void>;
	cancelled(): boolean;
}

/** Spacing between masters lookups: stays under the explorer's ~30 requests/minute. */
const MASTERS_GAP_MS = 2100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A UCI move from Stockfish or Lichess in chessops form (castling as king-takes-rook); undefined if illegal. */
export function chessopsUci(pos: Chess, uci: string | undefined): string | undefined {
	const move = uci ? parseUci(uci) : undefined;
	if (!move) return undefined;
	const normalized = normalizeMove(pos, move);
	return pos.isLegal(normalized) ? makeUci(normalized) : undefined;
}

export function terminalEval(pos: Chess): Eval | undefined {
	if (pos.isCheckmate()) return { cp: pos.turn === 'white' ? -100000 : 100000, depth: 0, src: 'terminal' };
	if (pos.isStalemate() || pos.isInsufficientMaterial()) return { cp: 0, depth: 0, src: 'terminal' };
	return undefined;
}

/** The position's eval plus derived evals for the positions after each candidate move. */
export function evalsFromCloud(pos: Chess, cloud: CloudEval): [number, Eval][] {
	const out: [number, Eval][] = [];
	const [top] = cloud.pvs;
	if (!top) return out;
	out.push([positionKey(pos), { cp: top.cp, mate: top.mate, best: chessopsUci(pos, top.moves[0]), depth: cloud.depth, src: 'cloud' }]);
	for (const pv of cloud.pvs) {
		const first = chessopsUci(pos, pv.moves[0]);
		if (!first) continue;
		const child = pos.clone();
		child.play(parseUci(first)!);
		out.push([positionKey(child), { cp: pv.cp, mate: pv.mate, best: chessopsUci(child, pv.moves[1]), depth: cloud.depth, src: 'cloud' }]);
	}
	return out;
}

export async function runAnalysis(ctx: AnalysisContext, opts: AnalysisOptions, host: AnalysisHost): Promise<AnalysisProgress> {
	const plans = (['white', 'black'] as const).map((color) => {
		const depth = depths(ctx.trees[color], ctx.root);
		return { color, depth, decisions: decisionPoints(ctx.trees[color], color, opts.minReach, depth) };
	});

	// Eval queue: each decision point with the positions its moves lead to, both colors merged by how often
	// the decision point comes up, so verdicts for the most common positions are ready first.
	const priority = new Map<number, number>();
	for (const { color, decisions } of plans) {
		const tree = ctx.trees[color];
		const isDecision = new Set(decisions);
		let reach = 0;
		let i = 0;
		for (const key of evalQueue(tree, decisions)) {
			if (isDecision.has(key)) reach = tree.get(key)!.n;
			const p = reach - i++ * 1e-9;
			if ((priority.get(key) ?? -Infinity) < p) priority.set(key, p);
		}
	}
	const queue = [...priority.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key).filter((k) => !ctx.evals.has(k));

	// Masters order: shallow first; parents (one move pair earlier) decide whether a line is still theory.
	const depthOf = new Map<number, number>();
	const parents = new Map<number, number[]>();
	for (const { color, depth, decisions } of plans) {
		for (const key of decisions) if (!depthOf.has(key)) depthOf.set(key, depth.get(key)!);
		for (const [key, ps] of decisionParents(ctx.trees[color], decisions)) parents.set(key, [...(parents.get(key) ?? []), ...ps]);
	}
	const mastersQueue = [...depthOf.keys()].sort((a, b) => depthOf.get(a)! - depthOf.get(b)!).filter((k) => !ctx.masters.has(k));

	const progress: AnalysisProgress = {
		running: true,
		evals: { done: 0, total: queue.length, cloud: 0, local: 0 },
		masters: opts.token ? { done: 0, total: mastersQueue.length, skipped: 0, waiting: false } : null,
		authError: false,
		error: ''
	};
	let lastReport = 0;
	const report = (force = false) => {
		const now = Date.now();
		if (!force && now - lastReport < 400) return;
		lastReport = now;
		host.progress(structuredClone(progress));
	};
	report(true);

	let pending: [number, Eval][] = [];
	const flush = async () => {
		if (!pending.length) return;
		const batch = pending;
		pending = [];
		await ctx.saveEvals(batch);
	};
	const queued = new Set(queue);
	const store = (entries: [number, Eval][], lane: 'cloud' | 'local') => {
		for (const [key, value] of entries) {
			if (ctx.evals.has(key)) continue;
			ctx.evals.set(key, value);
			pending.push([key, value]);
			if (queued.has(key)) {
				progress.evals.done++;
				progress.evals[lane]++;
			}
		}
		if (pending.length >= 50) void flush();
		report();
	};

	let head = 0;
	let tail = queue.length - 1;
	const misses: number[] = [];
	const takeFront = () => {
		while (head <= tail) {
			const key = queue[head++];
			if (!ctx.evals.has(key)) return key;
		}
		return undefined;
	};
	const takeBack = () => {
		while (misses.length) {
			const key = misses.shift()!;
			if (!ctx.evals.has(key)) return key;
		}
		while (tail >= head) {
			const key = queue[tail--];
			if (!ctx.evals.has(key)) return key;
		}
		return undefined;
	};

	/** Evaluates terminal positions directly; returns false if `key` still needs an engine. */
	const settleTerminal = (key: number, pos: Chess) => {
		const t = terminalEval(pos);
		if (t) store([[key, t]], 'local');
		return !!t;
	};

	let cloudDone = false;
	const cloudLane = async () => {
		let failures = 0;
		try {
			for (let key = takeFront(); key !== undefined && !ctx.cancelled(); key = takeFront()) {
				const pos = ctx.position(key);
				if (!pos || settleTerminal(key, pos)) continue;
				try {
					const cloud = await cloudEval(makeFen(pos.toSetup()));
					if (cloud?.pvs.length) store(evalsFromCloud(pos, cloud), 'cloud');
					else misses.push(key);
				} catch (err) {
					misses.push(key);
					// Rate limited or failing: leave the rest to the local engines rather than retrying.
					if (err instanceof RateLimited || ++failures >= 5) return;
				}
			}
		} finally {
			cloudDone = true;
		}
	};

	const localLane = async () => {
		while (!ctx.cancelled()) {
			const key = takeBack();
			if (key === undefined) {
				if (cloudDone) return;
				await sleep(250);
				continue;
			}
			const pos = ctx.position(key);
			if (!pos || settleTerminal(key, pos)) continue;
			const r = await host.evaluate(makeFen(pos.toSetup()), opts.depth);
			const sign = pos.turn === 'white' ? 1 : -1;
			store(
				[
					[
						key,
						{
							cp: r.cp === undefined ? undefined : sign * r.cp,
							mate: r.mate === undefined ? undefined : sign * r.mate,
							best: chessopsUci(pos, r.pv[0]),
							depth: r.depth,
							src: 'local'
						}
					]
				],
				'local'
			);
		}
	};

	const mastersLane = async (token: string) => {
		const m = progress.masters!;
		for (const key of mastersQueue) {
			if (ctx.cancelled()) return;
			if (ctx.masters.has(key)) {
				m.done++;
				continue;
			}
			if (!needsMasters(key, parents, ctx.masters)) {
				const empty = { total: 0, moves: {} };
				ctx.masters.set(key, empty);
				await ctx.saveMasters(key, empty, true);
				m.done++;
				m.skipped++;
				report();
				continue;
			}
			const pos = ctx.position(key);
			if (!pos) continue;
			for (;;) {
				try {
					const res = await mastersExplorer(makeFen(pos.toSetup()), token);
					const moves: Record<string, number> = {};
					for (const mv of res.moves) {
						const uci = chessopsUci(pos, mv.uci);
						if (uci) moves[uci] = mv.games;
					}
					const value = { total: res.total, moves };
					ctx.masters.set(key, value);
					await ctx.saveMasters(key, value, false);
					m.done++;
					m.waiting = false;
					report();
					break;
				} catch (err) {
					if (err instanceof RateLimited) {
						m.waiting = true;
						report(true);
						await sleep(err.waitMs);
						if (ctx.cancelled()) return;
						continue;
					}
					if (err instanceof AuthError) progress.authError = true;
					else progress.error = err instanceof Error ? err.message : String(err);
					report(true);
					return;
				}
			}
			await sleep(MASTERS_GAP_MS);
		}
	};

	const lanes = [cloudLane(), ...Array.from({ length: Math.max(1, opts.engines) }, localLane)];
	if (opts.token && mastersQueue.length) lanes.push(mastersLane(opts.token));
	try {
		await Promise.all(lanes);
	} catch (err) {
		progress.error = err instanceof Error ? err.message : String(err);
	} finally {
		await flush();
	}
	progress.running = false;
	report(true);
	return progress;
}
