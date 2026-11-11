// For drill cards: the moves club players commonly choose in the card's position (Lichess database, 1000–1800,
// blitz and rapid) and the sound master alternatives, each graded by Stockfish with its line. Feeds the written
// explanations for moves other than the habit and the taught one.
// Usage: npx vite-node scripts/alternatives.ts <user> <card ids, comma-separated | top N>
//        -> data/<user>/alternatives.json (amateur lookups cached in data/<user>/amateur-cache.json)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { engineLabel, formatEval, INACCURACY, winPercent } from '../src/lib/analysis/score';
import { continuation, formatPlies } from '../src/lib/chess/line';
import { ACCEPT_DROP, POPULAR_MASTER_SHARE } from '../src/lib/drill/cards';
import { enginePool, lichessToken, root } from './harness';

const DEPTH = 20;
const LINE_PLIES = 10;
/** A club move counts as common from this share of games, and at most this many per position. */
const COMMON_SHARE = 0.05;
const MAX_COMMON = 4;
const MASTER_SHARE = 5;

const [user = 'draco_jaco', which = '20'] = process.argv.slice(2);
const cards = JSON.parse(readFileSync(new URL(`data/${user}/cards.json`, root), 'utf8')).cards as any[];
const chosen = which.includes('|') ? which.split(',').map((id) => cards.find((c) => c.id === id)).filter(Boolean) : cards.slice(0, Number(which));
const cacheFile = new URL(`data/${user}/amateur-cache.json`, root);
const cache: Record<string, { total: number; moves: { san: string; uci: string; games: number }[] }> = existsSync(cacheFile)
	? JSON.parse(readFileSync(cacheFile, 'utf8'))
	: {};
const token = lichessToken();

async function amateur(fen: string) {
	if (cache[fen]) return cache[fen];
	const params = { variant: 'standard', speeds: 'blitz,rapid', ratings: '1000,1200,1400,1600,1800', fen, moves: '12', topGames: '0', recentGames: '0' };
	for (;;) {
		const res = await fetch(`https://explorer.lichess.org/lichess?${new URLSearchParams(params)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
		if (res.status === 429) {
			await new Promise((r) => setTimeout(r, 60_000));
			continue;
		}
		if (!res.ok) throw new Error(`Lichess explorer: HTTP ${res.status}`);
		const d = (await res.json()) as any;
		cache[fen] = { total: d.white + d.draws + d.black, moves: d.moves.map((m: any) => ({ san: m.san, uci: m.uci, games: m.white + m.draws + m.black })) };
		writeFileSync(cacheFile, JSON.stringify(cache));
		return cache[fen];
	}
}

const pool = enginePool(6);
const sign = (pos: Chess) => (pos.turn === 'white' ? 1 : -1);
const uciOf = (pos: Chess, san: string) => {
	const m = parseSan(pos, san.replace(/^\d+\.+/, ''));
	return m ? makeUci(m) : undefined;
};
const cpOf = (r: { cp?: number; mate?: number }) => (r.mate !== undefined ? (r.mate > 0 ? 100000 : -100000) : (r.cp ?? 0));

const out = [];
for (const card of chosen) {
	const pos = Chess.fromSetup(parseFen(card.fen).unwrap()).unwrap();
	const habit = card.id.split('|')[1];
	const taught = uciOf(pos, card.taught.move);
	const club = await amateur(card.fen);
	const candidates = new Map<string, { amateurShare: number | null; mastersShare: number | null }>();
	for (const m of club.moves.slice(0, MAX_COMMON + 2)) {
		const share = club.total ? m.games / club.total : 0;
		if (share >= COMMON_SHARE && candidates.size < MAX_COMMON) candidates.set(uciOf(pos, m.san) ?? m.uci, { amateurShare: Math.round(share * 1000) / 10, mastersShare: null });
	}
	for (const m of card.masters?.moves ?? []) {
		const uci = uciOf(pos, m.move);
		if (!uci || m.share < MASTER_SHARE) continue;
		candidates.set(uci, { amateurShare: candidates.get(uci)?.amateurShare ?? null, mastersShare: m.share });
	}
	for (const m of card.masters?.moves ?? []) {
		const uci = uciOf(pos, m.move);
		const c = uci && candidates.get(uci);
		if (c) c.mastersShare = m.share;
	}
	candidates.delete(habit);
	if (taught) candidates.delete(taught);

	const best = await pool.evaluate(card.fen, DEPTH);
	const base = winPercent(sign(pos) * cpOf(best));
	const alternatives = [];
	for (const [uci, shares] of candidates) {
		const after = pos.clone();
		const move = parseSan(pos, continuation(pos, [uci])[0]?.san ?? '');
		if (!move) continue;
		after.play(move);
		const r = await pool.evaluate(makeFen(after.toSetup()), DEPTH);
		// The engine scores from the side to move after the move; evalWhite is from White's side.
		const evalWhite = sign(after) * cpOf(r);
		const drop = Math.max(0, base - winPercent(sign(pos) * evalWhite));
		// As the drill judges it: sound if close to the best move, or a common master move short of an inaccuracy.
		const popular = (shares.mastersShare ?? 0) >= POPULAR_MASTER_SHARE * 100 && drop < INACCURACY;
		const label = drop <= ACCEPT_DROP || popular ? 'sound' : (engineLabel(drop) ?? 'slightly worse');
		const line = continuation(pos, [uci, ...r.pv]).slice(0, LINE_PLIES);
		alternatives.push({
			move: formatPlies(line.slice(0, 1)),
			uci,
			...shares,
			eval: formatEval({ cp: Math.abs(evalWhite) >= 100000 ? undefined : evalWhite, mate: r.mate !== undefined ? sign(after) * r.mate : undefined }),
			winChanceLost: Math.round(drop * 10) / 10,
			label,
			line: formatPlies(line),
			lineUcis: line.map((p) => p.uci)
		});
	}
	out.push({
		id: card.id,
		opening: card.opening,
		color: card.color,
		moves: card.moves,
		fen: card.fen,
		eval: card.eval,
		clubGames: club.total,
		habit: card.habit,
		taught: card.taught,
		alternatives
	});
	console.log(`${card.id} ${card.opening}: ${alternatives.map((a) => `${a.move} ${a.label} (club ${a.amateurShare ?? '–'}%, masters ${a.mastersShare ?? '–'}%)`).join(', ')}`);
}
pool.quit();
writeFileSync(new URL(`data/${user}/alternatives.json`, root), JSON.stringify(out, null, '\t'));
console.log(`wrote ${out.length} cards to data/${user}/alternatives.json`);
