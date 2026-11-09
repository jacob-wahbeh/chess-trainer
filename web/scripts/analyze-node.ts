// Dev check: runs the app's analysis job in Node (see harness.ts) and prints the costliest first mistakes and
// what the drills would teach and accept for them. Masters data can be seeded from the research cache
// (JSON files with { epd, data | pruned }); with LICHESS_TOKEN set (env or .env), the rest is fetched.
// Usage: npx vite-node scripts/analyze-node.ts [user] [since YYYY-MM] [masters cache dir]
import { findLeaks } from '../src/lib/analysis/classify';
import { INACCURACY } from '../src/lib/analysis/score';
import { formatPlies, sanOf, walk } from '../src/lib/chess/line';
import { replayUcis } from '../src/lib/chess/pgn';
import { acceptedMoves, dropOf, mainMove } from '../src/lib/drill/cards';
import { analyse } from './harness';

const [user = 'draco_jaco', since = '2025-11', mastersDir] = process.argv.slice(2);
const { byColor, trees, evals, masters, quit } = await analyse({ user, since, mastersDir });
quit();

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

// What the drills would accept for the costliest cards.
const top = (['white', 'black'] as const)
	.flatMap((c) => findLeaks(byColor[c], trees[c], c, evals, masters, 3).leaks)
	.sort((a, b) => b.points - a.points)
	.slice(0, Number(process.env.TOP ?? 8));
console.log('\ntop drill cards, the answer taught, and accepted answers:');
for (const l of top) {
	const { pos } = replayUcis(l.path);
	const list = acceptedMoves(pos, l.key, l.uci, evals, masters);
	const prev = l.path.length ? replayUcis(l.path.slice(0, -1)) : undefined;
	const slip = prev ? dropOf(prev.pos, evals.get(prev.keys.at(-1)!), evals.get(l.key)) : null;
	const main = mainMove(list, masters.get(l.key), slip !== null && slip >= INACCURACY);
	const answers = list
		.map((a) => `${sanOf(pos, a.uci)} (${a.why}${a.drop === null ? '' : ` -${a.drop.toFixed(1)}`}${a.share === null ? '' : ` ${(100 * a.share).toFixed(0)}%`})`)
		.join(', ');
	const taught = main ? `${sanOf(pos, main.uci)} [${main.why}${main.why === 'punish' ? ` ${slip!.toFixed(1)}%` : ''}]` : '-';
	console.log(`  [${l.color}] ${formatPlies(walk(l.path).plies) || 'start'}  habit ${sanOf(pos, l.uci)}  ->  teach ${taught}; accept: ${answers || 'nothing!'}`);
}
