import { describe, expect, it } from 'vitest';
import { replaySans, replayUcis } from '../chess/pgn';
import type { Leak } from '../analysis/classify';
import type { Eval, Masters } from '../analysis/score';
import { acceptedMoves, autoGrade, buildSession, mainMove, newCard, previewDue, Rating, review, shuffled, State, type Answer, type CardRecord } from './cards';

const leak = (uci: string, points: number, path: string[] = ['e2e4', 'e7e5']): Leak => ({
	key: replayUcis(path).keys.at(-1)!,
	uci,
	color: 'white',
	path,
	label: 'mistake',
	drop: 12,
	count: 10,
	first: 8,
	points,
	share: null,
	masters: []
});

const DAY = 86_400_000;
const NOW = new Date('2026-11-09T12:00:00').getTime();

describe('buildSession', () => {
	it('puts due reviews first, then the costliest new cards within the daily allowance', () => {
		const a = newCard(leak('f1c4', 3.0), 'me', NOW - 10 * DAY);
		const b = newCard(leak('d2d3', 1.0), 'me', NOW);
		const c = newCard(leak('b1c3', 2.0), 'me', NOW);
		const reviewed = review(a, Rating.Good, NOW - 10 * DAY); // due again well before NOW
		const s = buildSession([reviewed, b, c], 1, NOW);
		expect(s.ids).toEqual([reviewed.id, c.id]);
		expect([s.due, s.fresh, s.total]).toEqual([1, 1, 3]);
	});

	it('counts cards introduced today against the new-card limit', () => {
		const a = review(newCard(leak('f1c4', 3.0), 'me', NOW), Rating.Good, NOW - 1000);
		const b = newCard(leak('d2d3', 1.0), 'me', NOW);
		expect(buildSession([a, b], 1, NOW).fresh).toBe(0);
		expect(buildSession([a, b], 2, NOW).fresh).toBe(1);
	});

	it('offers extra practice once the scheduled cards are done', () => {
		const learning = review(newCard(leak('f1c4', 3.0), 'me', NOW), Rating.Good, NOW - 1000); // back in minutes
		const known = review(review(newCard(leak('g1f3', 5.0), 'me', NOW), Rating.Easy, NOW - 30 * DAY), Rating.Easy, NOW - 20 * DAY);
		const unseen = newCard(leak('d2d3', 1.0), 'me', NOW);
		const s = buildSession([known, unseen, learning], 1, NOW);
		expect(known.due).toBeGreaterThan(NOW + DAY);
		expect(s.ids).toEqual([]);
		expect(s.extra).toEqual([learning.id, unseen.id, known.id]);
	});

	it('skips suspended cards and reports the next due time', () => {
		const a: CardRecord = { ...newCard(leak('f1c4', 3.0), 'me', NOW), suspended: true };
		const b = review(newCard(leak('d2d3', 1.0), 'me', NOW), Rating.Good, NOW);
		const s = buildSession([a, b], 5, NOW);
		expect(s.ids).toEqual([]);
		expect(s.extra).toEqual([b.id]);
		expect(s.nextDue).toBe(b.due);
	});
});

describe('review and preview', () => {
	it('schedules Again sooner than Good sooner than Easy, and records the first review', () => {
		const card = newCard(leak('f1c4', 3.0), 'me', NOW);
		const p = previewDue(card, NOW);
		expect(p[Rating.Again]).toBeLessThan(p[Rating.Good]);
		expect(p[Rating.Good]).toBeLessThanOrEqual(p[Rating.Easy]);
		const next = review(card, Rating.Good, NOW);
		expect(next.introduced).toBe(NOW);
		expect(next.fsrs.state).not.toBe(State.New);
		expect(next.due).toBe(next.fsrs.due.getTime());
	});

	it('grades misses as Again and quick answers on known cards as Easy', () => {
		expect(autoGrade({ correctFirstTry: false, ms: 1000, state: State.Review })).toBe(Rating.Again);
		expect(autoGrade({ correctFirstTry: true, ms: 1000, state: State.Review })).toBe(Rating.Easy);
		expect(autoGrade({ correctFirstTry: true, ms: 1000, state: State.New })).toBe(Rating.Good);
		expect(autoGrade({ correctFirstTry: true, ms: 9000, state: State.Review })).toBe(Rating.Good);
		expect(autoGrade({ correctFirstTry: true, ms: 20000, state: State.Review })).toBe(Rating.Hard);
	});
});

describe('acceptedMoves', () => {
	// After 1.e4 e5: 2.Nf3 is best, 2.Nc3 is close, 2.Bc4 is the habit being trained away, 2.d4 is unevaluated book.
	const { pos, keys } = replayUcis(['e2e4', 'e7e5']);
	const key = keys.at(-1)!;
	const childKey = (san: string) => replaySans(['e4', 'e5', san]).keys.at(-1)!;
	const ev = (cp: number, best?: string): Eval => ({ cp, best, depth: 30, src: 'cloud' });
	const evals = new Map<number, Eval>([
		[key, ev(40, 'g1f3')],
		[childKey('Nc3'), ev(25)],
		[childKey('Bc4'), ev(20)],
		[childKey('f3'), ev(-80)],
		[childKey('Qh5'), ev(5)] // -3.2%: past ACCEPT_DROP but short of an inaccuracy
	]);
	const masters = new Map<number, Masters>([[key, { total: 1000, moves: { g1f3: 600, f1c4: 150, d1h5: 120, d2d4: 80, b1c3: 40 } }]]);

	it('accepts the engine move, sound alternatives and unevaluated common book moves, never the habit', () => {
		const answers = acceptedMoves(pos, key, 'f1c4', evals, masters);
		expect(answers.map((a) => [a.uci, a.why])).toEqual([
			['g1f3', 'engine'],
			['b1c3', 'book'],
			['d2d4', 'book'],
			['d1h5', 'book'] // a 12% master move is accepted despite losing 3.2%
		]);
		expect(answers.find((a) => a.uci === 'f2f3')).toBeUndefined();
	});
});

describe('mainMove', () => {
	// The engine slightly prefers 3.Nc3, but masters mostly play 3.Nf3.
	const answers: Answer[] = [
		{ uci: 'b1c3', drop: 0, share: 0.3, why: 'engine' },
		{ uci: 'g1f3', drop: 0.8, share: 0.55, why: 'book' },
		{ uci: 'f1e2', drop: 2.5, share: null, why: 'sound' }
	];
	const book: Masters = { total: 500, moves: {} };

	it('teaches the masters favourite among sound moves in book positions', () => {
		expect(mainMove(answers, book, false)).toEqual({ uci: 'g1f3', why: 'thematic' });
	});

	it("teaches the engine's move after the opponent's inaccuracy", () => {
		expect(mainMove(answers, book, true)).toEqual({ uci: 'b1c3', why: 'punish' });
	});

	it("falls back to the engine's move out of book or without masters data", () => {
		const engineOnly = answers.map((a) => ({ ...a, share: null }));
		expect(mainMove(engineOnly, { total: 6, moves: {} }, false)).toEqual({ uci: 'b1c3', why: 'offbook' });
		expect(mainMove(engineOnly, undefined, false)).toEqual({ uci: 'b1c3', why: 'engine' });
		expect(mainMove([], book, false)).toBeUndefined();
	});
});

describe('shuffled', () => {
	it('reorders a copy without losing or duplicating cards', () => {
		const ids = ['a', 'b', 'c', 'd', 'e'];
		let seed = 1;
		const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
		const out = shuffled(ids, random);
		expect(out).not.toEqual(ids);
		expect([...out].sort()).toEqual(ids);
		expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
	});
});
