// Dev check: runs the app's analysis job in Node over the Python CLI's cached archives, with native Stockfish
// standing in for the browser engines and live Lichess cloud evals. Masters data can be seeded from the
// research cache (JSON files with { epd, data | pruned }) and, with LICHESS_TOKEN set, the rest is fetched.
// Usage: npx vite-node scripts/analyze-node.ts [user] [since YYYY-MM] [masters cache dir]
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { positionKey } from '../src/lib/chess/zobrist';
import { findLeaks } from '../src/lib/analysis/classify';
import { chessopsUci, runAnalysis } from '../src/lib/analysis/runner';
import type { Eval, Masters } from '../src/lib/analysis/score';
import type { EvalResult } from '../src/lib/engine/pool';
import { parseInfo } from '../src/lib/engine/uci';
import { normalizeGame, type RawGame } from '../src/lib/games/chesscom';
import type { Game } from '../src/lib/games/types';
import { buildTree } from '../src/lib/tree/tree';
import { replayUcis } from '../src/lib/chess/pgn';
import { sanOf } from '../src/lib/chess/line';

const [user = 'draco_jaco', since = '2025-11', mastersDir] = process.argv.slice(2);
const root = new URL('../../', import.meta.url);
const archives = new URL(`data/${user}/archives/`, root);
const sinceTs = Date.UTC(Number(since.slice(0, 4)), Number(since.slice(5, 7)) - 1, 1) / 1000;

let raws: RawGame[] = [];
for (const f of readdirSync(archives).sort()) raws = raws.concat(JSON.parse(readFileSync(new URL(f, archives), 'utf8')).games);
const games = raws
	.map((r) => normalizeGame(r, user))
	.filter((g): g is Game => !!g && ['blitz', 'rapid'].includes(g.timeClass) && g.end >= sinceTs);
const byColor = { white: games.filter((g) => g.color === 'white'), black: games.filter((g) => g.color === 'black') };
const trees = { white: buildTree(byColor.white), black: buildTree(byColor.black) };
console.log(`${games.length} games (${byColor.white.length} white, ${byColor.black.length} black)`);

// Seed masters from the research cache.
const masters = new Map<number, Masters>();
if (mastersDir && existsSync(mastersDir)) {
	for (const f of readdirSync(mastersDir)) {
		const entry = JSON.parse(readFileSync(`${mastersDir}/${f}`, 'utf8'));
		const pos = Chess.fromSetup(parseFen(`${entry.epd} 0 1`).unwrap()).unwrap();
		if (entry.pruned) {
			masters.set(positionKey(pos), { total: 0, moves: {} });
			continue;
		}
		const d = entry.data;
		const moves: Record<string, number> = {};
		for (const m of d.moves) {
			const uci = chessopsUci(pos, m.uci);
			if (uci) moves[uci] = m.white + m.draws + m.black;
		}
		masters.set(positionKey(pos), { total: d.white + d.draws + d.black, moves });
	}
	console.log(`seeded ${masters.size} masters entries from ${mastersDir}`);
}

// Native Stockfish pool (one single-threaded process per lane).
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
const ENGINES = 8;
const pool = Array.from({ length: ENGINES }, engine);
const idle = [...pool];
const waiters: ((e: (typeof pool)[number]) => void)[] = [];
async function evaluate(fen: string, depth: number) {
	const e = idle.pop() ?? (await new Promise<(typeof pool)[number]>((r) => waiters.push(r)));
	try {
		return await e.evaluate(fen, depth);
	} finally {
		const w = waiters.shift();
		if (w) w(e);
		else idle.push(e);
	}
}

const evals = new Map<number, Eval>();
const token = process.env.LICHESS_TOKEN;
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
	{ minReach: 3, depth: 16, engines: ENGINES, token },
	{
		evaluate,
		progress: (p) => {
			if (Date.now() - lastLog > 10_000 || !p.running) {
				lastLog = Date.now();
				const m = p.masters ? ` | masters ${p.masters.done}/${p.masters.total} (skipped ${p.masters.skipped})` : '';
				console.log(`  [${((performance.now() - t0) / 1000).toFixed(0)}s] evals ${p.evals.done}/${p.evals.total} (cloud ${p.evals.cloud}, local ${p.evals.local})${m}`);
			}
		}
	}
);
for (const e of pool) e.quit();
console.log(`done in ${((performance.now() - t0) / 1000).toFixed(0)}s; ${evals.size} evals stored; errors: ${result.error || 'none'}`);

for (const color of ['white', 'black'] as const) {
	const report = findLeaks(byColor[color], trees[color], color, evals, masters, 3);
	console.log(`\n${color}: ${report.departures} of ${report.games} games have a first departure; top leaks:`);
	for (const l of report.leaks.slice(0, 8)) {
		const { pos } = replayUcis(l.path);
		const best = l.best ? sanOf(pos, l.best) : '?';
		const line = l.path.length ? `${l.path.length} plies in` : 'move 1';
		console.log(
			`  ${l.points.toFixed(1).padStart(5)} pts  ${sanOf(pos, l.uci).padEnd(6)} ${l.label.padEnd(10)} -${l.drop.toFixed(1)}%  first in ${l.first}x  best ${best}  share ${l.share === null ? '-' : (100 * l.share).toFixed(1) + '%'}  (${line})`
		);
	}
}
