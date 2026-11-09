// Dev check: runs the app's import + tree code over the Python CLI's cached archives (../data/<user>/archives)
// and prints counts comparable to the Python research (positions reached >= N times in the first 30 plies).
// Usage: npx vite-node scripts/compare-python.ts [user] [since YYYY-MM] [time classes]
import { readFileSync, readdirSync } from 'node:fs';
import { normalizeGame, type RawGame } from '../src/lib/games/chesscom';
import type { Game } from '../src/lib/games/types';
import { buildTree } from '../src/lib/tree/tree';

const [user = 'draco_jaco', since = '2025-11', classes = 'blitz,rapid'] = process.argv.slice(2);
const dir = new URL(`../../data/${user}/archives/`, import.meta.url);
const sinceTs = Date.UTC(Number(since.slice(0, 4)), Number(since.slice(5, 7)) - 1, 1) / 1000;
const wanted = new Set(classes.split(','));

let raws: RawGame[] = [];
for (const file of readdirSync(dir).sort()) raws = raws.concat(JSON.parse(readFileSync(new URL(file, dir), 'utf8')).games);

let t = performance.now();
const all = raws.map((r) => normalizeGame(r, user)).filter((g): g is Game => g !== null);
const parseMs = performance.now() - t;
const games = all.filter((g) => wanted.has(g.timeClass) && g.end >= sinceTs);

t = performance.now();
const trees = { white: buildTree(games.filter((g) => g.color === 'white')), black: buildTree(games.filter((g) => g.color === 'black')) };
const treeMs = performance.now() - t;

// Same counting as the Python research: positions before each of the first 30 plies, once per game, both colors.
const reach = new Map<number, number>();
for (const g of games) for (const k of new Set(g.keys.slice(0, 30))) reach.set(k, (reach.get(k) ?? 0) + 1);

console.log(`parsed ${all.length} games (of ${raws.length} archived) in ${parseMs.toFixed(0)} ms (${((parseMs / all.length) * 1000).toFixed(0)} µs/game)`);
console.log(`filter ${classes} since ${since}: ${games.length} games; trees built in ${treeMs.toFixed(1)} ms (white ${trees.white.size}, black ${trees.black.size} nodes)`);
for (const n of [2, 3, 5, 10, 20]) console.log(`  reached >= ${String(n).padStart(2)} times: ${[...reach.values()].filter((c) => c >= n).length}`);
