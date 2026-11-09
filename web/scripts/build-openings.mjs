// Builds static/openings.json from lichess-org/chess-openings (CC0): [[eco, name, "uci uci ..."], ...].
// Moves are stored as UCI so the app can replay them without SAN parsing.
import { writeFile } from 'node:fs/promises';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';

const COMMIT = '3ba6b20d31b2e6125cb0e6a2e792f400717d9d39';
const out = [];
for (const file of ['a', 'b', 'c', 'd', 'e']) {
	const url = `https://raw.githubusercontent.com/lichess-org/chess-openings/${COMMIT}/${file}.tsv`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	for (const line of (await res.text()).trim().split('\n').slice(1)) {
		const [eco, name, pgn] = line.split('\t');
		const pos = Chess.default();
		const ucis = [];
		for (const token of pgn.split(/\s+/)) {
			if (/^\d+\.+$/.test(token)) continue;
			const move = parseSan(pos, token);
			if (!move) throw new Error(`${name}: illegal move ${token} in "${pgn}"`);
			ucis.push(makeUci(move));
			pos.play(move);
		}
		out.push([eco, name, ucis.join(' ')]);
	}
}
await writeFile(new URL('../static/openings.json', import.meta.url), JSON.stringify(out));
console.log(`${out.length} named openings written`);
