import { describe, expect, it } from 'vitest';
import { replaySans } from '../chess/pgn';
import type { Game, Result } from '../games/types';
import { buildTree } from '../tree/tree';
import { findLeaks, judge } from './classify';
import { decisionParents, decisionPoints, depths, evalQueue, mastersOrder, needsMasters } from './plan';
import { engineLabel, winPercent, type Eval, type Masters } from './score';

function game(sans: string[], color: 'white' | 'black' = 'white', result: Result = 'win'): Game {
	const { ucis, keys } = replaySans(sans);
	return { id: sans.join(''), url: '', end: 0, timeClass: 'blitz', color, result, myRating: 0, oppRating: 0, opponent: '', ucis, keys };
}
const keyAt = (sans: string[]) => replaySans(sans).keys.at(-1)!;
const times = (n: number, g: () => Game) => Array.from({ length: n }, g);

describe('score', () => {
	it('matches the Lichess win% curve and thresholds', () => {
		expect(winPercent(0)).toBe(50);
		expect(winPercent(100)).toBeCloseTo(59.1, 1);
		expect(winPercent(5000)).toBe(winPercent(1000));
		expect([engineLabel(4.9), engineLabel(5), engineLabel(10), engineLabel(15)]).toEqual([null, 'inaccuracy', 'mistake', 'blunder']);
	});
});

// White repertoire: 1.e4; vs 1...e5 2.Nf3 (and once the mistaken 2.Bc4); vs 1...c5 always 2.d4 (a repertoire gambit).
const games = [
	...times(3, () => game(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])),
	game(['e4', 'e5', 'Bc4']),
	...times(2, () => game(['e4', 'c5', 'd4']))
];
const tree = buildTree(games);
const K = {
	start: keyAt([]),
	e4: keyAt(['e4']),
	e4e5: keyAt(['e4', 'e5']),
	nf3: keyAt(['e4', 'e5', 'Nf3']),
	bc4: keyAt(['e4', 'e5', 'Bc4']),
	e4c5: keyAt(['e4', 'c5']),
	d4: keyAt(['e4', 'c5', 'd4']),
	nc6: keyAt(['e4', 'e5', 'Nf3', 'Nc6']),
	italian: keyAt(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])
};
const ev = (cp: number, best?: string): Eval => ({ cp, best, depth: 20, src: 'cloud' });
const evals = new Map<number, Eval>([
	[K.start, ev(30, 'e2e4')],
	[K.e4, ev(30)],
	[K.e4e5, ev(40, 'g1f3')],
	[K.nf3, ev(40)],
	[K.bc4, ev(-100)], // 53.7% -> 40.9%: a mistake
	[K.e4c5, ev(30, 'g1f3')],
	[K.d4, ev(0)], // -2.8%: sound
	[K.nc6, ev(50, 'f1b5')],
	[K.italian, ev(35)]
]);
const masters = new Map<number, Masters>([
	[K.e4c5, { total: 1000, moves: { g1f3: 800, b1c3: 150, d2d4: 5 } }], // 2.d4 in 0.5% of master games
	[K.nc6, { total: 5000, moves: { f1b5: 3000, f1c4: 1500, d2d4: 500 } }]
]);

describe('judge', () => {
	const verdict = (key: number, uci: string) =>
		judge(tree.get(key)!, key, 'white', evals, masters).find((v) => v.uci === uci)!;

	it('labels engine losses regardless of theory', () => {
		const v = verdict(K.e4e5, 'f1c4');
		expect(v.label).toBe('mistake');
		expect(v.drop).toBeCloseTo(winPercent(40) - winPercent(-100), 5);
	});

	it('gives the engine best move zero loss, and is engine-only without masters data', () => {
		expect(verdict(K.e4e5, 'g1f3')).toMatchObject({ drop: 0, label: 'ok', share: null });
	});

	it('marks book moves and consistent off-book choices', () => {
		expect(verdict(K.nc6, 'f1c4')).toMatchObject({ label: 'book', share: 0.3 });
		expect(verdict(K.e4c5, 'd2d4')).toMatchObject({ label: 'repertoire', share: 0.005 });
	});

	it('is unknown until both positions are evaluated', () => {
		const partial = new Map(evals);
		partial.delete(K.d4);
		expect(judge(tree.get(K.e4c5)!, K.e4c5, 'white', partial, masters)[0].label).toBeNull();
	});
});

describe('findLeaks', () => {
	it('credits only the first departure per game, with the path actually played', () => {
		const report = findLeaks(games, tree, 'white', evals, masters, 1);
		expect(report.departures).toBe(1);
		expect(report.leaks).toHaveLength(1);
		expect(report.leaks[0]).toMatchObject({ key: K.e4e5, uci: 'f1c4', first: 1, label: 'mistake', path: ['e2e4', 'e7e5'], best: 'g1f3' });
		expect(report.leaks[0].points).toBeCloseTo(report.leaks[0].drop / 100, 5);
	});

	it('flags off-book moves that are not repertoire choices', () => {
		const mixed = [...games, game(['e4', 'c5', 'Nc3']), ...times(2, () => game(['e4', 'c5', 'd4']))];
		const t = buildTree(mixed);
		const m = new Map(masters).set(keyAt(['e4', 'c5']), { total: 1000, moves: { g1f3: 800, b1c3: 5, d2d4: 5 } });
		const e = new Map(evals).set(keyAt(['e4', 'c5', 'Nc3']), ev(20));
		const leaks = findLeaks(mixed, t, 'white', e, m, 1).leaks;
		// 2.d4 is now played 4 of 5 times (80%): still a repertoire choice; 2.Nc3 is off-book.
		expect(leaks.map((l) => [l.uci, l.label])).toEqual([
			['f1c4', 'mistake'],
			['b1c3', 'offbook']
		]);
	});

	it('stops at positions reached fewer than minReach times', () => {
		// The 2.Bc4 position is reached 4 times (the move itself only once): found at 4, skipped at 5.
		expect(findLeaks(games, tree, 'white', evals, masters, 4).leaks).toHaveLength(1);
		expect(findLeaks(games, tree, 'white', evals, masters, 5).leaks).toHaveLength(0);
	});
});

describe('plan', () => {
	const depth = depths(tree, K.start);

	it('finds decision points for the user, most common first', () => {
		expect(depth.get(K.e4e5)).toBe(2);
		expect(decisionPoints(tree, 'white', 2, depth)).toEqual([K.start, K.e4e5, K.nc6, K.e4c5]);
		expect(decisionPoints(tree, 'black', 2, depth)).toEqual([K.e4, K.nf3, K.italian, K.d4]);
	});

	it('queues each decision point then its children, without duplicates', () => {
		expect(evalQueue(tree, [K.start, K.e4e5])).toEqual([K.start, K.e4, K.e4e5, K.nf3, K.bc4]);
	});

	it('orders masters lookups shallow first and skips lines that left theory', () => {
		const decisions = decisionPoints(tree, 'white', 1, depth);
		expect(mastersOrder(decisions, depth)[0]).toBe(K.start);
		const parents = decisionParents(tree, decisions);
		expect(parents.get(K.nc6)).toEqual([K.e4e5]);
		expect(needsMasters(K.nc6, parents, new Map())).toBe(true);
		expect(needsMasters(K.nc6, parents, new Map([[K.e4e5, { total: 3, moves: {} }]]))).toBe(false);
		expect(needsMasters(K.nc6, parents, new Map([[K.e4e5, { total: 300, moves: {} }]]))).toBe(true);
	});
});
