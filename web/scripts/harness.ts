// Shared by the dev scripts: runs the app's analysis job in Node over the Python CLI's cached archives, with
// native Stockfish standing in for the browser engines and live Lichess cloud evals. Evaluations and masters
// data are kept in data/<user>/web-cache.json, so later runs only analyse what's new.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { positionKey } from '../src/lib/chess/zobrist';
import { replayUcis } from '../src/lib/chess/pgn';
import { chessopsUci, runAnalysis } from '../src/lib/analysis/runner';
import type { Eval, Masters } from '../src/lib/analysis/score';
import type { EvalResult } from '../src/lib/engine/uci';
import { parseInfo } from '../src/lib/engine/uci';
import { normalizeGame, type RawGame } from '../src/lib/games/chesscom';
import type { Game } from '../src/lib/games/types';
import { buildTree } from '../src/lib/tree/tree';

export const root = new URL('../../', import.meta.url);

/** LICHESS_TOKEN from the environment or the repo's .env (never printed). */
export function lichessToken(): string | undefined {
	if (process.env.LICHESS_TOKEN) return process.env.LICHESS_TOKEN;
	const env = new URL('.env', root);
	if (!existsSync(env)) return undefined;
	return /^LICHESS_TOKEN=(.+)$/m.exec(readFileSync(env, 'utf8'))?.[1].trim() || undefined;
}

