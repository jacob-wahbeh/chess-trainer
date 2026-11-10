import { describe, expect, it } from 'vitest';
import { replaySans, replayUcis } from '../chess/pgn';
import type { Leak } from '../analysis/classify';
import type { Eval, Masters } from '../analysis/score';
import { acceptedMoves, buildDeck, mainMove, newCard, recordAnswer, refreshCard, shuffled, statusOf, type Answer, type CardRecord } from './cards';

const DAY = 86_400_000;
const NOW = new Date('2026-11-09T12:00:00').getTime();

/** A leak first played `daysAgo` days ago (and last then too). */
const leak = (uci: string, points: number, path: string[] = ['e2e4', 'e7e5'], daysAgo = 60): Leak => ({
	key: replayUcis(path).keys.at(-1)!,
	uci,
	color: 'white',
	path,
	label: 'mistake',
	drop: 12,
	count: 10,
	first: 8,
	since: (NOW - daysAgo * DAY) / 1000,
	last: (NOW - daysAgo * DAY) / 1000,
	points,
	share: null,
	masters: []
});

/** Keeps every shuffle in order, so the deck order can be checked. */
const inOrder = () => 0.999;
const card = (uci: string, points: number, extra: Partial<CardRecord> = {}, daysAgo = 60): CardRecord => ({
	...newCard(leak(uci, points, ['e2e4', 'e7e5'], daysAgo), 'me', NOW - 100 * DAY),
	...extra
});

describe('buildDeck', () => {
	it('orders the deck by need: played again, missed, new from recent games, learning, older new cards', () => {
		const older = card('d2d3', 9);
		const recent = card('b1c3', 1, {}, 3);
		const learningOld = card('f1c4', 2, { seen: 2, streak: 1, lastSeen: NOW - 5 * DAY });
		const learningNew = card('f1b5', 2, { seen: 1, streak: 1, lastSeen: NOW - DAY });
		const missed = card('g1f3', 2, { seen: 1, missed: true, lastSeen: NOW - DAY });
		const again = card('d1h5', 2, { seen: 3, streak: 0, lastSeen: NOW - 9 * DAY, playedAgain: NOW - 2 * DAY });
		const deck = buildDeck([older, recent, learningNew, learningOld, missed, again], NOW, inOrder);
		expect(deck.ids).toEqual([again.id, missed.id, recent.id, learningOld.id, learningNew.id, older.id]);
		expect(deck).toMatchObject({ playedAgain: 1, missed: 1, recent: 1, fresh: 2, learning: 4, known: 0, total: 6 });
	});

	it('puts a card missed in the last half hour behind the new cards from recent games', () => {
		const recent = card('b1c3', 1, {}, 3);
		const learning = card('f1c4', 2, { seen: 2, streak: 1, lastSeen: NOW - 5 * DAY });
		const justMissed = card('g1f3', 2, { seen: 1, missed: true, lastSeen: NOW - 5 * 60_000 });
		const missed = card('d1h5', 2, { seen: 1, missed: true, lastSeen: NOW - DAY });
		const deck = buildDeck([learning, justMissed, recent, missed], NOW, inOrder);
		expect(deck.ids).toEqual([missed.id, recent.id, justMissed.id, learning.id]);
		expect(deck.missed).toBe(2);
	});

	it('mixes in one known card every eight cards and keeps the rest for the end', () => {
		const learning = Array.from({ length: 9 }, (_, i) => card(`a2a${i}`, 1, { seen: 1, streak: 1, lastSeen: NOW - (20 - i) * DAY }));
		const known = [card('h2h3', 1, { seen: 4, streak: 3, lastSeen: NOW - 30 * DAY }), card('h2h4', 1, { seen: 4, streak: 4, lastSeen: NOW - 10 * DAY })];
		const ids = buildDeck([...known, ...learning], NOW, inOrder).ids;
		expect(ids).toEqual([...learning.slice(0, 8).map((c) => c.id), known[0].id, learning[8].id, known[1].id]);
	});

	it('shuffles every card in random order, keeping the counts', () => {
		const cards = Array.from({ length: 12 }, (_, i) => card(`a2a${i}`, i, { seen: i % 3, streak: i % 4, lastSeen: NOW - i * DAY }));
		const byNeed = buildDeck(cards, NOW, inOrder);
		let n = 0;
		const deck = buildDeck(cards, NOW, () => ((n = (n * 7 + 3) % 11), n / 11), 'random');
		expect(new Set(deck.ids)).toEqual(new Set(byNeed.ids));
		expect(deck.ids).not.toEqual(byNeed.ids);
		expect({ ...deck, ids: [] }).toEqual({ ...byNeed, ids: [] });
	});

	it('skips suspended cards', () => {
		const deck = buildDeck([card('f1c4', 3, { suspended: true }), card('d2d3', 1)], NOW, inOrder);
		expect(deck.total).toBe(1);
		expect(deck.ids).toHaveLength(1);
	});
});

describe('streaks', () => {
	it('counts first-try answers in a row: three make a card known, a miss starts again', () => {
		let c = card('f1c4', 3);
		expect(statusOf(c)).toBe('new');
		c = recordAnswer(c, true, NOW);
		expect([c.streak, c.seen, c.lastSeen, c.missed, statusOf(c)]).toEqual([1, 1, NOW, false, 'learning']);
		c = recordAnswer(recordAnswer(c, true, NOW), true, NOW);
		expect(statusOf(c)).toBe('known');
		c = recordAnswer(c, false, NOW);
		expect([c.streak, c.missed, statusOf(c)]).toEqual([0, true, 'learning']);
	});

	it('sends a card back to the front when its mistake turns up in a game played after drilling it', () => {
		const drilled = recordAnswer(recordAnswer(card('f1c4', 3), true, NOW - 10 * DAY), true, NOW - 10 * DAY);
		const replayed = refreshCard(drilled, leak('f1c4', 4, ['e2e4', 'e7e5'], 2));
		expect([replayed.playedAgain, replayed.streak, replayed.points]).toEqual([NOW - 2 * DAY, 0, 4]);
		// Games from before the drill, or a card never drilled, change nothing but the numbers.
		expect(refreshCard(drilled, leak('f1c4', 4, ['e2e4', 'e7e5'], 20)).playedAgain).toBeUndefined();
		expect(refreshCard(card('f1c4', 3), leak('f1c4', 4, ['e2e4', 'e7e5'], 2)).playedAgain).toBeUndefined();
		// Drilling it again clears the flag.
		expect(recordAnswer(replayed, true, NOW).playedAgain).toBeUndefined();
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
