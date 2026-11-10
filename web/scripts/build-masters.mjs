// Ships the masters data the exports looked up (data/*/web-cache.json, from `npm run cards:export`) as
// static/masters.json, so the app can tell book moves and teach the masters' move without a Lichess login.
// Positions with no master games are kept too: they tell the app the line has left theory.
// Usage: npm run masters   (after exporting cards for anyone new)
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';

const dataDir = new URL('../../data/', import.meta.url);
const out = new URL('../static/masters.json', import.meta.url);
const masters = new Map();
for (const user of readdirSync(dataDir)) {
	const file = new URL(`${user}/web-cache.json`, dataDir);
	if (!existsSync(file)) continue;
	for (const [key, value] of JSON.parse(readFileSync(file, 'utf8')).masters ?? []) {
		const known = masters.get(key);
		if (!known || (known.total === 0 && value.total > 0)) masters.set(key, value);
	}
}
// One position per line, sorted, so commits show what changed. Format: { "<position key>": [total, { uci: games }] }
const lines = [...masters]
	.sort((a, b) => a[0] - b[0])
	.map(([key, { total, moves }]) => `${JSON.stringify(String(key))}:${JSON.stringify([total, moves])}`);
writeFileSync(out, `{\n${lines.join(',\n')}\n}\n`);
const withGames = [...masters.values()].filter((m) => m.total > 0).length;
console.log(`${masters.size} positions (${withGames} with master games) -> static/masters.json`);