/** The app's default period: the last 12 months, e.g. '2025-11' in Nov 2026. */
export function defaultSince(now = new Date()): string {
	const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - 12;
	return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function loadGames(user: string, since: string) {
	const archives = new URL(`data/${user}/archives/`, root);
	const sinceTs = Date.UTC(Number(since.slice(0, 4)), Number(since.slice(5, 7)) - 1, 1) / 1000;
	let raws: RawGame[] = [];
	for (const f of readdirSync(archives).sort()) raws = raws.concat(JSON.parse(readFileSync(new URL(f, archives), 'utf8')).games);
	const games = raws
		.map((r) => normalizeGame(r, user))
		.filter((g): g is Game => !!g && ['blitz', 'rapid'].includes(g.timeClass) && g.end >= sinceTs);
	const byColor = { white: games.filter((g) => g.color === 'white'), black: games.filter((g) => g.color === 'black') };
	const trees = { white: buildTree(byColor.white), black: buildTree(byColor.black) };
	return { games, byColor, trees };
}

/** Masters data from the research cache (JSON files with { epd, data | pruned }). */
export function seedMasters(dir: string | undefined, masters: Map<number, Masters>): number {
	if (!dir || !existsSync(dir)) return 0;
	let n = 0;
	for (const f of readdirSync(dir)) {
		const entry = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
		const pos = Chess.fromSetup(parseFen(`${entry.epd} 0 1`).unwrap()).unwrap();
		const key = positionKey(pos);
		if (masters.has(key)) continue;
		n++;
		if (entry.pruned) {
			masters.set(key, { total: 0, moves: {} });
			continue;
		}
		const d = entry.data;
		const moves: Record<string, number> = {};
		for (const m of d.moves) {
			const uci = chessopsUci(pos, m.uci);
			if (uci) moves[uci] = m.white + m.draws + m.black;
		}
		masters.set(key, { total: d.white + d.draws + d.black, moves });
	}
	return n;
}

/** Native Stockfish processes (one single-threaded process per lane) behind a shared queue. */
export function enginePool(size: number) {
	const binary = new URL('engine/stockfish', root).pathname;
	function engine() {
		const proc = spawn(binary, [], { stdio: ['pipe', 'pipe', 'ignore'] });
		let buf = '';
		let onLine: ((l: string) => void) | null = null;
		proc.stdout.on('data', (d) => {
			buf += d;
			let i;
			while ((i = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, i).trim();
				buf = buf.slice(i + 1);
				onLine?.(line);
			}
		});
		const until = (cmd: string, done: (l: string) => boolean, each?: (l: string) => void) =>
			new Promise<void>((res) => {
				onLine = (l) => {
					each?.(l);
					if (done(l)) {
						onLine = null;
						res();
					}
				};
				proc.stdin.write(cmd + '\n');
			});
		const ready = until('uci', (l) => l === 'uciok').then(() => until('setoption name Hash value 32\nisready', (l) => l === 'readyok'));
		return {
			async evaluate(fen: string, depth: number): Promise<EvalResult> {
				await ready;
				await until(`ucinewgame\nposition fen ${fen}\nisready`, (l) => l === 'readyok');
				const t = performance.now();
				let last: Omit<EvalResult, 'ms'> = { depth: 0, pv: [], nodes: 0 };
				await until(`go depth ${depth}`, (l) => l.startsWith('bestmove'), (l) => (last = parseInfo(l) ?? last));
				return { ...last, ms: performance.now() - t };
			},
			quit: () => proc.kill()
		};
	}
	const pool = Array.from({ length: size }, engine);
	const idle = [...pool];
	const waiters: ((e: (typeof pool)[number]) => void)[] = [];
	return {
		async evaluate(fen: string, depth: number) {
			const e = idle.pop() ?? (await new Promise<(typeof pool)[number]>((r) => waiters.push(r)));
			try {
				return await e.evaluate(fen, depth);
			} finally {
				const w = waiters.shift();
				if (w) w(e);
				else idle.push(e);
			}
		},
		quit: () => pool.forEach((e) => e.quit())
	};
}

export interface HarnessOptions {
	user: string;
	since: string;
	mastersDir?: string;
	engines?: number;
	minReach?: number;
}

/** Loads games and caches, and analyses whatever isn't cached yet. Call `quit()` when done with the engines. */
export async function analyse({ user, since, mastersDir, engines = 8, minReach = 3 }: HarnessOptions) {
	const { games, byColor, trees } = loadGames(user, since);
	console.log(`${games.length} games (${byColor.white.length} white, ${byColor.black.length} black)`);

	const cacheFile = new URL(`data/${user}/web-cache.json`, root);
	const evals = new Map<number, Eval>();
	const masters = new Map<number, Masters>();
	if (existsSync(cacheFile)) {
		const cache = JSON.parse(readFileSync(cacheFile, 'utf8')) as { evals: [number, Eval][]; masters: [number, Masters][] };
		for (const [k, v] of cache.evals) evals.set(k, v);
		for (const [k, v] of cache.masters) masters.set(k, v);
		console.log(`cache: ${evals.size} evals, ${masters.size} masters entries`);
	}
	const seeded = seedMasters(mastersDir, masters);
	if (seeded) console.log(`seeded ${seeded} masters entries from ${mastersDir}`);
	const save = () => writeFileSync(cacheFile, JSON.stringify({ evals: [...evals], masters: [...masters] }));

	const pool = enginePool(engines);
	const t0 = performance.now();
	let lastLog = 0;
	const result = await runAnalysis(
		{
			trees,
			root: positionKey(Chess.default()),
			evals,
			masters,
			position: (key) => {
				const node = trees.white.get(key) ?? trees.black.get(key);
				return node ? replayUcis(node.ref.game.ucis.slice(0, node.ref.ply)).pos : undefined;
			},
			saveEvals: async () => {},
			saveMasters: async () => {},
			cancelled: () => false
		},
		{ minReach, depth: 16, engines, token: lichessToken() },
		{
			evaluate: pool.evaluate,
			progress: (p) => {
				if (Date.now() - lastLog > 10_000 || !p.running) {
					lastLog = Date.now();
					const m = p.masters ? ` | masters ${p.masters.done}/${p.masters.total} (skipped ${p.masters.skipped})` : '';
					console.log(`  [${((performance.now() - t0) / 1000).toFixed(0)}s] evals ${p.evals.done}/${p.evals.total} (cloud ${p.evals.cloud}, local ${p.evals.local})${m}`);
				}
			}
		}
	);
	save();
	console.log(`analysed in ${((performance.now() - t0) / 1000).toFixed(0)}s; ${evals.size} evals; errors: ${result.error || 'none'}`);
	return { games, byColor, trees, evals, masters, evaluate: pool.evaluate, quit: pool.quit };
}
