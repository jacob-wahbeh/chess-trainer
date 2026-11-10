import { describe, expect, it } from 'vitest';
import { formatEval, formatEvalShort, standingOf, standingSentence } from './score';

const cp = (n: number) => ({ cp: n, depth: 20, src: 'local' as const });

describe('formatEval', () => {
	it('reads like an eval bar, from White’s side', () => {
		expect(formatEval(cp(45))).toBe('+0.45');
		expect(formatEval(cp(-121))).toBe('−1.21');
		expect(formatEval(cp(0))).toBe('0.00');
		expect(formatEval({ mate: -2, depth: 20, src: 'local' })).toBe('−#2');
	});

	it('has a short form that fits a narrow bar', () => {
		expect(formatEvalShort(cp(33))).toBe('+0.3');
		expect(formatEvalShort(cp(-121))).toBe('−1.2');
		expect(formatEvalShort(cp(4))).toBe('0.0');
		expect(formatEvalShort(cp(1240))).toBe('+12');
		expect(formatEvalShort({ mate: 3, depth: 20, src: 'local' })).toBe('#3');
	});
});

describe('standingOf', () => {
	it('says who is better, in words, from either side', () => {
		expect(standingOf(cp(14))).toBe('level');
		expect(standingOf(cp(-60))).toBe('Black slightly better');
		expect(standingOf(cp(107))).toBe('White better');
		expect(standingOf(cp(268))).toBe('White clearly better');
		expect(standingOf(cp(-900))).toBe('Black winning');
		expect(standingOf({ mate: -3, depth: 20, src: 'local' as const })).toBe('Black has mate');
		expect(standingSentence(cp(268))).toBe('White is clearly better');
		expect(standingSentence(cp(0))).toBe('It’s level');
		expect(standingSentence({ mate: 2, depth: 20, src: 'local' as const })).toBe('White has mate');
	});
});
