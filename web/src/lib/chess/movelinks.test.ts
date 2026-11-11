import { describe, expect, it } from 'vitest';
import { findMoves, plyIndex } from './movelinks';

const moves = (text: string) => findMoves(text).flatMap((s) => (s.move ? [s.move] : []));

describe('findMoves', () => {
	it('finds numbered moves for both sides', () => {
		expect(moves('3.dxe5 captures first, and after 3...Nxe5 the knight stands in the centre')).toEqual([
			{ no: 3, white: true, san: 'dxe5' },
			{ no: 3, white: false, san: 'Nxe5' }
		]);
	});

	it('follows unnumbered moves after a numbered one', () => {
		expect(moves('after 4...Bc5 5.f4 Nc6 the knight is back on c6')).toEqual([
			{ no: 4, white: false, san: 'Bc5' },
			{ no: 5, white: true, san: 'f4' },
			{ no: 5, white: false, san: 'Nc6' }
		]);
		expect(moves('8.O-O dxc3 9.Qb3 O-O 10.Nxc3 d6 leaves you')).toEqual([
			{ no: 8, white: true, san: 'O-O' },
			{ no: 8, white: false, san: 'dxc3' },
			{ no: 9, white: true, san: 'Qb3' },
			{ no: 9, white: false, san: 'O-O' },
			{ no: 10, white: true, san: 'Nxc3' },
			{ no: 10, white: false, san: 'd6' }
		]);
	});

	it('leaves squares in prose alone', () => {
		expect(moves('your pawns on e4 and f4 hold the centre')).toEqual([]);
		expect(moves('5.f4 gains space and sends it back')).toEqual([{ no: 5, white: true, san: 'f4' }]);
		expect(moves('Masters play it in 41% of games (1852).')).toEqual([]);
	});

	it('reads a Black move without a number, and strips check marks', () => {
		expect(moves("Black's ...d5 break")).toEqual([{ no: null, white: false, san: 'd5' }]);
		expect(moves('6.Bxf7+ Kxf7 7.Qd5+ forks')).toEqual([
			{ no: 6, white: true, san: 'Bxf7' },
			{ no: 6, white: false, san: 'Kxf7' },
			{ no: 7, white: true, san: 'Qd5' }
		]);
	});

	it('keeps the text intact', () => {
		const text = 'After 7...Nf6 8.cxd4 Nxe4 you gain time, 9.d5 hitting the knight.';
		expect(
			findMoves(text)
				.map((s) => s.text)
				.join('')
		).toBe(text);
	});
});

describe('plyIndex', () => {
	const plies = [
		{ uci: 'd4e5', san: 'dxe5', moveNumber: 3, white: true },
		{ uci: 'c6e5', san: 'Nxe5', moveNumber: 3, white: false },
		{ uci: 'b1c3', san: 'Nc3', moveNumber: 4, white: true },
		{ uci: 'f8c5', san: 'Bc5+', moveNumber: 4, white: false }
	];
	it('matches number, side and SAN (ignoring check marks)', () => {
		expect(plyIndex(plies, { no: 4, white: true, san: 'Nc3' })).toBe(2);
		expect(plyIndex(plies, { no: 4, white: false, san: 'Bc5' })).toBe(3);
		expect(plyIndex(plies, { no: 5, white: true, san: 'Nc3' })).toBe(-1);
		expect(plyIndex(plies, { no: null, white: false, san: 'Nxe5' })).toBe(1);
	});
});
